# backend/projects/services/legal_clauses.py
from __future__ import annotations
from typing import List, Optional, Tuple

try:
    from django.conf import settings  # optional; used for state overrides
except Exception:  # pragma: no cover
    settings = None


Clause = Tuple[str, str]  # (title, body)


def _cooling_off_clause(project_state: Optional[str]) -> Clause:
    """
    Returns a state-aware 'Right to Cancel' clause as (title, body).
    If settings.MHB_COOLING_OFF_BY_STATE contains a key for the state (e.g., 'CA', 'TX'),
    that text is used as the body; otherwise a safe, generic fallback is returned.
    """
    title = "Right to Cancel (If Applicable by Law)"
    state = (project_state or "").strip().upper() or None
    override_map = getattr(settings, "MHB_COOLING_OFF_BY_STATE", {}) if settings else {}
    if state and state in override_map:
        return (title, override_map[state])
    return (
        title,
        "If a residential 'cooling-off' or 'three-day cancellation' right applies under the governing state’s law, "
        "the Homeowner may cancel within the applicable period by written notice through the platform message center. "
        "Any refund or recovery will follow applicable law and this Agreement’s payment provisions. Because these laws "
        "vary by state and project type, the parties are responsible for verifying whether such a right applies to this "
        "project in their state."
    )


def build_legal_notices(project_state: Optional[str] = None) -> List[Clause]:
    """
    Returns ordered (title, body) pairs to render in both preview and final PDFs,
    reflecting the user-approved edits.
    """
    clauses: List[Clause] = []

    # 1) Incorporation by Reference
    clauses.append((
        "Terms Incorporated",
        "The MyHomeBro Terms of Service, Privacy Policy, and any Escrow Program Terms are incorporated into this "
        "Agreement by reference. By signing, the parties acknowledge review and acceptance of those terms and agree they "
        "govern platform use, payments, disputes, and data handling."
    ))

    # 2) E-Sign Consent
    clauses.append((
        "Electronic Signatures & Records",
        "The parties consent to do business electronically and agree that electronic signatures and records have the "
        "same force and effect as wet ink signatures, that they can download or print records, and that they may withdraw "
        "consent by written notice prior to signing."
    ))

    # 3) Independent Contractor
    clauses.append((
        "Independent Contractor",
        "Contractor is an independent contractor and not an employee, agent, partner, or joint venturer of MyHomeBro or "
        "Homeowner. Contractor retains exclusive control over means, methods, personnel, and safety."
    ))

    # 4) Change Orders
    clauses.append((
        "Changes",
        "Any changes to scope, materials, or schedule must be documented in a signed Change Order stating the impact on "
        "price and time. No verbal change is binding."
    ))

    # 5) Permits, Codes, Site Access (with Homeowner verification)
    clauses.append((
        "Permits & Compliance",
        "Unless otherwise stated in writing, Contractor is responsible for performing work in accordance with applicable "
        "codes and for obtaining required permits. Homeowner will provide reasonable site access, utilities, and a safe "
        "work environment during normal working hours. It is the Homeowner’s responsibility to verify with the Contractor "
        "— in writing — who is responsible for securing specific permits and inspections for this project."
    ))

    # 6) Unforeseen Conditions
    clauses.append((
        "Concealed/Unforeseen Conditions",
        "If concealed, hazardous, or unexpected site conditions are discovered, Contractor will notify Homeowner. Price "
        "and schedule will be equitably adjusted via Change Order."
    ))

    # 7) Materials, Title, Risk
    clauses.append((
        "Title & Risk",
        "Title to materials passes to Homeowner upon payment for the applicable milestone. Contractor bears risk of loss "
        "for Contractor-owned materials until installation or payment, whichever is later."
    ))

    # 8) Payment & Escrow (72-hour auto-release)
    clauses.append((
        "Payment & Escrow",
        "Payments are funded to escrow and released per approved milestones. After a milestone is submitted for approval, "
        "Homeowner will have seventy-two (72) hours to approve or dispute through the platform. If no response is received "
        "within 72 hours, funds for that milestone may be automatically released. Chargebacks or clawbacks outside the "
        "platform’s dispute process are not permitted."
    ))

    # 10) Dispute Resolution (generalized, remote-friendly, initiator’s state unless prohibited)
    clauses.append((
        "Dispute Resolution",
        "Any dispute the parties cannot resolve through the platform will first be submitted to good-faith mediation. If "
        "unresolved within thirty (30) days of a written mediation request, the dispute shall be resolved by binding, "
        "individual arbitration administered by a recognized arbitration provider. The arbitration provider may conduct "
        "conferences and hearings by video or teleconference unless in-person proceedings are required by law. Unless "
        "prohibited by law, the governing law and any required venue will be the state and county of the party initiating "
        "the arbitration. The arbitrator may award any relief available at law or equity on an individual basis. Class, "
        "collective, or representative claims are not permitted."
    ))

    # 11) Limitation of Liability
    clauses.append((
        "Limitation of Liability",
        "Neither party is liable for indirect, incidental, special, or consequential damages. Except for bodily injury or "
        "property damage caused by negligence, Contractor’s aggregate liability for claims arising from the work will not "
        "exceed the amounts paid for the specific portion of work giving rise to the claim."
    ))

    # 12) Insurance (Homeowner requests proof; MHB doesn’t provide or verify)
    clauses.append((
        "Insurance",
        "Contractor represents it maintains commercially reasonable insurance (e.g., general liability) appropriate for "
        "the work. MyHomeBro does not provide or verify insurance certificates. Homeowner must request proof of insurance "
        "directly from Contractor."
    ))

    # 13) Force Majeure
    clauses.append((
        "Force Majeure",
        "Neither party is liable for delay or failure caused by events beyond reasonable control, including but not limited "
        "to extreme weather, labor actions, supply chain disruption, epidemics, or acts of government. Time for performance "
        "will be extended for the duration of the impact."
    ))

    # 14) Warranty Clarifier
    clauses.append((
        "Warranty Exclusions & Claims",
        "Warranty excludes normal wear, abuse, improper maintenance, third-party modifications, and acts of God. Warranty "
        "claims must be submitted through the platform within the stated warranty period. Contractor will have a reasonable "
        "opportunity to inspect and cure."
    ))

    # 16) Photo Authorization (optional)
    clauses.append((
        "Photo Authorization (Optional)",
        "Homeowner grants Contractor permission to photograph completed work for portfolio or marketing, excluding any "
        "personally identifiable information. This authorization is optional and may be revoked by written notice prior to publication."
    ))

    # 17) Confidentiality
    clauses.append((
        "Confidentiality",
        "Each party will keep the other’s non-public information confidential and use it only to perform this Agreement, "
        "except where disclosure is required by law."
    ))

    # 18) Entire Agreement
    clauses.append((
        "Entire Agreement",
        "This document, its signed Change Orders, and the incorporated platform terms constitute the entire agreement. "
        "If there is a conflict, a signed Change Order controls for its subject matter; otherwise this Agreement controls, "
        "then the platform terms."
    ))

    # 19) Notices
    clauses.append((
        "Notices",
        "Legal notices shall be sent via the platform message center and to the email addresses on file for each party and "
        "are deemed received when sent."
    ))

    # 20) Cooling-Off / Cancellation (state-aware)
    clauses.append(_cooling_off_clause(project_state))

    return clauses
