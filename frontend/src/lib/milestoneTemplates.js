// frontend/src/lib/milestoneTemplates.js
// Pure data — no React, no API calls.
// Each milestone: title, description, start_offset_days, duration_days, materials_hint, pricing_advisory.
// Commercial milestones add: drawSchedule (boolean), holdPoint (string|null).

export const MILESTONE_PATTERNS = {
  roofing: [
    {
      title: "Site setup and safety prep",
      description: "Protect landscaping, staging area, and property. Stage shingles, underlayment, and safety equipment. Confirm roof access, pitch, and any permit requirements.",
      start_offset_days: 0,
      duration_days: 1,
      materials_hint: "Tarps, fall protection, ladder stabilizers, staging supplies, dumpster",
      pricing_advisory: true,
    },
    {
      title: "Remove existing roofing",
      description: "Strip existing shingles, underlayment, and damaged flashing. Inspect and document deck condition. Perform any required deck repairs before new system install.",
      start_offset_days: 1,
      duration_days: 1,
      materials_hint: "Dumpster, nail puller, deck screws, sheathing patches as needed",
      pricing_advisory: true,
    },
    {
      title: "Install new roofing system",
      description: "Install drip edge, ice-and-water shield, synthetic underlayment, starter strips, shingles, ridge cap, step flashing, and all penetration flashing. Complete weatherproofing details.",
      start_offset_days: 2,
      duration_days: 2,
      materials_hint: "Shingles, underlayment, drip edge, flashing, ridge cap, roofing nails, sealant, vents",
      pricing_advisory: true,
    },
    {
      title: "Final inspection, magnet sweep, and cleanup",
      description: "Complete magnet sweep of lawn and driveway. Remove dumpster and staging materials. Walk the completed roof and address any punch list items. Confirm customer sign-off.",
      start_offset_days: 4,
      duration_days: 1,
      materials_hint: "Magnetic sweeper, cleanup supplies, final documentation",
      pricing_advisory: true,
    },
  ],

  flooring: [
    {
      title: "Subfloor prep and material staging",
      description: "Remove existing flooring or prepare substrate. Check and repair subfloor flatness, fastening, and moisture levels. Acclimate new flooring materials per manufacturer requirements.",
      start_offset_days: 0,
      duration_days: 1,
      materials_hint: "Floor scraper, floor leveling compound, moisture barrier, subfloor fasteners",
      pricing_advisory: true,
    },
    {
      title: "Layout and primary installation",
      description: "Establish reference lines and layout. Install primary flooring field with correct expansion gaps, adhesive, nails, or click-lock per product spec.",
      start_offset_days: 1,
      duration_days: 2,
      materials_hint: "Flooring planks or tile, adhesive or staples, underlayment, spacers",
      pricing_advisory: true,
    },
    {
      title: "Trim, transitions, and detailing",
      description: "Install base molding, shoe molding, thresholds, and transition strips. Complete all perimeter cuts, stair nosing, and feature transitions.",
      start_offset_days: 3,
      duration_days: 1,
      materials_hint: "Base molding, shoe molding, transition strips, finish nails, caulk",
      pricing_advisory: true,
    },
    {
      title: "Final inspection and cleanup",
      description: "Clean finished floor surface. Inspect field, seams, transitions, and edges. Address any punch list items. Walk the customer through the completed installation.",
      start_offset_days: 4,
      duration_days: 1,
      materials_hint: "Floor-safe cleaner, cleanup supplies, documentation",
      pricing_advisory: true,
    },
  ],

  hvac: [
    {
      title: "Site assessment and equipment staging",
      description: "Confirm equipment specifications, utility connections, and access requirements. Stage replacement equipment and materials. Obtain any required permits.",
      start_offset_days: 0,
      duration_days: 1,
      materials_hint: "Equipment staging, permit documentation, utility confirmation tools",
      pricing_advisory: true,
    },
    {
      title: "System removal and rough-in preparation",
      description: "Disconnect and remove existing equipment per code. Prepare refrigerant recovery if applicable. Inspect and prepare ductwork connections, electrical, and drainage.",
      start_offset_days: 1,
      duration_days: 1,
      materials_hint: "Refrigerant recovery equipment, disconnect materials, ductwork sealing supplies",
      pricing_advisory: true,
    },
    {
      title: "New system installation and connections",
      description: "Install new HVAC unit(s), air handler, or components. Complete all refrigerant, electrical, ductwork, drain, and control connections per manufacturer and code requirements.",
      start_offset_days: 2,
      duration_days: 2,
      materials_hint: "HVAC unit, refrigerant, electrical wiring, condensate drain, ductwork fittings, thermostat",
      pricing_advisory: true,
    },
    {
      title: "Start-up, testing, and customer walkthrough",
      description: "Commission the system, verify airflow, test thermostat operation, and confirm comfort levels. Walk the customer through controls and maintenance requirements.",
      start_offset_days: 4,
      duration_days: 1,
      materials_hint: "Manometer, thermometer, startup documentation, filter",
      pricing_advisory: true,
    },
  ],

  remodel: [
    {
      title: "Demo, protection, and rough-in",
      description: "Protect adjacent areas and surfaces. Remove existing finishes, fixtures, or cabinetry as required. Complete any framing, plumbing, or electrical rough-in changes before closing walls.",
      start_offset_days: 0,
      duration_days: 3,
      materials_hint: "Protection materials, dumpster, rough framing lumber, rough plumbing and electrical supplies",
      pricing_advisory: true,
    },
    {
      title: "Core work and primary installs",
      description: "Install major components: cabinets, tile backer, drywall, flooring substrate, or structural elements per the scope. Complete all trades before covering walls or floors.",
      start_offset_days: 3,
      duration_days: 4,
      materials_hint: "Cabinets or primary components, drywall, cement board, primary fasteners and adhesives",
      pricing_advisory: true,
    },
    {
      title: "Finishes, fixtures, and trim",
      description: "Install finish tile, countertops, fixtures, trim, hardware, and final paint. Complete all finish selections and address fit-and-finish details before closeout.",
      start_offset_days: 7,
      duration_days: 3,
      materials_hint: "Tile, countertop, fixtures, paint, trim, hardware, caulk, grout",
      pricing_advisory: true,
    },
    {
      title: "Punch list, cleanup, and handoff",
      description: "Complete all punch list items, clean the finished space, remove protection, and walk the customer through the completed remodel.",
      start_offset_days: 10,
      duration_days: 1,
      materials_hint: "Cleanup supplies, touch-up paint, final punch list documentation",
      pricing_advisory: true,
    },
  ],

  commercial_gc: [
    {
      title: "Mobilization and site establishment",
      description: "Complete site logistics, temporary facilities, utility coordination, and permit posting. Establish safety plan, staging zones, and subcontractor coordination protocols.",
      start_offset_days: 0,
      duration_days: 3,
      materials_hint: "Temporary fencing, site signage, safety equipment, permit documentation",
      pricing_advisory: true,
      drawSchedule: true,
      holdPoint: null,
    },
    {
      title: "Demolition and site preparation",
      description: "Perform selective or full demolition per drawings. Document existing conditions. Coordinate hazmat abatement if required. Prepare substrate for structural and MEP rough-in.",
      start_offset_days: 3,
      duration_days: 7,
      materials_hint: "Dumpsters, demo equipment, abatement materials if required",
      pricing_advisory: true,
      drawSchedule: true,
      holdPoint: "Owner inspection required before enclosing walls",
    },
    {
      title: "Structural, MEP rough-in, and inspections",
      description: "Complete structural framing, mechanical, electrical, and plumbing rough-in per drawings. Schedule and pass all required inspections before closing walls or floors.",
      start_offset_days: 10,
      duration_days: 14,
      materials_hint: "Structural steel or lumber, MEP rough materials, conduit, pipe, ductwork",
      pricing_advisory: true,
      drawSchedule: true,
      holdPoint: "AHJ rough-in inspection required before proceeding",
    },
    {
      title: "Finishes, fixtures, and systems commissioning",
      description: "Install all finish materials, millwork, fixtures, and building systems. Commission HVAC, electrical, plumbing, and life safety systems. Coordinate punch list with owner's representative.",
      start_offset_days: 24,
      duration_days: 14,
      materials_hint: "Finish flooring, drywall, paint, fixtures, hardware, commissioning documentation",
      pricing_advisory: true,
      drawSchedule: true,
      holdPoint: null,
    },
    {
      title: "Final inspection, punch list, and substantial completion",
      description: "Achieve substantial completion, obtain Certificate of Occupancy, deliver O&M manuals, and complete owner training. Process final draw and retainage release per contract.",
      start_offset_days: 38,
      duration_days: 5,
      materials_hint: "Punch list supplies, O&M documentation, CO application",
      pricing_advisory: true,
      drawSchedule: true,
      holdPoint: "Substantial completion sign-off required for final draw",
    },
  ],

  electrical: [
    {
      title: "Scope confirmation and permit pull",
      description: "Confirm load calculations, circuit layout, and panel capacity. Pull required electrical permits. Schedule utility coordination if service upgrade is involved.",
      start_offset_days: 0,
      duration_days: 1,
      materials_hint: "Permit documentation, load calculation worksheet",
      pricing_advisory: true,
    },
    {
      title: "Rough-in wiring and conduit",
      description: "Run conduit or wire through walls, ceilings, or crawlspaces. Install boxes, panels, breakers, and sub-panels as required. Leave for inspection before covering.",
      start_offset_days: 1,
      duration_days: 2,
      materials_hint: "Wire, conduit, boxes, breakers, panel, staples, connectors",
      pricing_advisory: true,
    },
    {
      title: "Devices, fixtures, and trim-out",
      description: "Install all outlets, switches, fixtures, and finish devices. Complete panel labeling and directory. Verify all circuits and GFCIs.",
      start_offset_days: 3,
      duration_days: 2,
      materials_hint: "Outlets, switches, cover plates, fixtures, GFCIs, panel directory",
      pricing_advisory: true,
    },
    {
      title: "Final test, inspection, and sign-off",
      description: "Test all circuits under load. Pass final electrical inspection. Walk the customer through panel and key circuit locations.",
      start_offset_days: 5,
      duration_days: 1,
      materials_hint: "Multimeter, tester, inspection documentation",
      pricing_advisory: true,
    },
  ],

  plumbing: [
    {
      title: "Scope review and rough-in preparation",
      description: "Confirm fixture locations, drain and supply rough-in measurements, and any permit requirements. Shut off and isolate existing systems as needed.",
      start_offset_days: 0,
      duration_days: 1,
      materials_hint: "Shutoff tools, permit documentation, rough-in template",
      pricing_advisory: true,
    },
    {
      title: "Rough-in drain, waste, and supply",
      description: "Run drain, waste, and vent piping and supply lines to rough-in locations. Pressure test supply and verify drain flow before wall closure.",
      start_offset_days: 1,
      duration_days: 2,
      materials_hint: "DWV pipe and fittings, supply lines, solder or PEX fittings, hangers, insulation",
      pricing_advisory: true,
    },
    {
      title: "Fixture trim-out and connection",
      description: "Connect all fixtures: toilets, sinks, tub/shower valves, dishwasher, water heater, or appliances. Test each connection for leaks and proper function.",
      start_offset_days: 3,
      duration_days: 2,
      materials_hint: "Fixtures, supply stops, wax rings, caulk, supply lines, angle stops",
      pricing_advisory: true,
    },
    {
      title: "Final test and customer walkthrough",
      description: "Run all fixtures simultaneously, check for leaks throughout, verify hot/cold orientation, and walk the customer through shutoffs and key maintenance points.",
      start_offset_days: 5,
      duration_days: 1,
      materials_hint: "Pressure gauge, teflon tape, final leak check supplies",
      pricing_advisory: true,
    },
  ],

  painting: [
    {
      title: "Surface prep and protection",
      description: "Mask windows, trim, and floors. Protect furniture and fixtures. Fill holes, cracks, and imperfections. Sand surfaces and apply primer where needed.",
      start_offset_days: 0,
      duration_days: 1,
      materials_hint: "Painter's tape, drop cloths, spackle, sandpaper, primer, masks",
      pricing_advisory: true,
    },
    {
      title: "Ceiling and wall coating",
      description: "Apply ceiling coat first, then wall coats (typically 2 coats) in the selected color and finish. Maintain wet edge and consistent application.",
      start_offset_days: 1,
      duration_days: 2,
      materials_hint: "Interior paint, rollers, brushes, trays, extension poles",
      pricing_advisory: true,
    },
    {
      title: "Trim, doors, and detail work",
      description: "Paint all trim, doors, casings, and accent areas with appropriate finish. Cut in edges and complete any specialty finish or second-color work.",
      start_offset_days: 3,
      duration_days: 1,
      materials_hint: "Trim paint, angled brushes, foam rollers, painter's tape",
      pricing_advisory: true,
    },
    {
      title: "Touch-up, cleanup, and walk-through",
      description: "Address touch-up items from client review. Remove all masking and protection. Clean brushes and tools. Walk the customer through the completed work.",
      start_offset_days: 4,
      duration_days: 1,
      materials_hint: "Touch-up paint, cleanup solvents, garbage bags, final walk-through checklist",
      pricing_advisory: true,
    },
  ],

  landscaping: [
    {
      title: "Site assessment and material staging",
      description: "Walk the site to confirm layout, existing conditions, utility locations, and scope boundaries. Stage all materials and equipment in designated areas.",
      start_offset_days: 0,
      duration_days: 1,
      materials_hint: "Wheel barrow, site marking paint, staging area setup",
      pricing_advisory: true,
    },
    {
      title: "Site clearing and grading",
      description: "Remove existing vegetation, debris, or hardscape as required. Grade and prepare substrate per design for drainage and planting.",
      start_offset_days: 1,
      duration_days: 2,
      materials_hint: "Excavation equipment, loam, topsoil, grading tools",
      pricing_advisory: true,
    },
    {
      title: "Primary installation",
      description: "Install primary landscape elements: plants, sod, irrigation, hardscape, edging, or lighting per the approved plan.",
      start_offset_days: 3,
      duration_days: 3,
      materials_hint: "Plants, mulch, sod, edging, irrigation components, lighting, pavers",
      pricing_advisory: true,
    },
    {
      title: "Final detailing, cleanup, and customer walk-through",
      description: "Complete planting, mulching, and final detailing. Test irrigation or lighting systems. Remove debris and staging materials. Walk the customer through the finished landscape.",
      start_offset_days: 6,
      duration_days: 1,
      materials_hint: "Mulch, cleanup supplies, irrigation test supplies",
      pricing_advisory: true,
    },
  ],

  maintenance: [
    {
      title: "Inspection and scope documentation",
      description: "Assess current condition, document findings, and confirm maintenance scope with the customer. Identify any items requiring repair or deferral.",
      start_offset_days: 0,
      duration_days: 1,
      materials_hint: "Inspection checklist, camera, documentation supplies",
      pricing_advisory: true,
    },
    {
      title: "Primary maintenance work",
      description: "Complete the core maintenance tasks per the agreed scope. Document any findings that require follow-up or are outside the current work order.",
      start_offset_days: 1,
      duration_days: 2,
      materials_hint: "Trade-specific maintenance materials, replacement parts, consumables",
      pricing_advisory: true,
    },
    {
      title: "Final check and report",
      description: "Verify all maintenance tasks are complete. Conduct final system or surface check. Provide the customer with a summary of work performed and any recommended next steps.",
      start_offset_days: 3,
      duration_days: 1,
      materials_hint: "Completion report, cleanup supplies",
      pricing_advisory: true,
    },
  ],

  general: [
    {
      title: "Project setup and site preparation",
      description: "Confirm site access, protect nearby surfaces, review scope assumptions, prepare tools and materials, and identify any conditions that may affect the work.",
      start_offset_days: 0,
      duration_days: 1,
      materials_hint: "Safety equipment, surface protection materials, staging supplies",
      pricing_advisory: true,
    },
    {
      title: "Core work phase 1",
      description: "Begin the primary work and complete the first major deliverable. Verify fit, alignment, and progress against scope before proceeding.",
      start_offset_days: 1,
      duration_days: 3,
      materials_hint: "Primary project materials and structural components",
      pricing_advisory: true,
    },
    {
      title: "Finish work and quality review",
      description: "Complete all finish details and inspect systems or surfaces for quality. Address any punch list items before the final walkthrough.",
      start_offset_days: 4,
      duration_days: 2,
      materials_hint: "Finish materials, trim, sealants, touch-up supplies",
      pricing_advisory: true,
    },
    {
      title: "Cleanup, walkthrough, and closeout",
      description: "Remove all debris and materials, clean the work area, walk the client through the completed work, and collect final sign-off.",
      start_offset_days: 6,
      duration_days: 1,
      materials_hint: "Cleanup supplies, waste bags, final punch list documentation",
      pricing_advisory: true,
    },
  ],
};

const TYPE_KEY_MAP = {
  roofing: "roofing",
  roof: "roofing",
  flooring: "flooring",
  floor: "flooring",
  "hardwood floors": "flooring",
  lvp: "flooring",
  tile: "flooring",
  hvac: "hvac",
  "air conditioning": "hvac",
  heating: "hvac",
  remodel: "remodel",
  renovation: "remodel",
  "kitchen remodel": "remodel",
  "bathroom remodel": "remodel",
  "commercial gc": "commercial_gc",
  commercial_gc: "commercial_gc",
  "general contractor": "commercial_gc",
  electrical: "electrical",
  electric: "electrical",
  plumbing: "plumbing",
  plumber: "plumbing",
  painting: "painting",
  paint: "painting",
  landscaping: "landscaping",
  landscape: "landscaping",
  "lawn care": "landscaping",
  maintenance: "maintenance",
  "recurring maintenance": "maintenance",
};

/**
 * Returns the appropriate milestone pattern for the given project type and path.
 * @param {string|null} projectType  e.g. "roofing", "flooring", "commercial_gc"
 * @param {string|null} projectPath  "residential" | "commercial"
 * @returns {Array} Array of milestone objects
 */
export function getMilestonePattern(projectType, projectPath) {
  const typeLower = (projectType || "").toLowerCase().trim();
  const path = (projectPath || "").toLowerCase().trim();

  // Commercial path with GC scope → commercial_gc pattern
  if (path === "commercial" && (typeLower === "commercial_gc" || typeLower === "commercial gc")) {
    return MILESTONE_PATTERNS.commercial_gc;
  }

  // Exact key lookup
  if (MILESTONE_PATTERNS[typeLower]) {
    return MILESTONE_PATTERNS[typeLower];
  }

  // Alias lookup
  const mappedKey = TYPE_KEY_MAP[typeLower];
  if (mappedKey && MILESTONE_PATTERNS[mappedKey]) {
    return MILESTONE_PATTERNS[mappedKey];
  }

  // Partial match against known keys
  for (const [alias, key] of Object.entries(TYPE_KEY_MAP)) {
    if (typeLower.includes(alias) || alias.includes(typeLower)) {
      if (MILESTONE_PATTERNS[key]) return MILESTONE_PATTERNS[key];
    }
  }

  return MILESTONE_PATTERNS.general;
}
