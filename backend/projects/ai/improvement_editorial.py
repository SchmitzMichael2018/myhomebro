"""Advisory, unsaved Project Assistant proposals for staff article editors."""

import json
import re

from projects.ai.template_builder import _model_name, _require_openai_client


PROPOSAL_FIELDS = (
    "public_summary", "public_problem", "public_viewpoint", "public_practical_steps",
)
REWRITE_FIELDS = PROPOSAL_FIELDS
_UNSAFE_CLAIMS = re.compile(
    r"\bguarantee(?:d|s)?\s+(?:of\s+)?payment\b|"
    r"\bpayment\s+(?:is\s+)?guaranteed\b|"
    r"\b(?:ensures?|promises?)\b.{0,60}\b(?:paid|payout|release|payment\b(?!\s+(?:plan|schedule|terms)))|"
    r"\b(?:automatically|always)\s+(?:release|releases|paid|pays)\b|"
    r"\bprevent(?:s|ed)?\s+(?:all\s+)?disputes\b|"
    r"\bescrow\b|\b(?:no|zero)\s+disputes\b",
    re.IGNORECASE,
)
_UNIVERSAL_LEGAL_ADVICE = re.compile(
    r"\b(?:always|immediately|simply|just)\b.{0,40}\b(?:file|record|pursue)\b.{0,20}\b(?:a\s+)?lien\b|"
    r"\b(?:lien|lawsuit|small claims|legal action)\b.{0,50}\b(?:guarantees?|ensures?|will)\b",
    re.IGNORECASE,
)
_QUESTIONABLE_CLAIM = re.compile(
    r"\b(?:lien|lawsuit|small claims|attorney|legal remedy|deposit protection|automatically protected)\b",
    re.IGNORECASE,
)
_UNSAFE_ATTRIBUTION = re.compile(
    r"\b(?:study|survey|report|research|according to|data shows|source says|FTC|Houzz|QuickBooks)\b",
    re.IGNORECASE,
)


class UnsafeEditorialProposal(ValueError):
    """The provider returned text that is not safe to propose to an editor."""


def propose_article_sections(*, mode, section, context):
    if mode not in {"titles", "outline", "draft", "rewrite", "section"}:
        raise ValueError("Unsupported proposal mode.")
    if mode == "rewrite" and section not in REWRITE_FIELDS:
        raise ValueError("Select a narrative section to rewrite. Evidence and sources require manual editing.")
    selected_section = None
    if mode == "section":
        selected_section = next(
            (
                item
                for item in context.get("public_sections") or []
                if isinstance(item, dict) and str(item.get("id")) == str(section)
            ),
            None,
        )
        if selected_section is None:
            raise ValueError("Select an article section for writing help.")
    fields = (section,) if mode == "rewrite" else {
        "titles": ("article_titles", "seo_titles"),
        "outline": ("editorial_outline",),
        "draft": PROPOSAL_FIELDS,
        "section": ("section_body",),
    }[mode]
    # The source URL is context only. The provider cannot create or edit evidence or citations.
    user_context = {
        key: str(context.get(key) or "")[:4000]
        for key in (
            "public_title", "public_problem", "public_evidence",
            "public_evidence_source", "public_viewpoint", "public_summary",
            "public_practical_steps", "public_next_action",
        )
    }
    user_context["public_audiences"] = [
        str(value)[:40] for value in (context.get("public_audiences") or [context.get("public_audience")])
    ]
    brief = context.get("public_editorial_brief") or {}
    user_context["editorial_brief"] = {
        key: str(brief.get(key) or "")[:3000]
        for key in ("idea", "problem", "readers", "viewpoint", "desired_action", "sources")
    }
    if selected_section:
        user_context["selected_section"] = {
            "title": str(selected_section.get("title") or "")[:160],
            "body": str(selected_section.get("body") or "")[:4000],
        }
    instructions = (
        "You are MyHomeBro Project Assistant preparing an UNVERIFIED editorial proposal for a staff editor. "
        "Return one JSON object with only the requested field names and string values. "
        "Use every supplied audience, the optional brief, problem, evidence/source, and existing viewpoint as context. "
        "Do not claim to have visited or read a source URL. Never invent a citation, source, statistic, "
        "population, date, legal rule, product capability, payment guarantee, escrow guarantee, or dispute outcome. "
        "Do not repeat or rewrite numerical evidence: the editor controls the separate evidence field. "
        "Use no digits, percentages, currency amounts, URLs, or source attributions in your answer. "
        "Create a balanced MyHomeBro viewpoint when requested even if the current viewpoint is empty. "
        "For multiple audiences, distinguish role-appropriate final actions. Use hyphen bullets instead of numbered steps. "
        "A deposit is not automatic protection. Do not promise payment or completion. Do not casually recommend liens, "
        "lawsuits, or other legal remedies as universal steps. Flag uncertainty through cautious wording. "
        "For section mode, return only section_body text for the selected section title and context. "
        "Do not publish, save, or represent this proposal as reviewed. For title mode return three editable article_titles "
        "and three editable seo_titles as arrays of strings. For outline mode return editorial_outline as a string."
    )
    client = _require_openai_client()
    response = client.responses.create(
        model=_model_name(),
        input=[
            {"role": "system", "content": instructions},
            {"role": "user", "content": json.dumps({
                "mode": mode, "requested_fields": fields, "article_context": user_context,
            }, ensure_ascii=False)},
        ],
        temperature=0.3,
        max_output_tokens=1200,
        store=False,
    )
    try:
        result = json.loads(response.output_text or "")
    except (TypeError, ValueError) as exc:
        raise UnsafeEditorialProposal("Project Assistant did not return a usable proposal.") from exc
    if not isinstance(result, dict) or not result:
        raise UnsafeEditorialProposal("Project Assistant did not return a usable proposal.")
    if set(result) - set(fields):
        raise UnsafeEditorialProposal("Project Assistant returned an unexpected section.")
    if mode == "rewrite" and set(result) != {section}:
        raise UnsafeEditorialProposal("Project Assistant did not return the selected section.")
    if mode == "section" and set(result) != {"section_body"}:
        raise UnsafeEditorialProposal("Project Assistant did not return the selected section.")
    if mode == "titles" and set(result) != {"article_titles", "seo_titles"}:
        raise UnsafeEditorialProposal("Project Assistant did not return title suggestions.")
    if mode == "outline" and set(result) != {"editorial_outline"}:
        raise UnsafeEditorialProposal("Project Assistant did not return an outline.")
    if mode == "draft" and not {"public_summary", "public_problem", "public_practical_steps"}.issubset(result):
        raise UnsafeEditorialProposal("Project Assistant did not return a complete narrative draft.")
    proposal = {}
    for key, value in result.items():
        values = value if isinstance(value, list) else [value]
        if key in {"article_titles", "seo_titles"} and (
            len(values) < 2 or len(values) > 6 or any(not isinstance(item, str) for item in values)
        ):
            raise UnsafeEditorialProposal("Project Assistant returned invalid title suggestions.")
        if key not in {"article_titles", "seo_titles"} and not isinstance(value, str):
            raise UnsafeEditorialProposal("Project Assistant returned an invalid section.")
        cleaned = []
        for item in values:
            if not item.strip() or len(item) > 4000:
                raise UnsafeEditorialProposal("Project Assistant returned an invalid section.")
            if (
                re.search(r"\d|https?://|www\.|\bcited by\b", item, re.IGNORECASE)
                or _UNSAFE_CLAIMS.search(item)
                or _UNSAFE_ATTRIBUTION.search(item)
                or _UNIVERSAL_LEGAL_ADVICE.search(item)
            ):
                raise UnsafeEditorialProposal("Project Assistant returned a claim requiring manual source review.")
            cleaned.append(item.strip())
        proposal[key] = cleaned if isinstance(value, list) else cleaned[0]
    if not proposal:
        raise UnsafeEditorialProposal("Project Assistant did not return a usable proposal.")
    return proposal


def proposal_review_flags(proposal):
    text = " ".join(
        item
        for value in proposal.values()
        for item in (value if isinstance(value, list) else [value])
    )
    if _QUESTIONABLE_CLAIM.search(text):
        return ["Review legal or payment-protection language with an appropriate source before use."]
    return []
