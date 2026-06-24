// Pure functions. No LLM. Input: project + contractor context. Output: ComplianceFlag[]

function normalizeStr(s) {
  return String(s || "").toLowerCase().trim();
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// Maps project type keywords → license labels required in most US jurisdictions
const LICENSE_RULES = [
  {
    test: (type) => type.includes("electric"),
    label: "Electrical License",
    tradeKeyword: "electric",
  },
  {
    test: (type) => type.includes("plumb"),
    label: "Plumbing License",
    tradeKeyword: "plumb",
  },
  {
    test: (type) => type.includes("hvac") || type.includes("mechanical"),
    label: "HVAC/Mechanical License",
    tradeKeyword: "hvac",
  },
];

// Project types that commonly need subs the contractor may not carry
const SUB_GAP_RULES = [
  {
    test: (type) =>
      type.includes("general") ||
      type.includes("remodel") ||
      type.includes("addition") ||
      type.includes("new construction"),
    missingTrade: "electric",
    label: "electrician",
    message:
      "This job may need an electrician. You don't typically do electrical — do you have a sub in mind?",
  },
  {
    test: (type) =>
      type.includes("general") || type.includes("new construction"),
    missingTrade: "plumb",
    label: "plumber",
    message:
      "This job may need a plumber. You don't typically do plumbing — do you have a sub in mind?",
  },
];

/**
 * @param {object} opts
 * @param {string}   opts.projectType           - project type string (e.g. "Electrical")
 * @param {string}   opts.projectAddressState   - 2-letter state code (e.g. "TX")
 * @param {string[]} opts.contractorTradeProfile - contractor's skill/trade list
 * @param {object[]} opts.contractorLicenses     - [{ license_type, expiry_date }]
 * @param {object[]} opts.employeeCerts          - [{ employee_name, cert_type, expiry_date }]
 * @returns {import('./complianceRules').ComplianceFlag[]}
 */
export function checkCompliance({
  projectType = "",
  projectAddressState = "",
  contractorTradeProfile = [],
  contractorLicenses = [],
  employeeCerts = [],
} = {}) {
  const flags = [];
  const type = normalizeStr(projectType);
  const tradeSet = contractorTradeProfile.map(normalizeStr);

  // License requirement checks
  for (const rule of LICENSE_RULES) {
    if (!rule.test(type)) continue;
    const hasTrade = tradeSet.some((t) => t.includes(rule.tradeKeyword));
    if (!hasTrade) {
      flags.push({
        type: "missing_license",
        severity: "warning",
        message: `This job type requires a ${rule.label}${projectAddressState ? ` in ${projectAddressState}` : ""}. You don't have one on file. Want to add it?`,
        actionLabel: "Add license to profile",
        actionRoute: "/app/profile",
        skippable: true,
      });
    }
  }

  // Expiring license checks (warn if < 30 days)
  for (const lic of contractorLicenses) {
    const days = daysUntil(lic.expiry_date || lic.expires_at);
    if (days !== null && days >= 0 && days <= 30) {
      flags.push({
        type: "expiring_license",
        severity: "warning",
        message: `Your ${lic.license_type || "license"} expires in ${days} day${days === 1 ? "" : "s"} — worth renewing before this job starts.`,
        actionLabel: "Update license",
        actionRoute: "/app/profile",
        skippable: true,
      });
    }
  }

  // Sub gap hints (only flag the first missing trade per project type)
  for (const rule of SUB_GAP_RULES) {
    if (!rule.test(type)) continue;
    const hasTrade = tradeSet.some((t) => t.includes(rule.missingTrade));
    if (!hasTrade) {
      // Don't double-flag if we already flagged missing_license for same trade
      const alreadyFlagged = flags.some(
        (f) => f.type === "missing_license" && normalizeStr(f.message).includes(rule.missingTrade)
      );
      if (!alreadyFlagged) {
        flags.push({
          type: "sub_gap",
          severity: "info",
          message: rule.message,
          actionLabel: "Add subcontractor",
          actionRoute: "/app/team/subcontractors",
          skippable: true,
        });
      }
      break; // one sub gap hint per project is enough
    }
  }

  // Expiring employee cert checks (< 30 days)
  for (const cert of employeeCerts) {
    const days = daysUntil(cert.expiry_date || cert.expires_at);
    if (days !== null && days >= 0 && days <= 30) {
      flags.push({
        type: "expiring_cert",
        severity: "info",
        message: `${cert.employee_name || "An employee"}'s ${cert.cert_type || "certification"} expires in ${days} day${days === 1 ? "" : "s"}.`,
        actionLabel: "View team",
        actionRoute: "/app/team",
        skippable: true,
      });
    }
  }

  return flags;
}
