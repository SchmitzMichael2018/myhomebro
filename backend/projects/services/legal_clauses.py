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

    # 4) Workforce, Sub-Accounts & Delegation of Work (NEW)
    clauses.append((
        "Workforce, Sub-Accounts & Delegation of Work",
        "Contractor may assign or delegate portions of the work to its employees, crew members, subcontractors, or other "
        "personnel, including individuals who access the MyHomeBro platform through Contractor-managed sub-accounts. Any "
        "such personnel act solely on behalf of Contractor, and their acts and omissions are deemed the acts and omissions "
        "of Contractor for purposes of this Agreement.\n\n"
        "Nothing in this Agreement creates an employment, agency, or joint-venture relationship between (a) Homeowner and "
        "any employee, crew member, or subcontractor of Contractor, or (b) MyHomeBro and any such person. Homeowner and "
        "MyHomeBro are not employers of Contractor’s workforce, do not hire, fire, schedule, or supervise such personnel, "
        "and do not provide wages, benefits, workers’ compensation coverage, or tax withholdings for them.\n\n"
        "Contractor is solely responsible for selecting, training, and supervising its workforce; ensuring that all "
        "personnel performing work are properly licensed or qualified as required by law; complying with applicable labor, "
        "employment, wage-and-hour, tax, safety, and workers’ compensation laws; and ensuring that all work is performed "
        "in a safe and workmanlike manner consistent with applicable codes and industry standards. Any claims, disputes, "
        "or obligations arising out of Contractor’s relationship with its personnel (including wages, benefits, safety, "
        "discipline, termination, and similar issues) are solely between Contractor and those personnel.\n\n"
        "As between the parties, jobsite safety in connection with the work performed by Contractor’s workforce is "
        "primarily Contractor’s responsibility, including safety of its employees, crew members, and subcontractors. "
        "Contractor is responsible for complying with workplace-safety laws and regulations (for example, OSHA-type "
        "requirements), using appropriate safety practices and equipment, and maintaining commercially reasonable "
        "insurance for its operations. Homeowner is responsible for providing reasonably safe access to the property, "
        "disclosing known hazards, and maintaining appropriate property and liability insurance for conditions or hazards "
        "under Homeowner’s control. To the fullest extent permitted by law, any bodily injury, illness, or accident "
        "involving Contractor’s personnel that arises out of or relates to performance of the work is the responsibility "
        "of Contractor, except to the extent caused by Homeowner’s negligence or intentional misconduct.\n\n"
        "MyHomeBro is a technology platform that facilitates introductions, project documentation, and escrow-style "
        "payments between independent Contractors and Homeowners. MyHomeBro does not perform or supervise construction or "
        "repair work; does not control or direct the means, methods, personnel, or safety practices used by Contractor; "
        "does not provide or verify Contractor’s or its personnel’s training, licensing, background checks, or insurance; "
        "and does not visit, inspect, or control the jobsite. Accordingly, MyHomeBro is not responsible for jobsite "
        "conditions, personal injuries, property damage, or code violations arising out of or relating to the work, and "
        "has no duty to warn about or correct any hazard at the jobsite. To the fullest extent permitted by law, Contractor "
        "and Homeowner agree that any claims related to the work itself or the conduct of Contractor’s workforce will be "
        "asserted against the other party to this Agreement (and not against MyHomeBro), except to the limited extent such "
        "claims are expressly permitted under the platform’s Terms of Service.\n\n"
        "If Homeowner later chooses to directly hire or engage any of Contractor’s personnel outside of this Agreement or "
        "outside of the MyHomeBro platform, such engagement is a separate relationship not governed by this Agreement or "
        "the platform. Homeowner is solely responsible for understanding and complying with any employer- or hirer-related "
        "obligations that may arise under applicable law, including obligations related to wages, taxes, insurance, and "
        "safety, and MyHomeBro has no responsibility or liability arising from any such separate engagement."
    ))

    # 5) Change Orders
    clauses.append((
        "Changes",
        "Any changes to scope, materials, or schedule must be documented in a signed Change Order stating the impact on "
        "price and time. No verbal change is binding."
    ))

    # 6) Permits, Codes, Site Access (with Homeowner verification)
    clauses.append((
        "Permits & Compliance",
        "Unless otherwise stated in writing, Contractor is responsible for performing work in accordance with applicable "
        "codes and for obtaining required permits. Homeowner will provide reasonable site access, utilities, and a safe "
        "work environment during normal working hours. It is the Homeowner’s responsibility to verify with the Contractor "
        "— in writing — who is responsible for securing specific permits and inspections for this project."
    ))

    # 7) Unforeseen Conditions
    clauses.append((
        "Concealed/Unforeseen Conditions",
        "If concealed, hazardous, or unexpected site conditions are discovered, Contractor will notify Homeowner. Price "
        "and schedule will be equitably adjusted via Change Order."
    ))

    # 8) Materials, Title, Risk
    clauses.append((
        "Title & Risk",
        "Title to materials passes to Homeowner upon payment for the applicable milestone. Contractor bears risk of loss "
        "for Contractor-owned materials until installation or payment, whichever is later."
    ))

    # 9) Payment & Escrow (72-hour auto-release)
    clauses.append((
        "Payment & Escrow",
        "Payments are funded to escrow and released per approved milestones. After a milestone is submitted for approval, "
        "Homeowner will have seventy-two (72) hours to approve or dispute through the platform. If no response is received "
        "within 72 hours, funds for that milestone may be automatically released. Chargebacks or clawbacks outside the "
        "platform’s dispute process are not permitted."
    ))

    # 10) Payment Processing & Platform Fees (NEW)
    clauses.append((
        "Payment Processing & Platform Fees",
        "Payments made under this Agreement may be processed by a third-party payment processor (such as Stripe, Inc. and "
        "its affiliates) on behalf of MyHomeBro and/or the Contractor. The total project price shown in this Agreement "
        "represents the amount owed by the Homeowner for the work described. Separate payment processing fees, platform "
        "service fees, or escrow program fees may be charged by MyHomeBro and/or the payment processor as disclosed on "
        "the funding, checkout, or invoice screens at the time of payment. These fees do not increase the agreed project "
        "price but may reduce the net amount received by the Contractor after all applicable processing and platform fees "
        "are deducted."
    ))

    # 11) Dispute Resolution (generalized, remote-friendly, initiator’s state unless prohibited)
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

    # 12) Limitation of Liability
    clauses.append((
        "Limitation of Liability",
        "Neither party is liable for indirect, incidental, special, or consequential damages. Except for bodily injury or "
        "property damage caused by negligence, Contractor’s aggregate liability for claims arising from the work will not "
        "exceed the amounts paid for the specific portion of work giving rise to the claim."
    ))

    # 13) Insurance (Homeowner requests proof; MHB doesn’t provide or verify)
    clauses.append((
        "Insurance",
        "Contractor represents it maintains commercially reasonable insurance (e.g., general liability) appropriate for "
        "the work. MyHomeBro does not provide or verify insurance certificates. Homeowner must request proof of insurance "
        "directly from Contractor."
    ))

    # 14) Force Majeure
    clauses.append((
        "Force Majeure",
        "Neither party is liable for delay or failure caused by events beyond reasonable control, including but not limited "
        "to extreme weather, labor actions, supply chain disruption, epidemics, or acts of government. Time for performance "
        "will be extended for the duration of the impact."
    ))

    # 15) Warranty Clarifier
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
