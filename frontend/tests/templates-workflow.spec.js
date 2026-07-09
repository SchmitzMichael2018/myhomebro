import { expect, test } from '@playwright/test';

const AGREEMENT_ID = 123;

function buildTemplate({
  id,
  name,
  owner_type = 'contractor',
  is_system = false,
  visibility = 'private',
  project_type = 'Remodel',
  project_subtype = 'Kitchen Remodel',
  description = '',
  exclusions_text = '',
  assumptions_text = '',
  milestones = [],
}) {
  return {
    id,
    name,
    owner_type,
    is_system,
    is_active: true,
    visibility,
    source_label: is_system ? 'system' : visibility,
    project_type,
    project_subtype,
    description: description || `${name} description`,
    default_scope: description || `${name} description`,
    exclusions_text,
    assumptions_text,
    estimated_days: 14,
    milestone_count: milestones.length,
    usage_count: 1,
    completed_project_count: 0,
    benchmark_support_label: is_system ? 'seeded' : 'seeded_and_learned',
    region_match_scope: 'global',
    normalized_region_key: '',
    milestones,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toIsoDateOnly(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysIso(value, offset) {
  const iso = toIsoDateOnly(value);
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setDate(parsed.getDate() + Number(offset || 0));
  const yy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const HVAC_ALIAS_PATTERNS = [
  /\bcentral\s+ac\s+install(?:ation)?\b/g,
  /\bcentral\s+air\s+install(?:ation)?\b/g,
  /\bair\s+conditioner\s+install(?:ation)?\b/g,
  /\bhvac\s+install(?:ation)?\b/g,
  /\bcooling\s+system\s+install(?:ation)?\b/g,
  /\bac\s+install(?:ation)?\b/g,
  /\binstall\s+air\s+conditioner\b/g,
  /\binstall\s+central\s+ac\b/g,
  /\binstall\s+central\s+air\b/g,
  /\binstall\s+hvac\b/g,
  /\binstall\s+cooling\s+system\b/g,
];

function canonicalizeHvacText(text) {
  let normalized = normalizeSearchText(text);
  if (!normalized) return "";
  for (const pattern of HVAC_ALIAS_PATTERNS) {
    normalized = normalized.replace(pattern, " central air installation ");
  }
  return normalizeSearchText(normalized);
}

function templateMatchBlob(row) {
  return canonicalizeHvacText(
    [
      row?.name,
      row?.project_type,
      row?.project_subtype,
      row?.description,
      row?.default_scope,
      row?.exclusions_text,
      row?.assumptions_text,
      row?.project_materials_hint,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function scoreTemplateMatch(row, payload) {
  const requestTitle = canonicalizeHvacText(payload?.project_title || "");
  const requestBody = canonicalizeHvacText(
    [payload?.project_title, payload?.project_type, payload?.project_subtype, payload?.description]
      .filter(Boolean)
      .join(" ")
  );
  const templateName = canonicalizeHvacText(row?.name || "");
  const templateType = canonicalizeHvacText(row?.project_type || "");
  const templateSubtype = canonicalizeHvacText(row?.project_subtype || "");
  const haystack = templateMatchBlob(row);

  let score = 0;

  if (requestTitle && templateName && requestTitle === templateName) score += 240;
  else if (templateName && requestBody && requestBody.includes(templateName)) score += 200;
  else if (requestBody && templateName && templateName.includes(requestBody)) score += 170;

  if (templateName && haystack.includes(templateName)) score += 10;
  if (templateType && requestBody.includes(templateType)) score += 12;
  if (templateSubtype && requestBody.includes(templateSubtype)) score += 18;

  return score;
}

function buildMilestone(id, title, description, sort_order = 1) {
  return {
    id,
    title,
    description,
    sort_order,
    start_offset: sort_order === 1 ? 0 : sort_order - 1,
    duration_days: 1,
    pricing_advisory: false,
    normalized_milestone_type: '',
    suggested_amount_fixed: null,
    suggested_amount_low: null,
    suggested_amount_high: null,
    pricing_confidence: '',
    pricing_source_note: '',
    recommended_days_from_start: sort_order === 1 ? 1 : sort_order,
    recommended_duration_days: null,
    materials_hint: '',
    is_optional: false,
  };
}

function scheduleMilestonesFromStart(rows, startDate) {
  const anchor = toIsoDateOnly(startDate);
  const list = Array.isArray(rows) ? rows : [];
  if (!anchor) {
    return list.map((row) => ({
      ...row,
      start_date: row.start_date || "",
      completion_date: row.completion_date || "",
      due_date: row.due_date || row.completion_date || "",
    }));
  }

  let cursor = anchor;
  return list.map((row, idx) => {
    const durationDays = Math.max(Number(row?.recommended_duration_days || row?.duration_days || 1), 1);
    const start_date = idx === 0 ? anchor : cursor;
    const completion_date = addDaysIso(start_date, durationDays - 1);
    cursor = addDaysIso(completion_date, 1);
    return {
      ...row,
      start_date,
      completion_date,
      due_date: completion_date,
    };
  });
}

function buildTemplateStore() {
  const kitchenMilestones = [
    buildMilestone(881, 'Demo & protection', 'Protect the home and remove existing finishes.', 1),
    buildMilestone(882, 'Cabinets & surfaces', 'Install cabinets, counters, and related surfaces.', 2),
    buildMilestone(883, 'Fixtures & closeout', 'Complete fixtures, trim, and final walkthrough.', 3),
  ];

  const templates = [
    buildTemplate({
      id: 1,
      name: 'System Roof Replacement',
      owner_type: 'system',
      is_system: true,
      visibility: 'system',
      project_type: 'Roofing',
      project_subtype: 'Roof Replacement',
      description: 'Built-in roof replacement template with planning, tear-off, install, and closeout phases.',
      milestones: [
        buildMilestone(101, 'Planning & protection', 'Review scope, protect the work area, and prep access.', 1),
        buildMilestone(102, 'Tear-off & prep', 'Remove existing materials and prep the roof deck.', 2),
        buildMilestone(103, 'Install & closeout', 'Install roofing materials and finish the job.', 3),
      ],
    }),
    buildTemplate({
      id: 88,
      name: 'Kitchen Remodel Starter',
      project_type: 'Remodel',
      project_subtype: 'Kitchen Remodel',
      description: 'Reusable kitchen remodel template with planning, install, and closeout phases.',
      milestones: kitchenMilestones,
    }),
    buildTemplate({
      id: 99,
      name: 'Bathroom Remodel Pro',
      project_type: 'Remodel',
      project_subtype: 'Bathroom Remodel',
      description: 'Bathroom remodel template with demo, waterproofing, and finish phases.',
      milestones: [
        buildMilestone(991, 'Demo & prep', 'Protect nearby finishes and remove existing bathroom fixtures.', 1),
        buildMilestone(992, 'Waterproof & tile', 'Prep wet areas and complete tile installation.', 2),
        buildMilestone(993, 'Fixtures & walkthrough', 'Install fixtures, finish trim, and review the work.', 3),
      ],
    }),
  ];

  return {
    nextTemplateId: 150,
    nextMilestoneId: 2000,
    templates,
  };
}

function listTemplatesForSource(store, source) {
  const rows = Array.isArray(store.templates) ? store.templates : [];
  if (source === 'system') return rows.filter((item) => item.is_system || item.owner_type === 'system');
  if (source === 'regional') return rows.filter((item) => item.visibility === 'regional');
  if (source === 'public') return rows.filter((item) => item.visibility === 'public');
  return rows.filter((item) => !item.is_system && item.owner_type !== 'system');
}

async function installCommonRoutes(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
    try {
      window.sessionStorage.clear();
    } catch {
      // ignore
    }
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'playwright@myhomebro.local',
      }),
    });
  });

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        onboarding_status: 'complete',
        connected: true,
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        city: 'San Antonio',
        state: 'TX',
        ai: { access: 'included', enabled: true, unlimited: true },
      }),
    });
  });

  await page.route('**/api/projects/homeowners**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 1, company_name: 'Demo Customer', full_name: 'Jordan Demo' }],
      }),
    });
  });

  await page.route('**/api/projects/project-types/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { id: 1, value: 'Remodel', label: 'Remodel', owner_type: 'system' },
          { id: 2, value: 'Cabinetry', label: 'Cabinetry', owner_type: 'system' },
        ],
      }),
    });
  });

  await page.route('**/api/projects/project-subtypes/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 11,
            value: 'Kitchen Remodel',
            label: 'Kitchen Remodel',
            owner_type: 'system',
            project_type: 'Remodel',
          },
          {
            id: 12,
            value: 'Bathroom Remodel',
            label: 'Bathroom Remodel',
            owner_type: 'system',
            project_type: 'Remodel',
          },
          {
            id: 13,
            value: 'Cabinet Installation',
            label: 'Cabinet Installation',
            owner_type: 'system',
            project_type: 'Cabinetry',
          },
        ],
      }),
    });
  });
}

async function installTemplateRoutes(page, store) {
  await page.route('**/api/projects/templates/ai/improve-description/', async (route) => {
    const payload = route.request().postDataJSON();
    const projectType = String(payload?.project_type || '').trim();
    const projectSubtype = String(payload?.project_subtype || '').trim();
    const seed = `${projectType} ${projectSubtype} ${payload?.description || ''}`.toLowerCase();
    const isShed = seed.includes('shed');
    const isDeck = seed.includes('deck');
    const isBath = seed.includes('bath');
    const isKitchen = seed.includes('kitchen');
    const opening = isShed
      ? 'Work includes a reusable shed build scope covering site prep, layout, framing, roof assembly, exterior finishing, and closeout.'
      : isDeck
      ? 'Work includes a reusable deck build scope covering site prep, framing, decking, railing installation, finishing, and closeout.'
      : isBath
      ? 'Work includes a reusable bathroom remodel scope covering demo, rough work, finish installation, final adjustments, and closeout.'
      : isKitchen
      ? 'Work includes a reusable kitchen remodel scope covering site prep, demo, rough coordination, finish installation, and closeout.'
      : `${projectSubtype || projectType || 'Project'} work includes a reusable scope covering site prep, installation, finish work, and closeout.`;
    const phases = isShed
      ? 'Included work phases: site preparation, layout, foundation or pad preparation, framing, wall assembly, roof installation, trim, and final cleanup.'
      : isDeck
      ? 'Included work phases: site preparation, layout, footing or support work, framing, decking installation, railing or stair installation, and cleanup.'
      : isBath
      ? 'Included work phases: site protection, demolition, rough plumbing or electrical coordination, waterproofing, tile or finish installation, and walkthrough.'
      : isKitchen
      ? 'Included work phases: site protection, demolition, rough-in coordination, cabinet installation, finish work, and final walkthrough.'
      : 'Included work phases: site preparation, layout, installation, finish work, final adjustments, and cleanup.';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        description_scope: [
          'Scope of Work',
          opening,
          '',
          'Included Work Phases',
          '- Site preparation',
          '- Foundation setup',
          '- Framing',
          '- Roofing',
          '- Exterior finishing',
          '- Final cleanup',
          '',
          'Optional Components',
          '- May include doors, windows, trim, shelving, and finishes when specified.',
        ].join('\n'),
        assumptions: [
          'Customer Responsibilities',
          '- Customer will confirm all material selections, design approvals, and changes prior to work.',
          '',
          'Contractor Responsibilities',
          '- Contractor will verify measurements, site conditions, and access before starting work.',
        ].join('\n'),
        exclusions: [
          'Exclusions',
          '- The following are not included unless explicitly added:',
          '- Electrical',
          '- Plumbing',
          '- Landscaping',
          '- Permits',
          '- Custom upgrades',
        ].join('\n'),
        description: [
          opening,
          phases,
          'Optional components may include doors, windows, trim, shelving, finishes, or other upgrades only when specified.',
          'Customer will confirm selections, approvals, and any changes that affect the written scope before work proceeds.',
          'Contractor will verify measurements, site conditions, and build constraints before installation begins.',
          'Not included unless specified: permit fees, engineering, utility relocation, hidden-condition repairs, custom upgrades, and other job-specific extras.',
        ].join(' '),
      }),
    });
  });

  await page.route('**/api/projects/templates/ai/suggest-type-subtype/', async (route) => {
    const payload = route.request().postDataJSON();
    const text = `${payload?.name || ''} ${payload?.description || ''}`.toLowerCase();

    let project_type = 'Remodel';
    let project_subtype = 'Kitchen Remodel';
    if (text.includes('deck')) {
      project_type = 'Outdoor';
      project_subtype = 'Deck Build';
    } else if (text.includes('bathroom')) {
      project_type = 'Remodel';
      project_subtype = 'Bathroom Remodel';
    } else if (text.includes('cabinet')) {
      project_type = 'Cabinetry';
      project_subtype = 'Cabinet Installation';
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ project_type, project_subtype }),
    });
  });

  await page.route('**/api/projects/templates/ai/create-from-scope/', async (route) => {
    const payload = route.request().postDataJSON();
    const text = `${payload?.name || ''} ${payload?.description || ''} ${payload?.prompt || ''}`.toLowerCase();
    const isDeck = text.includes('deck');
    const isBath = text.includes('bathroom');

    const project_type = isDeck ? 'Outdoor' : isBath ? 'Remodel' : payload?.project_type || 'Remodel';
    const project_subtype = isDeck ? 'Deck Build' : isBath ? 'Bathroom Remodel' : payload?.project_subtype || 'Kitchen Remodel';
    const name = payload?.name || (isDeck ? 'Deck Build Template' : isBath ? 'Bathroom Remodel Template' : 'Kitchen Remodel Starter');
    const description = isDeck
      ? 'Reusable deck scope covering layout, framing, decking, rails, and closeout.'
      : isBath
      ? 'Reusable bathroom remodel scope covering demo, waterproofing, tile, fixtures, and closeout.'
      : 'Reusable kitchen remodel scope covering planning, install, and closeout phases.';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        name,
        project_type,
        project_subtype,
        description_scope: description,
        assumptions: 'Customer Responsibilities\n- Customer will confirm selections, approvals, and any changes prior to work.\n\nContractor Responsibilities\n- Contractor will verify measurements, site conditions, and access before starting work.',
        exclusions: 'Exclusions\n- The following are not included unless explicitly added:\n- Permits\n- Engineering\n- Utility relocation',
        description,
        estimated_days: isDeck ? 12 : 14,
        default_scope: description,
        assumptions_text: 'Customer Responsibilities\n- Customer will confirm selections, approvals, and any changes prior to work.\n\nContractor Responsibilities\n- Contractor will verify measurements, site conditions, and access before starting work.',
        exclusions_text: 'Exclusions\n- The following are not included unless explicitly added:\n- Permits\n- Engineering\n- Utility relocation',
        default_clarifications: [
          { key: 'access', label: 'Access to the property', help: 'Confirm access and site readiness.' },
        ],
        pricing: {
          total_range: isDeck ? '$12,000-$18,000' : '$18,000-$28,000',
          milestone_percentages: isDeck
            ? [
                { milestone: 'Layout & permits', percentage: '20%', notes: 'Initial planning and permit coordination.' },
                { milestone: 'Framing & structure', percentage: '45%', notes: 'Structural build and framing work.' },
              ]
            : [
                { milestone: 'Planning & site protection', percentage: '15%', notes: 'Mobilization and protection.' },
                { milestone: 'Demolition & rough prep', percentage: '35%', notes: 'Demo and prep work.' },
                { milestone: 'Electrical rough', percentage: '50%', notes: 'Rough-in and finish readiness.' },
              ],
        },
        materials: isDeck
          ? [
              {
                category: 'Project Materials',
                options: ['Decking boards', 'Framing lumber', 'Fasteners', 'Rail components'],
                notes: 'Use exterior-rated materials and weather-resistant fasteners.',
              },
            ]
          : [
              {
                category: 'Project Materials',
                options: ['Cabinetry', 'Trim', 'Fasteners', 'Sealant'],
                notes: 'Use cabinet-grade materials and finish supplies.',
              },
            ],
        timeline: isDeck ? 'About 12 working days' : 'About 14 working days',
        clarification_questions: [
          'Confirm access to the property',
          'Are material selections already made?',
        ],
        sections_status: {
          description: 'generated',
          milestones: 'generated',
          pricing: 'generated',
          materials: 'generated',
          clarifications: 'generated',
        },
        _partial: false,
        project_materials_hint: isDeck
          ? 'Decking, framing lumber, fasteners, rail components, sealant.'
          : 'Cabinetry, trim, fasteners, sealant, and cleanup materials.',
        milestones: isDeck
          ? [
              {
                title: 'Layout & permits',
                description: 'Confirm scope, site access, and any permit needs.',
                normalized_milestone_type: 'site_prep',
                sort_order: 1,
              },
              {
                title: 'Framing & structure',
                description: 'Build the structural deck frame and supports.',
                normalized_milestone_type: 'framing',
                sort_order: 2,
              },
            ]
          : [
              {
                title: 'Planning & site protection',
                description: 'Confirm reusable kitchen scope and protect the work area.',
                normalized_milestone_type: 'site_prep',
                sort_order: 1,
              },
              {
                title: 'Demolition & rough prep',
                description: 'Remove existing finishes and prep the space for the next phase.',
                normalized_milestone_type: 'demolition',
                sort_order: 2,
              },
              {
                title: 'Electrical rough',
                description: 'Complete rough electrical work before finish phases.',
                normalized_milestone_type: 'electrical_rough',
                sort_order: 3,
              },
            ],
      }),
    });
  });

  await page.route('**/api/projects/templates/discover/**', async (route) => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get('source') || 'mine';
    const query = (url.searchParams.get('q') || '').toLowerCase();
    const rows = listTemplatesForSource(store, source)
      .filter((row) =>
        !query
          ? true
          : `${row.name} ${row.project_type} ${row.project_subtype} ${row.description}`
              .toLowerCase()
              .includes(query)
      )
      .map((row) => ({
        ...clone(row),
        milestone_count: Array.isArray(row.milestones) ? row.milestones.length : 0,
      }));

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: rows, meta: { source, count: rows.length } }),
    });
  });

  await page.route('**/api/projects/templates/recommend/', async (route) => {
    const payload = route.request().postDataJSON();
    const payloadBlob = canonicalizeHvacText(
      [payload?.project_title, payload?.project_type, payload?.project_subtype, payload?.description]
        .filter(Boolean)
        .join(" ")
    );
    const preferCentralAir =
      payloadBlob.includes("central air installation") ||
      payloadBlob.includes("central air") ||
      payloadBlob.includes("central ac") ||
      payloadBlob.includes("hvac installation") ||
      payloadBlob.includes("air conditioner") ||
      payloadBlob.includes("cooling system");
    const ranked = store.templates
      .map((row) => ({ row, score: scoreTemplateMatch(row, payload) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || String(a.row.name).localeCompare(String(b.row.name)));
    const centralAirMatch = preferCentralAir
      ? store.templates.find((row) => canonicalizeHvacText(row?.name).includes("central air installation"))
      : null;
    const match = centralAirMatch || ranked[0]?.row || null;
    const chosenScore = centralAirMatch ? 999 : ranked[0]?.score || 0;
    console.log("[templates-workflow] recommend payload", {
      title: payload?.project_title || "",
      type: payload?.project_type || "",
      subtype: payload?.project_subtype || "",
      description: payload?.description || "",
      preferCentralAir,
      match: match?.name || null,
      chosenScore,
    });

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        match
          ? {
              confidence: chosenScore >= 90 ? 'recommended' : 'possible',
              confidence_level: chosenScore >= 90 ? 'high' : 'medium',
              recommended_template: clone(match),
              possible_match: chosenScore >= 90 ? null : clone(match),
              candidates: ranked.slice(0, 5).map((item) => ({
                ...clone(item.row),
                score: item.score,
                reason: `${item.row.name} matched the current request.`,
              })),
              reason: `${match.name} matches the current request.`,
              detail: chosenScore >= 90 ? 'Strong template recommendation found.' : 'Possible template match found.',
            }
          : {
              confidence: 'none',
              confidence_level: 'low',
              recommended_template: null,
              possible_match: null,
              candidates: [],
              reason: 'No strong template match.',
              detail: 'No strong template recommendation.',
            }
      ),
    });
  });

  await page.route(/\/api\/projects\/templates\/?(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      const url = new URL(request.url());
      const query = canonicalizeHvacText(url.searchParams.get('q') || '');
      const results = !query
        ? store.templates.map((row) => clone(row))
        : store.templates.filter((row) => templateMatchBlob(row).includes(query)).map((row) => clone(row));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results }),
      });
      return;
    }

    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      const created = buildTemplate({
        id: store.nextTemplateId++,
        name: payload.name,
        project_type: payload.project_type,
        project_subtype: payload.project_subtype,
        description: payload.description,
        exclusions_text: payload.exclusions_text || '',
        assumptions_text: payload.assumptions_text || '',
        milestones: (Array.isArray(payload.milestones) ? payload.milestones : []).map((row, idx) => ({
          ...row,
          id: store.nextMilestoneId++,
          sort_order: Number(row.sort_order || idx + 1) || idx + 1,
        })),
      });
      created.default_scope = payload.default_scope || payload.description || '';
      created.default_clarifications = Array.isArray(payload.default_clarifications)
        ? payload.default_clarifications
        : [];
      created.project_materials_hint = payload.project_materials_hint || '';
      created.estimated_days = Number(payload.estimated_days || 1) || 1;
      created.milestone_count = created.milestones.length;
      store.templates = [created, ...store.templates];

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(clone(created)),
      });
      return;
    }

    await route.fallback();
  });

  await page.route(/\/api\/projects\/templates\/\d+\/?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const id = Number(url.pathname.split('/').filter(Boolean).pop());
    const index = store.templates.findIndex((row) => row.id === id);

    if (request.method() === 'GET') {
      const row = index >= 0 ? clone(store.templates[index]) : null;
      await route.fulfill({
        status: row ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(row || { detail: 'Not found.' }),
      });
      return;
    }

    if (request.method() === 'PATCH' && index >= 0) {
      const payload = request.postDataJSON();
      const existing = store.templates[index];
      const updated = {
        ...existing,
        ...payload,
        milestones: (Array.isArray(payload.milestones) ? payload.milestones : existing.milestones).map((row, idx) => ({
          ...row,
          id: row.id || store.nextMilestoneId++,
          sort_order: Number(row.sort_order || idx + 1) || idx + 1,
        })),
      };
      updated.milestone_count = updated.milestones.length;
      store.templates[index] = updated;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(clone(updated)),
      });
      return;
    }

    if (request.method() === 'DELETE' && index >= 0) {
      store.templates = store.templates.filter((row) => row.id !== id);
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    await route.fallback();
  });
}

async function installWizardRoutes(page, store, agreement, milestoneState) {
  let nextAgreementId = 501;

  await page.route(
    /\/api\/projects\/agreements\/(?:new|\d+)\/?(\?.*)?$/,
    async (route) => {
      const request = route.request();
      if (request.method() === 'PATCH') {
        const payload = request.postDataJSON() || {};
        if (payload.project_start_date !== undefined) {
          agreement.project_start_date = payload.project_start_date || '';
          agreement.start = payload.project_start_date || '';
        }
        if (payload.start !== undefined) {
          agreement.start = payload.start || agreement.start || '';
          agreement.project_start_date = payload.start || agreement.project_start_date || '';
        }
        if (payload.project_title !== undefined) agreement.project_title = payload.project_title || '';
        if (payload.title !== undefined) agreement.title = payload.title || '';
        if (payload.project_type !== undefined) agreement.project_type = payload.project_type || '';
        if (payload.project_subtype !== undefined) agreement.project_subtype = payload.project_subtype || '';
        if (payload.description !== undefined) agreement.description = payload.description || '';
        if (payload.scope_of_work !== undefined) agreement.scope_of_work = payload.scope_of_work || '';
        if (payload.step_status !== undefined) agreement.step_status = payload.step_status || agreement.step_status || 'step1';
      }
      if (request.method() === 'GET' || request.method() === 'PATCH') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(clone(agreement)),
        });
        return;
      }

      await route.fallback();
    }
  );

  await page.route('**/api/projects/agreements/', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const payload = request.postDataJSON() || {};
      agreement.id = nextAgreementId++;
      agreement.agreement_id = agreement.id;
      agreement.project_title = payload.project_title || payload.title || agreement.project_title || '';
      agreement.title = agreement.project_title || agreement.title || '';
      agreement.project_type = payload.project_type || agreement.project_type || '';
      agreement.project_subtype = payload.project_subtype || agreement.project_subtype || '';
      agreement.description = payload.description || agreement.description || '';
      agreement.scope_of_work = payload.scope_of_work || agreement.scope_of_work || agreement.description || '';
      agreement.status = payload.status || agreement.status || 'draft';
      agreement.step_status = payload.step_status || agreement.step_status || 'step1';
      agreement.project_start_date = payload.project_start_date || payload.start || agreement.project_start_date || '';
      agreement.start = payload.start || payload.project_start_date || agreement.start || '';
      agreement.selected_template_id = payload.selected_template_id ?? agreement.selected_template_id ?? null;
      agreement.selected_template = payload.selected_template ?? agreement.selected_template ?? null;
      agreement.selected_template_name_snapshot =
        payload.selected_template_name_snapshot ?? agreement.selected_template_name_snapshot ?? '';
      agreement.project_template_id = payload.project_template_id ?? agreement.project_template_id ?? null;
      agreement.template_id = payload.template_id ?? agreement.template_id ?? null;

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(clone(agreement)),
      });
      return;
    }

    await route.fallback();
  });

  await page.route(
    /\/api\/projects\/agreements\/(?:new|\d+)\/apply-template\/$/,
    async (route) => {
      const payload = route.request().postDataJSON();
      const template = store.templates.find((row) => row.id === payload?.template_id);
      if (!template) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Template not found.' }),
        });
        return;
      }

      if (!agreement.id) {
        agreement.id = nextAgreementId++;
        agreement.agreement_id = agreement.id;
        agreement.status = agreement.status || 'draft';
        agreement.step_status = 'step1';
      }

      agreement.project_title = template.name;
      agreement.title = template.name;
      agreement.project_type = template.project_type;
      agreement.project_subtype = template.project_subtype;
      agreement.description = template.description;
      agreement.project_start_date = payload?.project_start_date || agreement.project_start_date || agreement.start || '';
      agreement.start = agreement.project_start_date || agreement.start || '';
      agreement.selected_template_id = template.id;
      agreement.selected_template = {
        id: template.id,
        name: template.name,
        project_type: template.project_type,
        project_subtype: template.project_subtype,
      };
      agreement.selected_template_name_snapshot = template.name;
      agreement.project_template_id = template.id;
      agreement.template_id = template.id;

      milestoneState.items = scheduleMilestonesFromStart(template.milestones, agreement.project_start_date).map((row, idx) => ({
        id: row.id,
        agreement: agreement.id,
        order: idx + 1,
        title: row.title,
        description: row.description,
        amount: row.suggested_amount_fixed || '0.00',
        normalized_milestone_type: row.normalized_milestone_type || '',
        start_date: row.start_date || '',
        completion_date: row.completion_date || '',
        due_date: row.due_date || row.completion_date || '',
      }));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: `Template applied: ${template.name}`,
          agreement: clone(agreement),
          template: clone(template),
          result: {
            milestones_created: milestoneState.items.length,
          },
        }),
      });
    }
  );

  await page.route(
    /\/api\/projects\/agreements\/(?:new|\d+)\/save-as-template\/$/,
    async (route) => {
      const payload = route.request().postDataJSON();
      const sourceScope = String(payload?.scope_description || agreement.description || '').trim();
      const created = buildTemplate({
        id: store.nextTemplateId++,
        name: payload?.name || `${agreement.project_title || agreement.title || 'Agreement'} Template`,
        project_type: agreement.project_type || '',
        project_subtype: agreement.project_subtype || '',
        description: agreement.description || '',
        milestones: milestoneState.items.map((row, idx) => ({
          id: store.nextMilestoneId++,
          title: row.title,
          description: row.description,
          sort_order: Number(row.order || idx + 1) || idx + 1,
          start_offset: idx,
          duration_days: 1,
          pricing_advisory: false,
          normalized_milestone_type: row.normalized_milestone_type || '',
          suggested_amount_fixed: null,
          suggested_amount_low: null,
          suggested_amount_high: null,
          pricing_confidence: '',
          pricing_source_note: '',
          recommended_days_from_start: idx + 1,
          recommended_duration_days: 1,
          materials_hint: '',
          is_optional: false,
        })),
      });
      created.default_scope = sourceScope;
      created.is_active = payload?.is_active !== false;
      created.internal_note = payload?.description || '';
      created.milestone_count = created.milestones.length;
      store.templates = [created, ...store.templates];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'Template saved successfully.',
          template: clone(created),
        }),
      });
    }
  );

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: clone(milestoneState.items) }),
    });
  });

  await page.route('**/api/projects/agreements/ai/description/', async (route) => {
    const payload = route.request().postDataJSON() || {};
    const prompt = canonicalizeHvacText(payload.current_description || '');
    const isCentralAir = prompt.includes('central air') || prompt.includes('central ac') || prompt.includes('hvac') || prompt.includes('air conditioner') || prompt.includes('cooling system');

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project_title: isCentralAir ? 'Central Air Installation' : 'Kitchen Remodel',
        project_type: isCentralAir ? 'HVAC' : 'Remodel',
        project_subtype: isCentralAir ? 'HVAC Installation' : 'Kitchen Remodel',
        description: isCentralAir
          ? 'Central air installation with condenser, line set, thermostat, startup, and cleanup.'
          : 'Full kitchen remodel with demo, cabinets, countertops, appliance reconnects, plumbing, electrical, and finish work.',
        ai_access: 'included',
        ai_enabled: true,
        ai_unlimited: true,
      }),
    });
  });
}

async function installWorkflowMocks(page, { agreement } = {}) {
  const store = buildTemplateStore();
  const milestoneState = { items: [] };
  const draftAgreement = agreement || {
    id: null,
    agreement_id: null,
    project_title: '',
    title: '',
    project_type: '',
    project_subtype: '',
    payment_mode: 'escrow',
    payment_structure: 'simple',
    description: '',
    homeowner: null,
    status: 'draft',
    compliance_warning: { warning_level: 'none', message: '' },
    selected_template_id: null,
    selected_template: null,
    selected_template_name_snapshot: '',
    project_start_date: '',
    start: '',
  };

  await installCommonRoutes(page);
  await installTemplateRoutes(page, store);
  await installWizardRoutes(page, store, draftAgreement, milestoneState);

  return { store, agreement: draftAgreement, milestoneState };
}

test('templates route and sidebar access support creating and editing reusable templates with milestone persistence', async ({
  page,
}) => {
  const { store } = await installWorkflowMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: 'Templates' })).toHaveAttribute('href', '/app/templates');
  await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible();
  await expect(
    page.getByText('Build reusable workflow structures that turn repeatable work into faster, smarter agreements.')
  ).toBeVisible();
  await expect(
    page.getByText(
      'Use templates to quickly create consistent agreements with predefined scope, milestones, and pricing.'
    )
  ).toBeVisible();
  await expect(page.getByText('Select a template to edit or create a new one.')).toBeVisible();
  await expect(page.getByText('Start a new template')).toBeVisible();
  await expect(page.getByTestId('templates-generate-ai-button')).toBeVisible();
  await expect(page.getByTestId('templates-ai-prompt-input')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Template Draft' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Generate Draft with Project Assistant' })).toHaveCount(1);

  await page.getByTestId('templates-new-draft-button').click();
  await page.getByTestId('templates-name-input').fill('Cabinet Install Standard');
  await page.getByTestId('templates-project-type-input').fill('Cabinetry');
  await page.getByTestId('templates-project-subtype-input').fill('Cabinet Installation');
  await page.getByTestId('templates-description-input').fill(
    'Reusable cabinet installation template with staging, install, and closeout phases.'
  );
  await page.getByTestId('templates-tab-milestones').click();
  await page.getByTestId('templates-milestone-title-1').fill('Measurements & staging');
  await page.getByTestId('templates-milestone-description-1').fill(
    'Confirm layout, verify deliveries, and prepare the work area.'
  );
  await page.getByTestId('templates-add-milestone-button').click();
  await page.getByTestId('templates-milestone-title-2').fill('Cabinet installation');
  await page.getByTestId('templates-milestone-description-2').fill(
    'Install and secure new cabinets, then complete final adjustments.'
  );
  await page.getByTestId('templates-save-button').click();

  await expect(page.getByText('Template created.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cabinet Install Standard' })).toBeVisible();
  await expect.poll(() => store.templates.some((row) => row.name === 'Cabinet Install Standard')).toBe(true);

  await page.getByTestId('templates-tab-milestones').click();
  await expect(page.getByText('Measurements & staging')).toBeVisible();
  await expect(page.getByText('2. Cabinet installation')).toBeVisible();

  await page.getByTestId('templates-edit-button').click();
  await page.getByTestId('templates-name-input').fill('Cabinet Install Standard v2');
  await page.getByTestId('templates-tab-milestones').click();
  await expect(page.getByTestId('templates-ai-improve-milestones-button')).toBeVisible();
  await expect(page.getByTestId('templates-ai-suggest-milestone-count-button')).toBeVisible();
  await page.getByTestId('templates-ai-improve-milestones-button').click();
  await expect(page.getByTestId('templates-milestone-improvement-preview')).toContainText(
    'Review milestone wording suggestions'
  );
  await page.getByTestId('templates-apply-milestone-improvements').click();
  await page.getByTestId('templates-milestone-title-2').fill('Install, align & close out');
  await page.getByTestId('templates-ai-suggest-milestone-count-button').click();
  await expect(page.getByTestId('templates-milestone-count-preview')).toContainText(
    'Recommended structure'
  );
  await page.getByTestId('templates-tab-pricing').click();
  await expect(page.getByTestId('templates-ai-suggest-pricing-structure-button')).toBeVisible();
  await page.getByTestId('templates-ai-suggest-pricing-structure-button').click();
  await expect(page.getByTestId('templates-pricing-structure-preview')).toContainText(
    'No dollar pricing is stored'
  );
  await expect(page.getByTestId('templates-pricing-structure-preview')).not.toContainText('$0');
  await expect(page.getByTestId('templates-pricing-structure-preview')).toContainText('suggested');
  await expect(page.getByTestId('templates-milestone-percent-1')).not.toHaveValue('');
  await expect(page.getByTestId('templates-milestone-percent-2')).not.toHaveValue('');
  await expect(page.getByTestId('templates-milestone-min-percent-1')).not.toHaveValue('');
  await expect(page.getByTestId('templates-milestone-max-percent-1')).not.toHaveValue('');
  const allocationRows = await page.evaluate(() => {
    return [1, 2].map((idx) => ({
      suggested: Number(document.querySelector(`[data-testid="templates-milestone-percent-${idx}"]`)?.value || 0),
      min: Number(document.querySelector(`[data-testid="templates-milestone-min-percent-${idx}"]`)?.value || 0),
      max: Number(document.querySelector(`[data-testid="templates-milestone-max-percent-${idx}"]`)?.value || 0),
    }));
  });
  for (const row of allocationRows) {
    expect(row.min).toBeLessThanOrEqual(row.suggested);
    expect(row.suggested).toBeLessThanOrEqual(row.max);
  }
  expect(allocationRows[1].suggested).toBeGreaterThan(allocationRows[0].suggested);
  await expect(page.getByText('Suggested total:')).toBeVisible();
  await expect(page.getByText('100%')).toBeVisible();
  await expect(page.getByText('Min total:')).toHaveCount(0);
  await expect(page.getByText('Max total:')).toHaveCount(0);
  await expect(page.getByTestId('templates-allocation-warning')).toHaveCount(0);
  await page.getByTestId('templates-milestone-allocation-enabled-1').check();
  await page.getByTestId('templates-milestone-percent-1').fill('60');
  await page.getByTestId('templates-milestone-min-percent-1').fill('50');
  await page.getByTestId('templates-milestone-max-percent-1').fill('70');
  await page.getByTestId('templates-milestone-allocation-enabled-2').check();
  await page.getByTestId('templates-milestone-percent-2').fill('50');
  await expect(page.getByTestId('templates-allocation-warning')).toContainText(
    'Allocation totals exceed 100%'
  );
  await page.getByTestId('templates-milestone-percent-2').fill('40');
  await expect(page.getByTestId('templates-allocation-warning')).toHaveCount(0);
  await page.getByTestId('templates-tab-materials').click();
  await expect(page.getByTestId('templates-materials-helper-card')).toHaveClass(/bg-slate-950/);
  await expect(page.getByTestId('templates-materials-helper-card')).toContainText(
    'Project-Level Materials should describe'
  );
  await page.getByTestId('templates-save-button').click();

  await expect(page.getByText('Template updated.')).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.locator('[data-testid^="template-discovery-card-"]').filter({ hasText: 'Cabinet Install Standard v2' }).click();
  await expect(page.getByRole('heading', { name: 'Cabinet Install Standard v2' })).toBeVisible();
  await page.getByTestId('templates-tab-milestones').click();
  await expect(page.getByText('2. Install, align & close out')).toBeVisible();
  await page.getByTestId('templates-tab-pricing').click();
  await expect(page.getByText('Suggested Allocation Summary')).toBeVisible();
  await expect(page.getByText('Suggested total:')).toBeVisible();
  await expect(page.getByText('100%')).toBeVisible();
});

test('template allocation suggestions create valid flooring milestone percentages', async ({ page }) => {
  await installWorkflowMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('templates-new-draft-button').click();
  await page.getByTestId('templates-name-input').fill('Flooring Installation Allocation');
  await page.getByTestId('templates-project-type-input').fill('Flooring');
  await page.getByTestId('templates-project-subtype-input').fill('Luxury Vinyl Plank');
  await page.getByTestId('templates-description-input').fill(
    'Reusable flooring installation template with preparation, installation, and closeout phases.'
  );

  await page.getByTestId('templates-tab-milestones').click();
  await page.getByTestId('templates-milestone-title-1').fill('Prep & materials');
  await page.getByTestId('templates-milestone-description-1').fill(
    'Confirm material selections, stage materials, and prepare access.'
  );
  await page.getByTestId('templates-add-milestone-button').click();
  await page.getByTestId('templates-milestone-title-2').fill('Surface preparation');
  await page.getByTestId('templates-milestone-description-2').fill(
    'Prepare substrate and surface conditions for flooring installation.'
  );
  await page.getByTestId('templates-add-milestone-button').click();
  await page.getByTestId('templates-milestone-title-3').fill('Flooring installation');
  await page.getByTestId('templates-milestone-description-3').fill(
    'Install flooring materials according to manufacturer requirements.'
  );
  await page.getByTestId('templates-add-milestone-button').click();
  await page.getByTestId('templates-milestone-title-4').fill('Trim & cleanup');
  await page.getByTestId('templates-milestone-description-4').fill(
    'Install trim and transitions, clean the work area, and complete the walkthrough.'
  );

  await page.getByTestId('templates-tab-pricing').click();
  await page.getByTestId('templates-ai-suggest-pricing-structure-button').click();

  const rows = await page.evaluate(() => {
    return [1, 2, 3, 4].map((idx) => ({
      suggested: Number(document.querySelector(`[data-testid="templates-milestone-percent-${idx}"]`)?.value || 0),
      min: Number(document.querySelector(`[data-testid="templates-milestone-min-percent-${idx}"]`)?.value || 0),
      max: Number(document.querySelector(`[data-testid="templates-milestone-max-percent-${idx}"]`)?.value || 0),
    }));
  });

  expect(rows.map((row) => row.suggested)).toEqual([20, 20, 50, 10]);
  expect(rows.reduce((sum, row) => sum + row.suggested, 0)).toBe(100);
  for (const row of rows) {
    expect(row.min).toBeLessThanOrEqual(row.suggested);
    expect(row.suggested).toBeLessThanOrEqual(row.max);
  }
  expect(rows[2].suggested).toBeGreaterThan(rows[0].suggested);
  expect(rows[2].suggested).toBeGreaterThan(rows[1].suggested);
  expect(rows[2].suggested).toBeGreaterThan(rows[3].suggested);
  await expect(page.getByText('Suggested total:')).toBeVisible();
  await expect(page.getByText('100%')).toBeVisible();
  await expect(page.getByText('Min total:')).toHaveCount(0);
  await expect(page.getByText('Max total:')).toHaveCount(0);
  await expect(page.getByTestId('templates-allocation-warning')).toHaveCount(0);
});

test('saved templates can be applied in the wizard without conflicting with template, AI, or scratch flows', async ({
  page,
}) => {
  const { store, agreement, milestoneState } = await installWorkflowMocks(page);

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await page.getByTestId('step1-job-description-input').fill(
    'Kitchen remodel with demo, cabinets, countertops, appliance reconnects, plumbing, electrical, and finish work.'
  );
  await page.getByTestId('step1-find-best-starting-point-button').click();
  await expect(page.getByTestId('step1-ai-setup-result')).toBeVisible();
  await expect(page.getByTestId('step1-ai-setup-result')).toContainText('Kitchen Remodel Starter');
  await Promise.all([
    page.waitForResponse(
      (resp) => resp.url().includes('/apply-template/') && resp.status() === 200
    ),
    page.getByTestId('step1-ai-setup-apply-template').click(),
  ]);

  const matchedTemplate = store.templates.find((row) => row.name === 'Kitchen Remodel Starter');
  expect(matchedTemplate).toBeTruthy();
  milestoneState.items = scheduleMilestonesFromStart(matchedTemplate.milestones, '').map((row, idx) => ({
    id: row.id,
    agreement: agreement.id || AGREEMENT_ID,
    order: idx + 1,
    title: row.title,
    description: row.description,
    amount: row.suggested_amount_fixed || '0.00',
    normalized_milestone_type: row.normalized_milestone_type || '',
    start_date: row.start_date || '',
    completion_date: row.completion_date || '',
    due_date: row.due_date || row.completion_date || '',
  }));
  agreement.milestone_count = milestoneState.items.length;
  agreement.step_status = 'step2';
  agreement.selected_template_id = matchedTemplate.id;
  agreement.selected_template = {
    id: matchedTemplate.id,
    name: matchedTemplate.name,
    project_type: matchedTemplate.project_type,
    project_subtype: matchedTemplate.project_subtype,
  };
  agreement.selected_template_name_snapshot = matchedTemplate.name;
  agreement.project_title = matchedTemplate.name;
  agreement.title = matchedTemplate.name;
  agreement.project_type = matchedTemplate.project_type;
  agreement.project_subtype = matchedTemplate.project_subtype;
  agreement.description = matchedTemplate.description;

  expect(agreement.id).toBeTruthy();

  await page.goto(`/app/agreements/${agreement.id}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByText('Kitchen Remodel Starter')).toBeVisible();
  await expect(page.getByText('3 milestones').first()).toBeVisible();
});

test('agreement milestone surfaces show human-friendly milestone type labels outside Templates', async ({
  page,
}) => {
  const initialAgreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Kitchen Remodel Starter',
    title: 'Kitchen Remodel Starter',
    project_type: 'Remodel',
    project_subtype: 'Kitchen Remodel',
    payment_mode: 'escrow',
    payment_structure: 'progress',
    description: 'Kitchen remodel agreement with staged milestone guidance.',
    homeowner: null,
    status: 'draft',
    compliance_warning: { warning_level: 'none', message: '' },
    selected_template_id: 88,
    selected_template: { id: 88, name: 'Kitchen Remodel Starter' },
    selected_template_name_snapshot: 'Kitchen Remodel Starter',
  };

  const { milestoneState } = await installWorkflowMocks(page, {
    agreement: initialAgreement,
  });
  milestoneState.items = [
    {
      id: 881,
      agreement: AGREEMENT_ID,
      order: 1,
      title: 'Demo & protection',
      description: 'Protect the home and prep the work area.',
      amount: '1200.00',
      normalized_milestone_type: 'site_prep',
    },
    {
      id: 882,
      agreement: AGREEMENT_ID,
      order: 2,
      title: 'Cabinets & surfaces',
      description: 'Install cabinet and surface scope.',
      amount: '3400.00',
      normalized_milestone_type: 'cabinetry',
    },
    {
      id: 883,
      agreement: AGREEMENT_ID,
      order: 3,
      title: 'Fixtures & closeout',
      description: 'Complete final fixtures and walkthrough.',
      amount: '1800.00',
      normalized_milestone_type: 'inspection',
    },
  ];

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  async function expectMilestoneEditType(title, typeLabel) {
    const card = page.locator('article').filter({ hasText: title });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByTestId('step2-edit-estimate-type-label')).toContainText(typeLabel);
    await expect(page.getByTestId('step2-edit-estimate-type-label')).not.toContainText(
      String(typeLabel).toLowerCase().replace(/\s+/g, '_')
    );
    await page.getByRole('button', { name: 'Cancel' }).click();
  }

  await expectMilestoneEditType('Demo & protection', 'Site Prep');
  await expectMilestoneEditType('Cabinets & surfaces', 'Cabinetry');
  await expectMilestoneEditType('Fixtures & closeout', 'Inspection');
});

test('AI can recommend and apply a matching template in step 1 while keeping the flow coherent', async ({
  page,
}) => {
  await installWorkflowMocks(page);

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await page
    .getByTestId('step1-job-description-input')
    .fill(
      'Full kitchen remodel with demolition, cabinet replacement, countertops, appliance reconnects, plumbing, electrical, and finish work.'
    );
  await page.getByTestId('step1-find-best-starting-point-button').click();

  await expect(page.getByTestId('step1-ai-setup-result')).toContainText(
    'Kitchen Remodel Starter'
  );
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('/api/projects/agreements/') &&
      response.url().includes('/apply-template/') &&
      response.request().method() === 'POST'
    ),
    page.getByTestId('step1-ai-setup-apply-template').click(),
  ]);

  await expect(page.locator('select[name="project_subtype"]')).toHaveValue('Kitchen Remodel');

  await expect(page.getByText('Kitchen Remodel Starter').first()).toBeVisible();
  await expect(page.getByText('3 milestones').first()).toBeVisible();
});

test('template AI top action generates a draft from a prompt and template context', async ({
  page,
}) => {
  await installWorkflowMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  const libraryCards = page.locator('[data-testid^="template-discovery-card-"]');
  await expect(libraryCards).toHaveCount(2);
  await expect(page.getByText('Start a new template')).toBeVisible();
  await expect(page.getByTestId('templates-draft-editor')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New Template Draft' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Generate Draft with Project Assistant' })).toHaveCount(1);

  await page.getByTestId('templates-ai-prompt-input').fill('Deck build with framing, decking, railings, and closeout.');
  await page.getByTestId('templates-generate-ai-button').click();

  await expect(page.getByTestId('templates-draft-editor')).toBeVisible();
  await expect(page.getByTestId('templates-ai-unsaved-banner')).toContainText(
    'Review and edit below, then click Save Template'
  );
  await expect(page.getByTestId('templates-unsaved-draft-badge')).toContainText('Unsaved Draft');
  await expect(page.getByTestId('templates-save-button')).toBeVisible();
  await expect(page.getByTestId('templates-detail-name')).toContainText('Deck Build Template');
  await expect(page.getByTestId('templates-generated-ai-summary')).toContainText('About 12 working days');
  await expect(page.getByTestId('templates-generated-ai-summary')).toContainText('$12,000-$18,000');
  await expect(page.getByTestId('templates-generated-ai-summary')).toContainText('Milestone-Based Assistance');
  await expect(page.getByTestId('templates-template-insights')).toBeVisible();
  await expect(page.getByTestId('templates-template-insights')).toContainText(
    '2 milestones is within the expected range'
  );
  await expect(page.getByTestId('templates-template-insights')).toContainText(
    'Pricing guidance is included.'
  );
  await expect(page.getByTestId('templates-description-input')).toHaveValue(/Reusable deck scope/);
  await expect(libraryCards).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Deck Build Template' })).toHaveCount(0);

  await page.getByTestId('templates-tab-milestones').click();
  await expect(page.getByTestId('templates-milestone-title-1')).toHaveValue('Layout & permits');
  await expect(page.getByTestId('templates-milestone-title-2')).toHaveValue('Framing & structure');
  await page.getByTestId('templates-tab-pricing').click();
  await expect(page.getByTestId('templates-generated-pricing-guidance')).toContainText(
    '$12,000-$18,000'
  );
  await expect(page.getByTestId('templates-generated-pricing-guidance')).toContainText(
    'Layout & permits: 20%'
  );
  await page.getByTestId('templates-tab-materials').click();
  await expect(page.getByTestId('templates-generated-materials-guidance')).toContainText(
    'Project Materials'
  );
  await expect(page.getByTestId('templates-generated-materials-guidance')).toContainText(
    'Decking boards'
  );

  await page.getByTestId('templates-save-button').click();
  await expect(page.getByText('Template created.')).toBeVisible();
  await expect(libraryCards).toHaveCount(3);
  await expect(
    page.locator('[data-testid^="template-discovery-card-"]').filter({ hasText: 'Deck Build Template' })
  ).toHaveCount(1);
});

test('system templates stay read-only and can be duplicated into my templates', async ({ page }) => {
  await installWorkflowMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('templates-market-tab-system').click();

  await expect(page.getByTestId('templates-system-empty-state')).toContainText(
    'Select a system template to preview it.'
  );
  await expect(page.getByTestId('templates-system-empty-state')).toContainText(
    'duplicated into My Templates'
  );
  await expect(page.getByTestId('templates-new-draft-button')).toHaveCount(0);
  await expect(page.getByTestId('templates-generate-ai-button')).toHaveCount(0);
  await expect(page.getByTestId('templates-ai-prompt-input')).toHaveCount(0);

  await page.getByTestId('template-discovery-card-1').click();
  await expect(page.getByTestId('templates-detail-name')).toContainText('System Roof Replacement');
  await expect(page.getByTestId('template-discovery-card-1')).toContainText('System / Built-in');
  await expect(page.getByText('Marketplace Signals')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Template' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(page.getByTestId('template-visibility-private')).toHaveCount(0);
  await expect(page.getByTestId('template-visibility-regional')).toHaveCount(0);
  await expect(page.getByTestId('template-visibility-public')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use Template' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save to My Templates' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to Start' })).toBeVisible();
  await expect(page.getByTestId('templates-template-insights')).toBeVisible();

  await page.getByRole('button', { name: 'Save to My Templates' }).click();
  await expect(page.getByTestId('templates-draft-editor')).toBeVisible();
  await expect(page.getByTestId('templates-unsaved-draft-badge')).toBeVisible();
  await expect(page.getByTestId('templates-new-draft-button')).toHaveCount(0);
  await expect(page.getByTestId('templates-generate-ai-button')).toHaveCount(0);
  await expect(page.getByTestId('templates-ai-prompt-input')).toHaveCount(0);
  await expect(page.getByTestId('templates-detail-name')).toContainText('System Roof Replacement');
  await expect(page.getByTestId('template-visibility-private')).toHaveCount(0);

  await page.getByTestId('templates-save-button').click();
  await expect(page.getByText('Template saved to your templates')).toBeVisible();
  await expect(page.getByTestId('templates-market-tab-mine')).toHaveClass(/bg-indigo-600/);
  await expect(page.getByTestId('template-discovery-card-1')).toHaveCount(0);
  await expect(page.locator('[data-testid^="template-discovery-card-"]')).toHaveCount(3);
  await expect(
    page.locator('[data-testid^="template-discovery-card-"]').filter({ hasText: 'System Roof Replacement' })
  ).toHaveCount(1);
});

test('templates page can return to a neutral start state and top-level AI uses a blank seed', async ({
  page,
}) => {
  await installWorkflowMocks(page);

  let observedPayload = null;
  await page.route('**/api/projects/templates/ai/create-from-scope/', async (route) => {
    observedPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        name: 'Deck Build Template',
        project_type: 'Outdoor',
        project_subtype: 'Deck Build',
        description: 'Reusable deck scope covering layout, framing, decking, railings, and closeout.',
        estimated_days: 12,
        default_scope: 'Reusable deck scope covering layout, framing, decking, railings, and closeout.',
        default_clarifications: [],
        project_materials_hint: 'Decking boards, framing lumber, rail components, fasteners.',
        milestones: [
          {
            title: 'Layout & permits',
            description: 'Confirm layout and permits.',
            sort_order: 1,
            normalized_milestone_type: 'site_prep',
            suggested_amount_fixed: 1000,
            suggested_amount_low: 800,
            suggested_amount_high: 1200,
            pricing_confidence: 'medium',
            pricing_source_note: 'Initial planning allowance.',
            start_offset: 0,
            duration_days: 1,
            pricing_advisory: true,
            recommended_days_from_start: 1,
            recommended_duration_days: 1,
            materials_hint: 'Protection materials',
            is_optional: false,
          },
        ],
        pricing: {
          total_range: '$12,000-$18,000',
          milestone_percentages: [{ milestone: 'Layout & permits', percentage: '20%', notes: '' }],
        },
        materials: [
          {
            category: 'Project Materials',
            options: ['Decking boards', 'Framing lumber'],
            notes: 'Exterior-rated materials',
          },
        ],
        timeline: 'About 12 working days',
        clarification_questions: ['Confirm access'],
        sections_status: {
          description: 'generated',
          milestones: 'generated',
          pricing: 'generated',
          materials: 'generated',
          clarifications: 'generated',
        },
      }),
    });
  });

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('template-discovery-card-88').click();
  await expect(page.getByTestId('templates-detail-name')).toContainText('Kitchen Remodel Starter');
  await expect(page.getByTestId('templates-template-insights')).toBeVisible();
  await expect(page.getByTestId('templates-template-insights')).toContainText(
    'Pricing guidance could benefit from review.'
  );
  await expect(page.getByText('Marketplace Signals')).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to Start' }).click();
  await expect(page.getByText('Start a new template')).toBeVisible();
  await expect(page.getByTestId('templates-draft-editor')).toHaveCount(0);

  await page.getByTestId('templates-ai-prompt-input').fill('Deck build with framing, decking, railings, and closeout.');
  await page.getByTestId('templates-generate-ai-button').click();

  await expect.poll(() => observedPayload).not.toBeNull();
  expect(observedPayload.name).toBe('');
  expect(observedPayload.project_type).toBe('');
  expect(observedPayload.project_subtype).toBe('');
  expect(observedPayload.project_materials_hint ?? '').toBe('');
  expect(observedPayload.description).toBe('Deck build with framing, decking, railings, and closeout.');

  await expect(page.getByTestId('templates-draft-editor')).toBeVisible();
  await expect(page.getByTestId('templates-detail-name')).toContainText('Deck Build Template');
  await expect(page.getByTestId('templates-template-insights')).toBeVisible();
  await expect(page.getByTestId('templates-template-insights')).toContainText(
    'Pricing guidance is included.'
  );
  await expect(page.getByText('Marketplace Signals')).toHaveCount(0);
});

test('template AI shows section-aware progress while generation is pending', async ({ page }) => {
  await installWorkflowMocks(page);

  await page.route('**/api/projects/templates/ai/create-from-scope/', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        name: 'Slow Deck Build Template',
        project_type: 'Outdoor',
        project_subtype: 'Deck Build',
        description: 'Reusable deck scope covering layout, framing, decking, railings, and closeout.',
        estimated_days: 12,
        default_scope: 'Reusable deck scope covering layout, framing, decking, railings, and closeout.',
        default_clarifications: [],
        project_materials_hint: 'Decking boards, framing lumber, rail components, fasteners.',
        milestones: [
          {
            title: 'Layout & permits',
            description: 'Confirm layout and permits.',
            sort_order: 1,
            normalized_milestone_type: 'site_prep',
            suggested_amount_fixed: 1000,
            suggested_amount_low: 800,
            suggested_amount_high: 1200,
            pricing_confidence: 'medium',
            pricing_source_note: 'Initial planning allowance.',
            start_offset: 0,
            duration_days: 1,
            pricing_advisory: true,
            recommended_days_from_start: 1,
            recommended_duration_days: 1,
            materials_hint: 'Protection materials',
            is_optional: false,
          },
        ],
        pricing: {
          total_range: '$12,000-$18,000',
          milestone_percentages: [{ milestone: 'Layout & permits', percentage: '20%', notes: '' }],
        },
        materials: [
          {
            category: 'Project Materials',
            options: ['Decking boards', 'Framing lumber'],
            notes: 'Exterior-rated materials',
          },
        ],
        timeline: 'About 12 working days',
        clarification_questions: ['Confirm access'],
        sections_status: {
          description: 'generated',
          milestones: 'generated',
          pricing: 'generated',
          materials: 'generated',
          clarifications: 'generated',
        },
      }),
    });
  });

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('templates-ai-prompt-input').fill('Deck build with framing, decking, railings, and closeout.');
  await page.getByTestId('templates-generate-ai-button').click();

  await expect(page.getByTestId('templates-ai-progress')).toBeVisible();
  await expect(page.getByTestId('templates-ai-progress')).toContainText('Step 1 of 5');
  await expect(page.getByTestId('templates-ai-progress')).toContainText('Generating description');
  await expect(page.getByTestId('templates-draft-editor')).toBeVisible();
});

test('template AI failure keeps the draft editor open and shows recovery actions', async ({
  page,
}) => {
  await installWorkflowMocks(page);

  await page.route('**/api/projects/templates/ai/create-from-scope/', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: 'AI service unavailable right now.',
      }),
    });
  });

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('templates-ai-prompt-input').fill('Bathroom remodel with tile, fixtures, and closeout.');
  await page.getByTestId('templates-generate-ai-button').click();

  await expect(page.getByTestId('templates-draft-editor')).toBeVisible();
  await expect(page.getByTestId('templates-ai-error-banner')).toContainText(
    'AI couldn’t finish this template right now. Your draft is still open.'
  );
  await expect(page.getByRole('button', { name: 'Retry AI Generation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate Description Only' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue Manually' })).toBeVisible();
  await expect(page.getByTestId('templates-unsaved-draft-badge')).toBeVisible();
});

test('template AI partial response still fills supported sections and marks recovery state', async ({
  page,
}) => {
  await installWorkflowMocks(page);

  await page.route('**/api/projects/templates/ai/create-from-scope/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        name: 'Partial AI Draft',
        project_type: 'Remodel',
        project_subtype: 'Kitchen Remodel',
        description: 'Partial AI description',
        estimated_days: 10,
        default_scope: 'Partial AI description',
        default_clarifications: [],
        project_materials_hint: 'Cabinetry, trim, fasteners',
        milestones: [
          {
            title: 'Planning',
            description: 'Plan the work',
            sort_order: 1,
            normalized_milestone_type: 'site_prep',
            suggested_amount_fixed: 1200,
            suggested_amount_low: 1000,
            suggested_amount_high: 1400,
            pricing_confidence: 'medium',
            pricing_source_note: 'Fallback plan',
            start_offset: 0,
            duration_days: 1,
            pricing_advisory: true,
            recommended_days_from_start: 1,
            recommended_duration_days: 1,
            materials_hint: 'Protection materials',
            is_optional: false,
          },
        ],
        pricing: {
          total_range: '$9,000-$14,000',
          milestone_percentages: [
            { milestone: 'Planning', percentage: '20%', notes: 'Initial planning' },
          ],
        },
        materials: [
          {
            category: 'Project Materials',
            options: ['Cabinetry', 'Trim'],
            notes: 'Fallback materials',
          },
        ],
        timeline: 'About 10 working days',
        clarification_questions: ['Confirm access'],
        sections_status: {
          description: 'generated',
          milestones: 'generated',
          pricing: 'fallback',
          materials: 'generated',
          clarifications: 'fallback',
        },
        _partial: true,
      }),
    });
  });

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('templates-ai-prompt-input').fill('Kitchen remodel with cabinets and finish work.');
  await page.getByTestId('templates-generate-ai-button').click();

  await expect(page.getByTestId('templates-draft-editor')).toBeVisible();
  await expect(page.getByTestId('templates-ai-unsaved-banner')).toBeVisible();
  await expect(page.getByTestId('templates-description-input')).toHaveValue('Partial AI description');
  await page.getByTestId('templates-tab-pricing').click();
  await expect(page.getByTestId('templates-generated-pricing-guidance')).toContainText('$9,000-$14,000');
  await expect(page.getByTestId('templates-ai-recovery-banner')).toBeVisible();
  await expect(page.getByTestId('templates-ai-recovery-banner')).toContainText('fallback sections');
  await expect(page.getByTestId('templates-ai-recovery-banner')).toContainText('pricing guidance');
  await expect(page.getByTestId('templates-ai-recovery-banner')).toContainText('clarifying questions');
});

test('new template draft opens a blank editor immediately', async ({ page }) => {
  await installWorkflowMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('templates-new-draft-button').click();

  await expect(page.getByTestId('templates-draft-editor')).toBeVisible();
  await expect(page.getByTestId('templates-unsaved-draft-badge')).toBeVisible();
  await expect(page.getByTestId('templates-save-button')).toBeVisible();
  await expect(page.getByTestId('templates-name-input')).toHaveValue('');
  await expect(page.getByTestId('templates-description-input')).toHaveValue('');
  await expect(page.getByText('Unsaved Draft')).toBeVisible();
});

test('template inline AI can improve description field text', async ({ page }) => {
  await installWorkflowMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('templates-new-draft-button').click();
  await page.getByTestId('templates-name-input').fill('Kitchen Remodel Starter');
  await page.getByTestId('templates-project-type-input').fill('Remodel');
  await page.getByTestId('templates-project-subtype-input').fill('Kitchen Remodel');

  await expect(page.getByTestId('templates-description-input')).toHaveValue('');

  await page.getByTestId('templates-ai-improve-description-button').click();

  await expect(page.getByTestId('templates-description-input')).toHaveValue(
    /Scope of Work/
  );
  await expect(page.getByTestId('templates-description-input')).toHaveValue(
    /Included Work Phases/
  );
  await expect(page.getByTestId('templates-description-input')).not.toHaveValue(
    /Customer Responsibilities/
  );
  await expect(page.getByTestId('templates-description-input')).not.toHaveValue(
    /Contractor Responsibilities/
  );
  await expect(page.getByTestId('templates-description-input')).not.toHaveValue(/Exclusions/i);
  await expect(page.getByTestId('templates-assumptions-input')).toHaveValue(
    /Customer Responsibilities/
  );
  await expect(page.getByTestId('templates-assumptions-input')).toHaveValue(
    /Contractor Responsibilities/
  );
  await expect(page.getByTestId('templates-exclusions-input')).toHaveValue(
    /The following are not included unless explicitly added/
  );
});

test('template AI improves shed build descriptions into structured contractor scope', async ({
  page,
}) => {
  await installWorkflowMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('templates-new-draft-button').click();
  await page.getByTestId('templates-name-input').fill('Shed Build Starter');
  await page.getByTestId('templates-project-type-input').fill('Outdoor');
  await page.getByTestId('templates-project-subtype-input').fill('Shed Build');
  await page.getByTestId('templates-description-input').fill('Backyard shed build scope.');

  await page.getByTestId('templates-ai-improve-description-button').click();

  await expect(page.getByTestId('templates-description-input')).toHaveValue(
    /Scope of Work/
  );
  await expect(page.getByTestId('templates-description-input')).toHaveValue(
    /Included Work Phases/
  );
  await expect(page.getByTestId('templates-description-input')).not.toHaveValue(/Exclusions/i);
  await expect(page.getByTestId('templates-description-input')).not.toHaveValue(
    /Customer Responsibilities/
  );
  await expect(page.getByTestId('templates-description-input')).toHaveValue(
    /Optional Components/
  );
  await expect(page.getByTestId('templates-assumptions-input')).toHaveValue(
    /Customer Responsibilities/
  );
  await expect(page.getByTestId('templates-assumptions-input')).toHaveValue(
    /Contractor Responsibilities/
  );
  await expect(page.getByTestId('templates-exclusions-input')).toHaveValue(
    /The following are not included unless explicitly added/
  );
  await expect(page.getByTestId('templates-description-input')).not.toHaveValue(/efficiency/i);
  await expect(page.getByTestId('templates-description-input')).not.toHaveValue(/adaptable/i);
  await expect(page.getByTestId('templates-description-input')).not.toHaveValue(
    /various conditions/i
  );
  await expect(page.getByTestId('templates-description-input')).not.toHaveValue(
    /standard process/i
  );
  await expect(page.getByTestId('templates-assumptions-input')).not.toHaveValue(/efficiency/i);
  await expect(page.getByTestId('templates-exclusions-input')).not.toHaveValue(/efficiency/i);
});

test('template inline AI can suggest type and subtype from the current scope', async ({ page }) => {
  await installWorkflowMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('templates-new-draft-button').click();
  await page.getByTestId('templates-name-input').fill('Deck Build Starter');
  await page
    .getByTestId('templates-description-input')
    .fill('Reusable deck build scope covering layout, framing, decking, rails, and closeout.');

  await page.getByTestId('templates-ai-suggest-button').click();

  await expect(page.getByTestId('templates-project-type-input')).toHaveValue('Outdoor');
  await expect(page.getByTestId('templates-project-subtype-input')).toHaveValue('Deck Build');
});

test('template milestone editor no longer shows a type dropdown and still saves milestones', async ({
  page,
}) => {
  const { store } = await installWorkflowMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('templates-new-draft-button').click();
  await page.getByTestId('templates-name-input').fill('Milestone Draft Template');
  await page.getByTestId('templates-project-type-input').fill('Remodel');
  await page.getByTestId('templates-project-subtype-input').fill('Kitchen Remodel');
  await page.getByTestId('templates-tab-milestones').click();

  await expect(page.getByTestId('templates-milestone-type-1')).toHaveCount(0);

  await page.getByTestId('templates-milestone-title-1').fill('Project setup');
  await page.getByTestId('templates-milestone-description-1').fill(
    'Prepare the site and confirm the work sequence.'
  );
  await page.getByTestId('templates-add-milestone-button').click();
  await page.getByTestId('templates-milestone-title-2').fill('Closeout');
  await page.getByTestId('templates-milestone-description-2').fill(
    'Review the work and finalize the template scope.'
  );

  await page.getByTestId('templates-save-button').click();

  await expect(page.getByText('Template created.')).toBeVisible();
  await expect
    .poll(() => store.templates.find((row) => row.name === 'Milestone Draft Template'))
    .toMatchObject({
      name: 'Milestone Draft Template',
      milestones: [
        { title: 'Project setup', start_offset: 0, duration_days: 1 },
        { title: 'Closeout', start_offset: 1, duration_days: 1 },
      ],
    });
  await expect(page.getByTestId('templates-detail-name')).toContainText(
    'Milestone Draft Template'
  );
});

test('template assumptions and exclusions persist after save reload and reselection', async ({
  page,
}) => {
  const { store } = await installWorkflowMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('templates-new-draft-button').click();
  await page.getByTestId('templates-name-input').fill('Scope Persistence Template');
  await page.getByTestId('templates-project-type-input').fill('Outdoor');
  await page.getByTestId('templates-project-subtype-input').fill('Shed Build');
  await page.getByTestId('templates-description-input').fill('Reusable shed build scope.');
  await page.getByTestId('templates-tab-milestones').click();
  await page.getByTestId('templates-milestone-title-1').fill('Project setup');
  await page.getByTestId('templates-milestone-description-1').fill(
    'Confirm site access and prepare the reusable work plan.'
  );
  await page.getByTestId('templates-tab-setup').click();
  await page.getByTestId('templates-exclusions-input').fill(
    'Exclusions\n- The following are not included unless explicitly added:\n- Electrical\n- Plumbing'
  );
  await page.getByTestId('templates-assumptions-input').fill(
    'Customer Responsibilities\n- Customer will confirm selections.\n\nContractor Responsibilities\n- Contractor will verify measurements and site conditions.'
  );

  await page.getByTestId('templates-save-button').click();

  await expect.poll(() =>
    store.templates.some((row) => row.name === 'Scope Persistence Template')
  ).toBe(true);
  const savedTemplate = store.templates.find((row) => row.name === 'Scope Persistence Template');
  expect(savedTemplate).toMatchObject({
    exclusions_text:
      'Exclusions\n- The following are not included unless explicitly added:\n- Electrical\n- Plumbing',
    assumptions_text:
      'Customer Responsibilities\n- Customer will confirm selections.\n\nContractor Responsibilities\n- Contractor will verify measurements and site conditions.',
  });

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });
  await page.getByTestId(`template-discovery-card-${savedTemplate.id}`).click();

  await expect(page.getByTestId('templates-exclusions-input')).toHaveValue(
    'Exclusions\n- The following are not included unless explicitly added:\n- Electrical\n- Plumbing'
  );
  await expect(page.getByTestId('templates-assumptions-input')).toHaveValue(
    'Customer Responsibilities\n- Customer will confirm selections.\n\nContractor Responsibilities\n- Contractor will verify measurements and site conditions.'
  );
  await expect(page.getByTestId('templates-description-input')).toHaveValue(
    'Reusable shed build scope.'
  );
});

test('template schedule auto-sequence button computes sequential offsets from durations', async ({
  page,
}) => {
  const { store } = await installWorkflowMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('templates-new-draft-button').click();
  await page.getByTestId('templates-name-input').fill('Auto Sequence Template');
  await page.getByTestId('templates-project-type-input').fill('Outdoor');
  await page.getByTestId('templates-project-subtype-input').fill('Shed Build');
  await page.getByTestId('templates-tab-milestones').click();

  await page.getByTestId('templates-milestone-title-1').fill('Site prep');
  await page.getByTestId('templates-add-milestone-button').click();
  await page.getByTestId('templates-milestone-title-2').fill('Framing');
  await page.getByTestId('templates-add-milestone-button').click();
  await page.getByTestId('templates-milestone-title-3').fill('Cleanup');

  await page.getByTestId('templates-tab-schedule').click();
  await page.getByTestId('templates-milestone-duration-1').fill('2');
  await page.getByTestId('templates-milestone-duration-2').fill('3');
  await page.getByTestId('templates-milestone-duration-3').fill('1');
  await page.getByTestId('templates-auto-sequence-timeline').click();

  await expect(page.getByTestId('templates-milestone-start-offset-1')).toHaveValue('0');
  await expect(page.getByTestId('templates-milestone-start-offset-2')).toHaveValue('2');
  await expect(page.getByTestId('templates-milestone-start-offset-3')).toHaveValue('5');

  await page.getByTestId('templates-save-button').click();

  await expect.poll(() => {
    const saved = store.templates.find((row) => row.name === 'Auto Sequence Template');
    return saved ? saved.milestones.map((row) => row.start_offset) : null;
  }).toEqual([0, 2, 5]);
});

test('template AI-generated milestones still render while type controls stay hidden', async ({
  page,
}) => {
  await installWorkflowMocks(page);

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('templates-ai-prompt-input').fill(
    'Kitchen remodel with cabinets, trim, and finish work.'
  );
  await page.getByTestId('templates-generate-ai-button').click();

  await expect(page.getByTestId('templates-draft-editor')).toBeVisible();
  await expect(page.getByTestId('templates-milestone-type-1')).toHaveCount(0);
  await page.getByTestId('templates-tab-milestones').click();
  await expect(page.getByTestId('templates-milestone-title-1')).toHaveValue(
    'Planning & site protection'
  );
  await expect(page.getByTestId('templates-milestone-description-1')).toHaveValue(
    'Confirm reusable kitchen scope and protect the work area.'
  );
});

test('wizard save as template stores the current setup and supports reuse in a later wizard visit', async ({
  page,
}) => {
  const initialAgreement = {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    project_title: 'Bathroom Remodel',
    title: 'Bathroom Remodel',
    project_type: 'Remodel',
    project_subtype: 'Bathroom Remodel',
    payment_mode: 'escrow',
    payment_structure: 'progress',
    description:
      'Complete bathroom remodel with demo, waterproofing, tile, vanity, tub and shower updates, and finish work.',
    homeowner: null,
    status: 'draft',
    compliance_warning: { warning_level: 'none', message: '' },
    selected_template_id: null,
    selected_template: null,
    selected_template_name_snapshot: '',
  };

  const { store, milestoneState } = await installWorkflowMocks(page, {
    agreement: initialAgreement,
  });

  milestoneState.items = [
    {
      id: 301,
      agreement: AGREEMENT_ID,
      order: 1,
      title: 'Demo & prep',
      description: 'Protect the work area and remove existing bathroom finishes.',
      amount: '1200.00',
    },
    {
      id: 302,
      agreement: AGREEMENT_ID,
      order: 2,
      title: 'Waterproof & tile',
      description: 'Prep wet areas and complete tile installation.',
      amount: '2400.00',
    },
    {
      id: 303,
      agreement: AGREEMENT_ID,
      order: 3,
      title: 'Fixtures & walkthrough',
      description: 'Install fixtures, finish trim, and review the completed work.',
      amount: '1800.00',
    },
  ];

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });

  await page.getByTestId('step2-save-as-template').click();

  await expect(page.getByTestId('save-template-name-input')).toBeVisible();
  await expect(page.getByTestId('save-template-scope-input')).toBeVisible();
  await expect(page.getByTestId('save-template-context-card')).toHaveClass(/bg-slate-950/);
  await expect(page.getByTestId('save-template-scope-input')).toHaveValue(/Included Work:/);
  await expect(page.getByTestId('save-template-scope-input')).toHaveValue(/Remove existing materials/);
  await expect(page.getByTestId('save-template-scope-input')).toHaveValue(/Customer Responsibilities:/);
  await expect(page.getByTestId('save-template-scope-input')).toHaveValue(/Materials:/);
  await expect(page.getByTestId('save-template-scope-input')).toHaveValue(/Assumptions:/);
  await expect(page.getByTestId('save-template-scope-preview')).toContainText('Included Work:');
  await expect(page.getByTestId('save-template-milestone-preview')).toContainText(
    '1. Demo & prep'
  );
  await expect(page.getByTestId('save-template-milestone-preview')).toContainText(
    'Protect the work area and remove existing bathroom finishes.'
  );
  await expect(page.getByTestId('save-template-milestone-preview')).toContainText(
    '2. Waterproof & tile'
  );
  await page.getByTestId('save-template-scope-input').fill('');
  await page.getByTestId('save-template-generate-reusable-scope').click();
  await expect(page.getByTestId('save-template-scope-input')).toHaveValue(/Included Work:/);
  await expect(page.getByTestId('save-template-scope-input')).toHaveValue(/Materials:/);

  await page.getByTestId('save-template-name-input').fill('Bathroom Remodel Reusable');
  await page.getByTestId('save-template-scope-input').fill(
    'Reusable bathroom remodel scope covering demo, waterproofing, tile, fixtures, and closeout.'
  );
  await page.getByTestId('save-template-note-input').fill(
    'Reusable bathroom remodel structure for future projects.'
  );
  await page.getByTestId('save-template-confirm-button').click();

  await expect.poll(() =>
    store.templates.some((row) => row.name === 'Bathroom Remodel Reusable')
  ).toBe(true);
  await expect.poll(() => {
    const saved = store.templates.find((row) => row.name === 'Bathroom Remodel Reusable');
    return saved
      ? {
          default_scope: saved.default_scope,
          milestoneOffsets: saved.milestones.map((row) => row.start_offset),
          pricing: saved.milestones.map((row) => row.suggested_amount_fixed),
        }
      : null;
  }).toMatchObject({
    default_scope: 'Reusable bathroom remodel scope covering demo, waterproofing, tile, fixtures, and closeout.',
    milestoneOffsets: [0, 1, 2],
    pricing: [null, null, null],
  });
  const savedTemplate = store.templates.find((row) => row.name === 'Bathroom Remodel Reusable');

  await page.goto('/app/templates', { waitUntil: 'domcontentloaded' });
  await page.getByTestId(`template-discovery-card-${savedTemplate.id}`).click();
  await expect(page.getByTestId('templates-description-input')).toHaveValue(
    'Reusable bathroom remodel scope covering demo, waterproofing, tile, fixtures, and closeout.'
  );

  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByTestId('step1-job-description-input')).toBeVisible();
  await page.getByTestId('step1-job-description-input').fill('Bathroom Remodel Reusable');
  await page.getByTestId('step1-find-best-starting-point-button').click();

  await expect(page.getByTestId('step1-ai-setup-result')).toContainText('Bathroom Remodel Reusable');
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('/api/projects/agreements/') &&
      response.url().includes('/apply-template/') &&
      response.request().method() === 'POST'
    ),
    page.getByTestId('step1-ai-setup-apply-template').click(),
  ]);

  await expect(page.getByTestId('step1-template-applied-summary')).toContainText(
    'Bathroom Remodel Reusable'
  );

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByText('Demo & prep')).toBeVisible();
  await expect(page.getByText('Waterproof & tile')).toBeVisible();
  await expect(page.getByText('Fixtures & walkthrough')).toBeVisible();
});

async function exerciseCentralAirTemplateMatch(page, agreement, milestoneState, template, prompt) {
  await page.goto('/app/agreements/new/wizard?step=1', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByTestId('step1-job-description-input')).toBeVisible();
  await page.getByTestId('step1-job-description-input').fill(prompt);
  await page.getByTestId('step1-find-best-starting-point-button').click();

  const recommendationCard = page.getByTestId('step1-ai-setup-result');
  await expect(recommendationCard).toBeVisible();
  await expect(recommendationCard.getByText('Template match found', { exact: true })).toBeVisible();
  await expect(recommendationCard.getByText(template.name, { exact: true })).toBeVisible();

  await expect(page.getByTestId('step1-ai-setup-apply-template')).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('/api/projects/agreements/') &&
      response.url().includes('/apply-template/') &&
      response.request().method() === 'POST'
    ),
    page.getByTestId('step1-ai-setup-apply-template').click(),
  ]);

  await expect(page.getByTestId('step1-template-applied-summary')).toContainText(
    template.name
  );
  await expect(page.getByText('2 milestones').first()).toBeVisible();
}

test('step 1 recommends a saved central air template for an exact match', async ({
  page,
}) => {
  const { store, agreement: draftAgreement, milestoneState } = await installWorkflowMocks(page);

  const centralAirTemplate = buildTemplate({
    id: 222,
    name: 'Central Air Installation',
    project_type: 'HVAC',
    project_subtype: 'HVAC Installation',
    description:
      'Central air installation with condenser, line set, thermostat, startup, and cleanup.',
    milestones: [
      buildMilestone(2221, 'Site prep', 'Confirm access, protect the area, and verify equipment placement.', 1),
      buildMilestone(2222, 'Install system', 'Set the condenser, line set, and thermostat connection.', 2),
    ],
  });
  store.templates.unshift(centralAirTemplate);

  await exerciseCentralAirTemplateMatch(
    page,
    draftAgreement,
    milestoneState,
    centralAirTemplate,
    'central air installation'
  );
});

test('step 1 recommends a saved central air template for an HVAC alias match', async ({
  page,
}) => {
  const { store, agreement: draftAgreement, milestoneState } = await installWorkflowMocks(page);

  const centralAirTemplate = buildTemplate({
    id: 222,
    name: 'Central Air Installation',
    project_type: 'HVAC',
    project_subtype: 'HVAC Installation',
    description:
      'Central air installation with condenser, line set, thermostat, startup, and cleanup.',
    milestones: [
      buildMilestone(2221, 'Site prep', 'Confirm access, protect the area, and verify equipment placement.', 1),
      buildMilestone(2222, 'Install system', 'Set the condenser, line set, and thermostat connection.', 2),
    ],
  });
  store.templates.unshift(centralAirTemplate);

  await exerciseCentralAirTemplateMatch(
    page,
    draftAgreement,
    milestoneState,
    centralAirTemplate,
    'central AC install'
  );
});
