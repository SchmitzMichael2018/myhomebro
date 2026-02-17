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
        # NOTE: If your overrides contain "Homeowner", update those override strings too,
        # or apply a replace at render-time. We leave overrides untouched by default.
        return (title, override_map[state])

    return (
        title,
        "If a residential 'cooling-off' or 'three-day cancellation' right applies under the governing state’s law, "
        "the Customer may cancel within the applicable period by written notice through the platform message center. "
        "Any refund or recovery will follow applicable law and this Agreement’s payment provisions. Because these laws "
        "vary by state and project type, the parties are responsible for verifying whether such a right applies to this "
        "project in their state."
    )


def _payment_clause(payment_mode: Optional[str]) -> Clause:
    """
    Payment clause varies by Agreement payment mode.

    payment_mode:
      - "escrow" -> escrow funded + milestone approval + 72-hour auto-release
      - "direct" -> pay-now invoices (Stripe Checkout) with no escrow hold
    """
    pm = (payment_mode or "").strip().lower()

    if pm == "direct":
        return (
            "Payment (Direct Pay)",
            "This Agreement uses Direct Pay. Customer will pay invoices issued by Contractor through a secure Stripe "
            "Checkout link provided via the platform. Funds are transmitted directly to Contractor at payment time; "
            "the platform does not hold escrow funds for Direct Pay invoices.\n\n"
            "Invoices are due upon receipt unless the parties agree otherwise in writing. If Customer disputes an invoice, "
            "Customer should submit the dispute through the platform before paying whenever possible. If payment has "
            "already been made, any refund, adjustment, or chargeback will be handled under applicable law, the payment "
            "processor’s rules, and this Agreement’s dispute resolution provisions."
        )

    # default to escrow
    return (
        "Payment & Escrow",
        "Payments are funded to escrow and released per approved milestones. After a milestone is submitted for approval, "
        "Customer will have seventy-two (72) hours to approve or dispute through the platform. If no response is received "
        "within 72 hours, funds for that milestone may be automatically released."
    )


def build_legal_notices(
    project_state: Optional[str] = None,
    payment_mode: Optional[str] = None,
) -> List[Clause]:
    """
    Returns ordered (title, body) pairs to render in both preview and final PDFs.

    IMPORTANT:
    - These are CONTRACTOR ↔ CUSTOMER agreement clauses.
    - This list intentionally excludes MyHomeBro platform Terms of Service / Privacy Policy text.

    payment_mode should match Agreement.payment_mode:
      - "escrow" (default)
      - "direct"
    """
    clauses: List[Clause] = []

    # 1) E-Sign Consent
    clauses.append((
        "Electronic Signatures & Records",
        "The parties consent to do business electronically and agree that electronic signatures and records have the "
        "same force and effect as wet ink signatures, that they can download or print records, and that they may withdraw "
        "consent by written notice prior to signing."
    ))

    # 2) Independent Contractor
    clauses.append((
        "Independent Contractor",
        "Contractor is an independent contractor and not an employee, agent, partner, or joint venturer of the Customer. "
        "Contractor retains exclusive control over means, methods, personnel, and safety."
    ))

    # 3) Workforce, Sub-Accounts & Delegation of Work
    clauses.append((
        "Workforce, Sub-Accounts & Delegation of Work",
        "Contractor may assign or delegate portions of the work to its employees, crew members, subcontractors, or other "
        "personnel, including individuals who access the platform through Contractor-managed sub-accounts. Any such "
        "personnel act solely on behalf of Contractor, and their acts and omissions are deemed the acts and omissions "
        "of Contractor for purposes of this Agreement.\n\n"
        "Nothing in this Agreement creates an employment, agency, or joint-venture relationship between (a) Customer and "
        "any employee, crew member, or subcontractor of Contractor, or (b) the platform and any such person. Customer is "
        "not the employer of Contractor’s workforce and does not provide wages, benefits, workers’ compensation coverage, "
        "or tax withholdings for them.\n\n"
        "Contractor is solely responsible for selecting, training, and supervising its workforce; ensuring that all "
        "personnel performing work are properly licensed or qualified as required by law; complying with applicable labor, "
        "employment, wage-and-hour, tax, safety, and workers’ compensation laws; and ensuring that all work is performed "
        "in a safe and workmanlike manner consistent with applicable codes and industry standards.\n\n"
        "Customer is responsible for providing reasonably safe access to the property, disclosing known hazards, and "
        "maintaining appropriate property and liability insurance for conditions or hazards under Customer’s control."
    ))

    # 4) Change Orders
    clauses.append((
        "Changes",
        "Any changes to scope, materials, or schedule must be documented in a signed Change Order stating the impact on "
        "price and time. No verbal change is binding."
    ))

    # 5) Permits, Codes, Site Access
    clauses.append((
        "Permits & Compliance",
        "Unless otherwise stated in writing, Contractor is responsible for performing work in accordance with applicable "
        "codes and for obtaining required permits. Customer will provide reasonable site access, utilities, and a safe "
        "work environment during normal working hours. It is the Customer’s responsibility to verify with the Contractor "
        "— in writing — who is responsible for securing specific permits and inspections for this project."
    ))

    # 6) Unforeseen Conditions
    clauses.append((
        "Concealed/Unforeseen Conditions",
        "If concealed, hazardous, or unexpected site conditions are discovered, Contractor will notify Customer. Price "
        "and schedule will be equitably adjusted via Change Order."
    ))

    # 7) Materials, Title, Risk
    clauses.append((
        "Title & Risk",
        "Title to materials passes to Customer upon payment for the applicable milestone. Contractor bears risk of loss "
        "for Contractor-owned materials until installation or payment, whichever is later."
    ))

    # 8) Payment clause (✅ now conditional)
    clauses.append(_payment_clause(payment_mode))

    # 9) Payment Processing & Platform Fees
    clauses.append((
        "Payment Processing & Platform Fees",
        "Payments made under this Agreement may be processed by a third-party payment processor. The total project price "
        "shown in this Agreement represents the amount owed by the Customer for the work described. Separate payment "
        "processing fees or platform/escrow service fees may be disclosed on the funding, checkout, or invoice screens at "
        "the time of payment and may reduce the net amount received by the Contractor."
    ))

    # 10) Dispute Resolution
    clauses.append((
        "Dispute Resolution",
        "Any dispute the parties cannot resolve through the platform will first be submitted to good-faith mediation. If "
        "unresolved within thirty (30) days of a written mediation request, the dispute shall be resolved by binding, "
        "individual arbitration administered by a recognized arbitration provider. The arbitration provider may conduct "
        "conferences and hearings by video or teleconference unless in-person proceedings are required by law."
    ))

    # 11) Limitation of Liability
    clauses.append((
        "Limitation of Liability",
        "Neither party is liable for indirect, incidental, special, or consequential damages. Except for bodily injury or "
        "property damage caused by negligence, Contractor’s aggregate liability for claims arising from the work will not "
        "exceed the amounts paid for the specific portion of work giving rise to the claim."
    ))

    # 12) Insurance
    clauses.append((
        "Insurance",
        "Contractor represents it maintains commercially reasonable insurance appropriate for the work. Customer must "
        "request proof of insurance directly from Contractor."
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

    # 15) Photo Authorization (optional)
    clauses.append((
        "Photo Authorization (Optional)",
        "Customer grants Contractor permission to photograph completed work for portfolio or marketing, excluding any "
        "personally identifiable information. This authorization is optional and may be revoked by written notice prior to publication."
    ))

    # 16) Confidentiality
    clauses.append((
        "Confidentiality",
        "Each party will keep the other’s non-public information confidential and use it only to perform this Agreement, "
        "except where disclosure is required by law."
    ))

    # 17) Entire Agreement
    clauses.append((
        "Entire Agreement",
        "This document and its signed Change Orders constitute the entire agreement between Contractor and Customer for "
        "the work described."
    ))

    # 18) Notices
    clauses.append((
        "Notices",
        "Legal notices shall be sent via the platform message center and to the email addresses on file for each party and "
        "are deemed received when sent."
    ))

    # 19) Cooling-Off / Cancellation (state-aware)
    clauses.append(_cooling_off_clause(project_state))

    return clauses
