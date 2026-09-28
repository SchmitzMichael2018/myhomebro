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
    r"\b(?:ensures?|promises?)\b.{0,60}\b(?:paid|payment|payout|release)\b|"
    r"\b(?:automatically|always)\s+(?:release|releases|paid|pays)\b|"
    r"\bprevent(?:s|ed)?\s+(?:all\s+)?disputes\b|"
    r"\bescrow\b|\b(?:no|zero)\s+disputes\b",
    re.IGNORECASE,
)
_UNSAFE_ATTRIBUTION = re.compile(
    r"\b(?:study|survey|report|research|according to|data shows|source says|FTC|Houzz|QuickBooks)\b",
    re.IGNORECASE,
)


class UnsafeEditorialProposal(ValueError):
    """The provider returned text that is not safe to propose to an editor."""


def propose_article_sections(*, mode, section, context):
    if mode not in {"outline", "draft", "rewrite"}:
        raise ValueError("Unsupported proposal mode.")
    if mode == "rewrite" and section not in REWRITE_FIELDS:
        raise ValueError("Select a narrative section to rewrite. Evidence and sources require manual editing.")
    fields = (section,) if mode == "rewrite" else (
        ("public_practical_steps",) if mode == "outline" else PROPOSAL_FIELDS
    )
    # The source URL is context only. The provider cannot create or edit evidence or citations.
    user_context = {
        key: str(context.get(key) or "")[:4000]
        for key in (
            "public_title", "public_audience", "public_problem", "public_evidence",
            "public_evidence_source", "public_viewpoint", "public_summary",
            "public_practical_steps", "public_next_action",
        )
    }
    instructions = (
        "You are MyHomeBro Project Assistant preparing an UNVERIFIED editorial proposal for a staff editor. "
        "Return one JSON object with only the requested field names and string values. "
        "Use the supplied audience, problem, evidence/source, and existing viewpoint as context. "
        "Do not claim to have visited or read a source URL. Never invent a citation, source, statistic, "
        "population, date, legal rule, product capability, payment guarantee, escrow guarantee, or dispute outcome. "
        "Do not repeat or rewrite numerical evidence: the editor controls the separate evidence field. "
        "Use no digits, percentages, currency amounts, URLs, or source attributions in your answer. "
        "Keep any viewpoint provisional and consistent with the supplied MyHomeBro viewpoint; "
        "if none is supplied, omit the viewpoint field. Use hyphen bullets instead of numbered steps. "
        "A milestone or deposit is not a guarantee of payment, and payment release can depend on approval "
        "and disputes. Do not publish, save, or represent this proposal as reviewed."
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
    if mode == "outline" and set(result) != {"public_practical_steps"}:
        raise UnsafeEditorialProposal("Project Assistant did not return an outline.")
    if mode == "draft" and not {"public_summary", "public_problem", "public_practical_steps"}.issubset(result):
        raise UnsafeEditorialProposal("Project Assistant did not return a complete narrative draft.")
    proposal = {}
    for key, value in result.items():
        if key == "public_viewpoint" and not user_context["public_viewpoint"].strip():
            continue
        if not isinstance(value, str) or not value.strip() or len(value) > 4000:
            raise UnsafeEditorialProposal("Project Assistant returned an invalid section.")
        if re.search(r"\d|https?://|www\.|\bcited by\b", value, re.IGNORECASE) or _UNSAFE_CLAIMS.search(value) or _UNSAFE_ATTRIBUTION.search(value):
            raise UnsafeEditorialProposal("Project Assistant returned a claim requiring manual source review.")
        proposal[key] = value.strip()
    if not proposal:
        raise UnsafeEditorialProposal("Project Assistant did not return a usable proposal.")
    return proposal
