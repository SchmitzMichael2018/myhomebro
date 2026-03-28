from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from projects.models_compliance import StateTradeLicenseRequirement
from projects.services.compliance import normalize_trade_key


@dataclass(frozen=True)
class LicensingSeedRow:
    state_code: str
    state_name: str
    trade_key: str
    trade_label: str
    license_required: bool
    insurance_required: bool
    issuing_authority_name: str
    authority_short_name: str
    official_lookup_url: str
    source_type: str
    rule_notes: str = ""
    exemption_notes: str = ""
    source_reference: str = ""


SEED_ROWS: list[LicensingSeedRow] = [
    LicensingSeedRow("TX", "Texas", "general_contractor", "General Contractor / General Construction", False, True, "Texas does not issue a single statewide general contractor license.", "Statewide", "https://www.tdlr.texas.gov/", "manual", "Texas does not have a single statewide general contractor license, but specialized trades and local rules can still apply.", "Local permits and municipal requirements may still apply.", "TDLR + state portal review"),
    LicensingSeedRow("TX", "Texas", "electrical", "Electrical", True, True, "Texas Department of Licensing and Regulation", "TDLR", "https://www.tdlr.texas.gov/electricians/", "portal", "Electrical work typically requires a state-issued electrical license.", "", "TDLR electricians"),
    LicensingSeedRow("TX", "Texas", "hvac", "HVAC / Air Conditioning & Refrigeration", True, True, "Texas Department of Licensing and Regulation", "TDLR", "https://www.tdlr.texas.gov/acr/", "portal", "Air conditioning and refrigeration contractors typically need a TDLR license.", "", "TDLR ACR"),
    LicensingSeedRow("TX", "Texas", "plumbing", "Plumbing", True, True, "Texas State Board of Plumbing Examiners", "TSBPE", "https://tsbpe.texas.gov/", "portal", "Plumbing work typically requires a Texas plumbing license.", "", "TSBPE"),
    LicensingSeedRow("TX", "Texas", "roofing", "Roofing", False, True, "Texas does not issue a statewide roofing contractor license.", "Statewide", "https://www.tdi.texas.gov/", "manual", "Texas does not issue a statewide roofing contractor license, but insurance and local registration expectations are common.", "Local registration or storm-restoration rules may apply.", "TDI + state portal review"),
    LicensingSeedRow("TX", "Texas", "painting", "Painting", False, True, "Texas does not issue a statewide painting license.", "Statewide", "https://www.tdlr.texas.gov/", "manual", "Painting usually does not require a statewide license in Texas.", "", "State portal review"),
    LicensingSeedRow("TX", "Texas", "handyman", "Handyman / General Repair", False, True, "Texas does not issue a statewide handyman license.", "Statewide", "https://www.tdlr.texas.gov/", "manual", "General repair work typically does not require a statewide license in Texas, but trade-specific work can trigger licensing.", "Electrical, plumbing, and HVAC tasks can still require specialized licenses.", "State portal review"),
    LicensingSeedRow("CA", "California", "general_contractor", "General Contractor / General Construction", True, True, "California Contractors State License Board", "CSLB", "https://www.cslb.ca.gov/", "portal", "California generally requires a CSLB contractor license for projects over the state threshold.", "Projects under the statutory threshold may be exempt.", "CSLB"),
    LicensingSeedRow("CA", "California", "electrical", "Electrical", True, True, "California Contractors State License Board", "CSLB", "https://www.cslb.ca.gov/", "portal", "Electrical contracting typically requires a CSLB license classification.", "", "CSLB"),
    LicensingSeedRow("CA", "California", "hvac", "HVAC / Warm-Air Heating, Ventilating & Air-Conditioning", True, True, "California Contractors State License Board", "CSLB", "https://www.cslb.ca.gov/", "portal", "HVAC contracting typically requires an appropriate CSLB classification.", "", "CSLB"),
    LicensingSeedRow("CA", "California", "plumbing", "Plumbing", True, True, "California Contractors State License Board", "CSLB", "https://www.cslb.ca.gov/", "portal", "Plumbing contracting typically requires a CSLB classification.", "", "CSLB"),
    LicensingSeedRow("CA", "California", "roofing", "Roofing", True, True, "California Contractors State License Board", "CSLB", "https://www.cslb.ca.gov/", "portal", "Roofing contracting typically requires a CSLB classification.", "", "CSLB"),
    LicensingSeedRow("CA", "California", "painting", "Painting", True, True, "California Contractors State License Board", "CSLB", "https://www.cslb.ca.gov/", "portal", "Painting contractors typically require a CSLB classification for covered work.", "Small projects below the state threshold may be exempt.", "CSLB"),
    LicensingSeedRow("CA", "California", "handyman", "Handyman / General Repair", False, True, "California Contractors State License Board", "CSLB", "https://www.cslb.ca.gov/", "manual", "Handyman work may be exempt only for projects below the California threshold and outside licensed specialty trades.", "Threshold and specialty-trade limits matter.", "CSLB threshold summary"),
    LicensingSeedRow("FL", "Florida", "general_contractor", "General Contractor / General Construction", True, True, "Florida Department of Business and Professional Regulation", "DBPR", "https://www2.myfloridalicense.com/", "portal", "Florida generally requires licensed contractors for statewide contracting categories.", "", "DBPR"),
    LicensingSeedRow("FL", "Florida", "electrical", "Electrical", True, True, "Florida Department of Business and Professional Regulation", "DBPR", "https://www2.myfloridalicense.com/", "portal", "Electrical contracting typically requires a Florida license.", "", "DBPR"),
    LicensingSeedRow("FL", "Florida", "hvac", "HVAC", True, True, "Florida Department of Business and Professional Regulation", "DBPR", "https://www2.myfloridalicense.com/", "portal", "HVAC contracting typically requires a Florida license.", "", "DBPR"),
    LicensingSeedRow("FL", "Florida", "plumbing", "Plumbing", True, True, "Florida Department of Business and Professional Regulation", "DBPR", "https://www2.myfloridalicense.com/", "portal", "Plumbing contracting typically requires a Florida license.", "", "DBPR"),
    LicensingSeedRow("NY", "New York", "general_contractor", "General Contractor / General Construction", False, True, "New York does not issue one statewide general contractor license.", "Statewide", "https://dos.ny.gov/", "manual", "New York does not issue a single statewide general contractor license; local licensing can apply.", "City and county requirements can be important.", "NY state + local review"),
    LicensingSeedRow("NY", "New York", "electrical", "Electrical", False, True, "Electrical licensing is often local in New York.", "Local", "https://dos.ny.gov/", "manual", "Electrical licensing is commonly handled locally rather than through one statewide contractor license.", "Local jurisdiction review recommended.", "NY local licensing review"),
]


def seed_state_trade_license_requirements() -> dict[str, int]:
    created = 0
    updated = 0
    today = date.today()
    for row in SEED_ROWS:
        defaults = {
            "state_name": row.state_name,
            "trade_label": row.trade_label,
            "license_required": row.license_required,
            "insurance_required": row.insurance_required,
            "issuing_authority_name": row.issuing_authority_name,
            "authority_short_name": row.authority_short_name,
            "official_lookup_url": row.official_lookup_url,
            "source_type": row.source_type,
            "rule_notes": row.rule_notes,
            "exemption_notes": row.exemption_notes,
            "source_reference": row.source_reference,
            "active": True,
            "last_reviewed_at": today,
        }
        obj, was_created = StateTradeLicenseRequirement.objects.update_or_create(
            state_code=row.state_code,
            trade_key=normalize_trade_key(row.trade_key),
            defaults=defaults,
        )
        if was_created:
            created += 1
        elif obj.pk:
            updated += 1
    return {"created": created, "updated": updated}
