function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeMilestoneDraftKey(value) {
  return safeStr(value).toLowerCase();
}

function normalizeYesNoAnswer(value) {
  const normalized = safeStr(value).toLowerCase();
  if (normalized === "yes" || normalized === "true") return "yes";
  if (normalized === "no" || normalized === "false") return "no";
  return "";
}

function appendMilestoneDetail(baseText, detail) {
  const base = safeStr(baseText);
  const extra = safeStr(detail);
  if (!extra) return base;
  if (!base) return extra;
  const trimmedBase = base.replace(/[.]+$/, "");
  return `${trimmedBase}. ${extra}`;
}

function insertMilestoneRow(rows, index, row) {
  const next = Array.isArray(rows) ? [...rows] : [];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, row);
  return next;
}

function buildDefaultMilestoneAmounts(count, totalBudget) {
  const safeCount = Math.max(1, Number(count || 0));
  const normalizedTotal = Number(totalBudget);
  const fallbackTotal = normalizedTotal > 0 ? normalizedTotal : safeCount <= 4 ? 4000 : 6000;
  const weightSets = {
    4: [0.2, 0.35, 0.3, 0.15],
    5: [0.12, 0.18, 0.28, 0.26, 0.16],
    6: [0.1, 0.15, 0.2, 0.2, 0.2, 0.15],
    7: [0.08, 0.12, 0.16, 0.18, 0.18, 0.16, 0.12],
  };
  const weights = weightSets[safeCount] || Array.from({ length: safeCount }, () => 1 / safeCount);
  let allocated = 0;
  return weights.map((weight, idx) => {
    if (idx === weights.length - 1) {
      return Number((fallbackTotal - allocated).toFixed(2));
    }
    const next = Number((fallbackTotal * weight).toFixed(2));
    allocated += next;
    return next;
  });
}

export function buildClarificationAwareMilestoneNotes(answers = {}) {
  const lines = [];

  const mappings = [
    ["layout_changes", "Layout changes required"],
    ["wet_area_tile", "Wet-area tile and waterproofing included"],
    ["cabinet_scope", "Cabinet scope included"],
    ["demo_required", "Existing materials require removal first"],
    ["hardware_included", "Hardware, fillers, and trim included"],
    ["connection_ready", "Utilities and hookups ready on arrival"],
    ["haul_away_existing", "Old appliances require disconnect or haul-away"],
    ["tear_off_scope", "Full tear-off included"],
    ["decking_allowance", "Minor decking repair allowed if needed"],
    ["subfloor_prep", "Subfloor prep or leveling included"],
  ];

  for (const [key, label] of mappings) {
    const normalized = normalizeYesNoAnswer(answers?.[key]);
    if (!normalized) continue;
    lines.push(`${label}: ${normalized === "yes" ? "Yes" : "No"}.`);
  }

  const textFields = [
    ["finish_scope_notes", "Finish scope notes"],
    ["fixture_upgrade_notes", "Fixture or finish notes"],
    ["cabinet_style_notes", "Cabinet layout notes"],
    ["appliance_scope_notes", "Appliance notes"],
    ["roofing_notes", "Roofing notes"],
    ["flooring_notes", "Flooring notes"],
  ];

  for (const [key, label] of textFields) {
    const value = safeStr(answers?.[key]);
    if (!value) continue;
    lines.push(`${label}: ${value}.`);
  }

  return lines;
}

export function buildClarificationAwareMilestoneDraft({
  projectType = "",
  projectSubtype = "",
  description = "",
  totalBudget = 0,
  clarificationAnswers = {},
  amountMode = "default",
  baseMilestones = [],
}) {
  const typeKey = normalizeMilestoneDraftKey(projectType);
  const subtypeKey = normalizeMilestoneDraftKey(projectSubtype);
  const text = `${subtypeKey} ${normalizeMilestoneDraftKey(description)}`;
  const layoutChanges = normalizeYesNoAnswer(clarificationAnswers?.layout_changes);
  const cabinetScope = normalizeYesNoAnswer(clarificationAnswers?.cabinet_scope);
  const wetAreaTile = normalizeYesNoAnswer(clarificationAnswers?.wet_area_tile);
  const demoRequired = normalizeYesNoAnswer(clarificationAnswers?.demo_required);
  const hardwareIncluded = normalizeYesNoAnswer(clarificationAnswers?.hardware_included);
  const connectionReady = normalizeYesNoAnswer(clarificationAnswers?.connection_ready);
  const haulAwayExisting = normalizeYesNoAnswer(clarificationAnswers?.haul_away_existing);
  const tearOffScope = normalizeYesNoAnswer(clarificationAnswers?.tear_off_scope);
  const deckingAllowance = normalizeYesNoAnswer(clarificationAnswers?.decking_allowance);
  const subfloorPrep = normalizeYesNoAnswer(clarificationAnswers?.subfloor_prep);
  const finishScopeNotes = safeStr(clarificationAnswers?.finish_scope_notes);
  const fixtureUpgradeNotes = safeStr(clarificationAnswers?.fixture_upgrade_notes);
  const cabinetStyleNotes = safeStr(clarificationAnswers?.cabinet_style_notes);
  const applianceScopeNotes = safeStr(clarificationAnswers?.appliance_scope_notes);
  const roofingNotes = safeStr(clarificationAnswers?.roofing_notes);
  const flooringNotes = safeStr(clarificationAnswers?.flooring_notes);

  let rows = [];

  if (subtypeKey.includes("kitchen remodel")) {
    rows = [
      { title: "Planning & protection", description: "Confirm selections, protect adjacent areas, and stage materials." },
      { title: "Demolition & rough-in", description: "Remove existing finishes and complete rough adjustments for the new layout." },
      { title: "Cabinets & surfaces", description: "Install cabinetry, countertops, and major kitchen surfaces." },
      { title: "Fixtures & appliances", description: "Set fixtures, connect appliances, and complete trim details." },
      { title: "Punch list & walkthrough", description: "Finish punch items, final cleanup, and customer walkthrough." },
    ];
    if (layoutChanges === "yes") {
      rows = insertMilestoneRow(rows, 1, {
        title: "Layout review & utility changes",
        description:
          "Confirm layout changes, coordinate updated appliance locations, and complete the major utility adjustments before finish installation.",
      });
      rows[2] = {
        title: "Selective demolition & rough-in",
        description:
          "Remove existing finishes and complete rough framing, plumbing, or electrical work needed for the updated kitchen layout.",
      };
    }
    const cabinetsIndex = rows.findIndex((row) => row.title === "Cabinets & surfaces");
    if (cabinetScope === "yes" && cabinetsIndex >= 0) {
      rows[cabinetsIndex] = {
        title: "Cabinet installation",
        description:
          "Install cabinetry, secure boxes in the planned layout, and prepare for final countertop or trim work.",
      };
      rows = insertMilestoneRow(rows, cabinetsIndex + 1, {
        title: "Countertops & surface finishes",
        description:
          "Install countertops, backsplash, and the major kitchen surface finishes that complete the cabinetry phase.",
      });
    } else if (cabinetScope === "no" && cabinetsIndex >= 0) {
      rows[cabinetsIndex] = {
        title: "Countertops, surfaces & finishes",
        description:
          "Complete countertop work, backsplash or wall finishes, and other major kitchen surface upgrades without cabinet replacement.",
      };
    }
    if (finishScopeNotes) {
      const finishRowIndex =
        rows.findIndex((row) => row.title === "Countertops & surface finishes") >= 0
          ? rows.findIndex((row) => row.title === "Countertops & surface finishes")
          : rows.findIndex((row) => row.title === "Fixtures & appliances");
      rows[finishRowIndex].description = appendMilestoneDetail(
        rows[finishRowIndex].description,
        `Included finish scope: ${finishScopeNotes}.`
      );
    }
  } else if (subtypeKey.includes("bathroom remodel")) {
    rows = [
      { title: "Protection & demolition", description: "Protect nearby finishes and remove existing bathroom components." },
      { title: "Rough plumbing & electrical", description: "Complete rough adjustments needed for the updated bathroom layout." },
      { title: "Walls, waterproofing & tile", description: "Prep surfaces, waterproof wet areas, and install tile finishes." },
      { title: "Vanity, fixtures & trim", description: "Install vanity, fixtures, accessories, and finish details." },
      { title: "Final cleanup & walkthrough", description: "Complete punch work, cleanup, and final customer review." },
    ];
    if (layoutChanges === "yes") {
      rows = insertMilestoneRow(rows, 1, {
        title: "Layout changes & rough-ins",
        description:
          "Complete plumbing and electrical rough changes needed for the updated bathroom layout before finish work starts.",
      });
    }
    const wetAreaIndex = rows.findIndex((row) => row.title === "Walls, waterproofing & tile");
    if (wetAreaTile === "yes" && wetAreaIndex >= 0) {
      rows[wetAreaIndex] = {
        title: "Walls & waterproofing prep",
        description:
          "Prep backing, wall surfaces, and wet-area protection so the finish tile work has a clean installation base.",
      };
      rows = insertMilestoneRow(rows, wetAreaIndex + 1, {
        title: "Tile & waterproofing finish",
        description:
          "Install tile finishes, seal wet areas, and complete the detailed waterproofing work included in the remodel scope.",
      });
    } else if (wetAreaTile === "no" && wetAreaIndex >= 0) {
      rows = rows.filter((_, idx) => idx !== wetAreaIndex);
      const fixtureIndex = rows.findIndex((row) => row.title === "Vanity, fixtures & trim");
      if (fixtureIndex >= 0) {
        rows[fixtureIndex].description = appendMilestoneDetail(
          rows[fixtureIndex].description,
          "Include wall touch-up and non-tile surface prep needed before the fixture phase."
        );
      }
    }
    if (fixtureUpgradeNotes) {
      const fixtureIndex = rows.findIndex((row) => row.title === "Vanity, fixtures & trim");
      if (fixtureIndex >= 0) {
        rows[fixtureIndex].description = appendMilestoneDetail(
          rows[fixtureIndex].description,
          `Included upgrades: ${fixtureUpgradeNotes}.`
        );
      }
    }
  } else if (subtypeKey.includes("cabinet installation")) {
    rows = [
      { title: "Measurements & prep", description: "Confirm cabinet layout, site readiness, and delivery staging." },
      { title: "Cabinet installation", description: "Install and secure new cabinets in the planned configuration." },
      { title: "Hardware & adjustments", description: "Align doors and drawers, install hardware, and complete trim adjustments." },
      { title: "Final walkthrough", description: "Review fit and finish, cleanup, and confirm punch items with the customer." },
    ];
    if (demoRequired === "yes") {
      rows = insertMilestoneRow(rows, 0, {
        title: "Demo & site prep",
        description:
          "Remove existing cabinetry if needed, protect surrounding finishes, and prepare the space for the new cabinet install.",
      });
    }
    const hardwareIndex = rows.findIndex((row) => row.title === "Hardware & adjustments");
    if (hardwareIncluded === "yes" && hardwareIndex >= 0) {
      rows[hardwareIndex] = {
        title: "Hardware, fillers & trim",
        description:
          "Install pulls, fillers, panels, and trim pieces that complete the cabinetry scope.",
      };
      rows = insertMilestoneRow(rows, hardwareIndex + 1, {
        title: "Alignment & final adjustments",
        description:
          "Align doors and drawers, fine tune reveals, and complete final fit checks before walkthrough.",
      });
    } else if (hardwareIncluded === "no" && hardwareIndex >= 0) {
      rows[hardwareIndex] = {
        title: "Alignment & adjustments",
        description:
          "Align doors and drawers, confirm fit, and complete final adjustment work without hardware or trim installation scope.",
      };
    }
    if (cabinetStyleNotes) {
      const installIndex = rows.findIndex((row) => row.title === "Cabinet installation");
      if (installIndex >= 0) {
        rows[installIndex].description = appendMilestoneDetail(
          rows[installIndex].description,
          `Layout details: ${cabinetStyleNotes}.`
        );
      }
    }
  } else if (subtypeKey.includes("countertop installation")) {
    rows = [
      { title: "Template & prep", description: "Confirm measurements, protect work areas, and prep cabinet surfaces." },
      { title: "Countertop installation", description: "Install countertops, seams, and edge details." },
      { title: "Sink & fixture reconnect", description: "Reconnect sink and finish related countertop details." },
      { title: "Cleanup & walkthrough", description: "Complete cleanup, seal where needed, and review the finished install." },
    ];
  } else if (subtypeKey.includes("appliance installation")) {
    rows = [
      { title: "Delivery & staging", description: "Stage appliances, verify openings, and prep the install area." },
      { title: "Installation", description: "Set appliances in place and complete all required connections." },
      { title: "Testing & adjustments", description: "Test operation, fine tune fit, and complete any adjustments." },
      { title: "Cleanup & customer review", description: "Clean the area and review operation and handoff details with the customer." },
    ];
    if (haulAwayExisting === "yes") {
      rows = insertMilestoneRow(rows, 1, {
        title: "Disconnect & haul-away",
        description:
          "Disconnect existing appliances safely, remove them from the work area, and prep the site for the new installation.",
      });
    }
    if (connectionReady === "no") {
      rows = insertMilestoneRow(rows, haulAwayExisting === "yes" ? 2 : 1, {
        title: "Utility prep",
        description:
          "Prepare required hookups, shutoffs, or connection points so the appliance installation can proceed cleanly.",
      });
      const installIndex = rows.findIndex((row) => row.title === "Installation");
      if (installIndex >= 0) {
        rows[installIndex].description =
          "Set appliances in place, complete final hookups, and secure the finished installation once utilities are ready.";
      }
    }
    if (applianceScopeNotes) {
      const installIndex = rows.findIndex((row) => row.title === "Installation");
      if (installIndex >= 0) {
        rows[installIndex].description = appendMilestoneDetail(
          rows[installIndex].description,
          `Included appliance details: ${applianceScopeNotes}.`
        );
      }
    }
  } else if (subtypeKey.includes("roof replacement") || typeKey.includes("roof")) {
    rows = [
      { title: "Protection & tear-off", description: "Protect the site and remove existing roofing materials." },
      { title: "Decking & prep", description: "Inspect decking, complete repairs, and prep the roof system." },
      { title: "Roof system installation", description: "Install underlayment, roofing materials, and required flashings." },
      { title: "Cleanup & final review", description: "Complete cleanup, magnetic sweep, and final walkthrough." },
    ];
    if (tearOffScope === "no") {
      rows[0] = {
        title: "Protection & roof prep",
        description:
          "Protect the site, prep the existing roof surface, and ready the system for the new roofing work without a full tear-off.",
      };
    }
    if (deckingAllowance === "yes") {
      rows = insertMilestoneRow(rows, 2, {
        title: "Deck repair allowance",
        description:
          "Complete minor decking repairs or spot replacement where needed before the roofing system is closed in.",
      });
    }
    if (roofingNotes) {
      const roofInstallIndex = rows.findIndex((row) => row.title === "Roof system installation");
      if (roofInstallIndex >= 0) {
        rows[roofInstallIndex].description = appendMilestoneDetail(
          rows[roofInstallIndex].description,
          `System details: ${roofingNotes}.`
        );
      }
    }
  } else if (typeKey.includes("floor")) {
    rows = [
      { title: "Prep & materials", description: "Confirm material staging and prepare the work areas." },
      { title: "Surface preparation", description: "Demo or prep the substrate for the new flooring system." },
      { title: "Flooring installation", description: "Install flooring materials and transitions." },
      { title: "Trim & cleanup", description: "Complete trim details, cleanup, and final walkthrough." },
    ];
    if (demoRequired === "yes") {
      rows = insertMilestoneRow(rows, 1, {
        title: "Demo & disposal",
        description:
          "Remove existing flooring materials, dispose of debris, and leave the work areas ready for substrate prep.",
      });
    }
    if (subfloorPrep === "yes") {
      const prepIndex = rows.findIndex((row) => row.title === "Surface preparation");
      rows[prepIndex] = {
        title: "Subfloor prep & leveling",
        description:
          "Complete subfloor repairs, patching, or leveling work needed before finish flooring installation begins.",
      };
    } else if (subfloorPrep === "no") {
      const prepIndex = rows.findIndex((row) => row.title === "Surface preparation");
      rows[prepIndex] = {
        title: "Surface readiness check",
        description:
          "Verify the substrate is ready for installation and complete only minor prep before flooring work begins.",
      };
    }
    if (flooringNotes) {
      const installIndex = rows.findIndex((row) => row.title === "Flooring installation");
      if (installIndex >= 0) {
        rows[installIndex].description = appendMilestoneDetail(
          rows[installIndex].description,
          `Material details: ${flooringNotes}.`
        );
      }
    }
  } else {
    const limitedScope =
      /\binstall(ation)?\b/.test(text) &&
      !/\b(remodel|renovation|addition)\b/.test(text);
    rows = limitedScope
      ? [
          { title: "Prep & materials", description: "Confirm scope, stage materials, and prep the work area." },
          { title: "Primary installation", description: "Complete the core installation or replacement work." },
          { title: "Adjustments & finish", description: "Make adjustments, complete finish details, and test where needed." },
          { title: "Cleanup & walkthrough", description: "Clean the site and review the finished work with the customer." },
        ]
      : [
          { title: "Planning & prep", description: "Confirm scope, materials, and site readiness for the project." },
          { title: "Core work phase 1", description: "Begin the main work and complete the first major phase." },
          { title: "Core work phase 2", description: "Continue the main work and complete the next major phase." },
          { title: "Finish work", description: "Complete finish details, punch items, and final quality checks." },
          { title: "Cleanup & handoff", description: "Complete cleanup and customer walkthrough before closeout." },
        ];
  }

  const defaultAmounts = buildDefaultMilestoneAmounts(rows.length, totalBudget);
  return rows.map((row, idx) => {
    const baseAmount = baseMilestones?.[idx]?.amount;
    const amount =
      amountMode === "preserve_base"
        ? baseAmount ?? 0
        : defaultAmounts[idx];
    return {
      ...row,
      amount,
    };
  });
}
