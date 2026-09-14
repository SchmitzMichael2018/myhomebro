export const PUBLIC_FAQ_CATEGORIES = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    audience: 'all',
    items: [
      {
        id: 'what-is-myhomebro',
        question: 'What is MyHomeBro?',
        answer:
          'MyHomeBro is a home-project operating platform. It connects customer and job intake, estimates, agreements, milestones, payments, messages, photos, warranties, and project records so contractors and customers can understand what is happening and what comes next.',
      },
      {
        id: 'who-is-it-for',
        question: 'Who is MyHomeBro for?',
        answer:
          'MyHomeBro serves contractors, homeowners and customers, property managers, and—where a property workflow supports it—tenants. Each person sees tools and records appropriate to their role and authorized projects or properties.',
      },
      {
        id: 'contractor-marketplace',
        question: 'Is MyHomeBro a contractor marketplace?',
        answer:
          'MyHomeBro can route project requests to participating contractors, but it is also a project operating platform. Availability and matching depend on location, project details, and contractor participation. MyHomeBro does not guarantee that a contractor will be available or selected.',
      },
      {
        id: 'browser-or-app',
        question: 'Do I need to install the app?',
        answer:
          'No. You can use MyHomeBro from a supported web browser. Installing it is optional and provides a convenient app icon and faster access; it does not create a different account or unlock separate project features.',
      },
      {
        id: 'after-project-request',
        question: 'What happens after I submit a project request?',
        answer:
          'Your request becomes an organized project record and is routed through the contractor or marketplace path you selected. A participating contractor can review the details, ask questions, and prepare an estimate. Submitting a request does not approve an estimate, sign an agreement, or authorize payment.',
      },
      {
        id: 'obligation-to-hire',
        question:
          'Am I obligated to hire a contractor after submitting a request?',
        answer:
          'No. A project request starts the conversation. Review the contractor, scope, price, schedule, payment terms, and agreement before deciding whether to proceed.',
      },
      {
        id: 'agreement-amendments',
        question: 'Can an agreement be changed after it is signed?',
        answer:
          'Yes, through a documented amendment. It should identify what changed—including scope, price, schedule, milestones, materials, or warranty terms—and complete the required review and signatures before replacing the applicable agreement terms.',
      },
    ],
  },
  {
    id: 'contractors',
    label: 'For Contractors',
    audience: 'contractor',
    items: [
      {
        id: 'contractor-tools',
        question: 'What can contractors manage in MyHomeBro?',
        answer:
          'Contractors can manage customer intake, estimates, agreements, projects, milestones, schedules, payments, messages, photos, warranties, field records, and related operational work. Certain tools depend on account configuration, role, and enabled features.',
      },
      {
        id: 'estimates-agreements',
        question: 'Can I create estimates and agreements?',
        answer:
          'Yes. Contractors can prepare estimates and move approved project information into structured agreements. The contractor remains responsible for reviewing scope, pricing, milestones, signatures, and payment terms before sending them.',
      },
      {
        id: 'teams',
        question: 'Can I manage employees and subcontractors?',
        answer:
          'Yes. Supported contractor accounts can organize employees and subcontractors, assign appropriate access, and coordinate project responsibilities. Access depends on each person’s role, permissions, and project assignment.',
      },
      {
        id: 'employee-work-review',
        question:
          'Can I review employee or subcontractor work before sending it to the customer?',
        answer:
          'Yes. Assigned team members can submit milestone work for contractor review. The contractor can approve it, reject it, or return it for correction before the customer is asked to review the milestone.',
      },
      {
        id: 'accounting',
        question: 'Does MyHomeBro replace accounting software?',
        answer:
          'No. MyHomeBro organizes project estimates, payments, receipts, expenses, and operational records, but it is not a complete accounting, tax, payroll, or banking system. Contractors should continue using qualified accounting tools and professional advice where appropriate.',
      },
    ],
  },
  {
    id: 'homeowners',
    label: 'For Homeowners',
    audience: 'customer',
    items: [
      {
        id: 'homeowner-visibility',
        question: 'What can homeowners see and review?',
        answer:
          'Homeowners can use their customer workspace or secure links to review shared estimates, agreements, signatures, milestones, payment requests, updates, and project records. Visibility depends on their authorized access and the records connected to the project.',
      },
      {
        id: 'homeowner-communication',
        question: 'How do homeowners communicate with contractors?',
        answer:
          'Homeowners and contractors can keep project questions and updates connected to the relevant work. Notices may also arrive through secure email or SMS links when the user has provided the necessary contact information and consent.',
      },
      {
        id: 'property-records',
        question:
          'Can homeowners keep property, warranty, and project records?',
        answer:
          'Yes. Customer workspaces can organize project history, photos, documents, receipts, equipment details, warranties, and maintenance information. The available record depends on what users upload and what a contractor shares.',
      },
      {
        id: 'contractor-guarantees',
        question: 'Does MyHomeBro choose or guarantee contractors?',
        answer:
          'No. MyHomeBro may connect customers with participating contractors, but customers make their own hiring decisions. A visible verification status identifies only the checks it specifically describes. MyHomeBro does not guarantee availability, workmanship, pricing, schedules, or outcomes.',
      },
      {
        id: 'homeowner-cost',
        question:
          'Is it free for homeowners to create an account or submit a project request?',
        answer:
          'Yes. Homeowners can create an account and submit a project request without a MyHomeBro platform fee. Any project price, deposit, escrow funding, or other payment must be separately disclosed before authorization.',
      },
    ],
  },
  {
    id: 'projects-payments',
    label: 'Payments, Refunds, and Pricing',
    audience: 'all',
    items: [
      {
        id: 'payment-handling',
        question: 'How are payments handled?',
        answer:
          'Each payment is tied to an agreement, invoice, milestone, draw, expense, or direct-payment record. The customer sees the amount, method, applicable approval step, and status before acting. Card and bank processing is provided through the configured payment provider.',
      },
      {
        id: 'payment-method-differences',
        question:
          'What is the difference between escrow, direct pay, and a draw?',
        answer:
          'Escrow funding is held for documented project releases. Direct pay sends an authorized payment without using the project escrow balance. A draw is a documented request to release part of available project funding. The agreement and payment screen identify which method applies.',
      },
      {
        id: 'fund-release',
        question: 'Does MyHomeBro hold or release funds automatically?',
        answer:
          'Escrow-funded milestone invoices use the terms shown in the agreement. When the agreement provides for it, an undisputed invoice may be released after the 72-hour customer review period. A valid dispute or documented hold pauses the affected payment. Direct payments and draws follow their own authorization steps.',
      },
      {
        id: 'invoice-review-window',
        question:
          'What should a customer do during the 72-hour invoice review period?',
        answer:
          'Review the invoice, milestone description, completion information, and supporting records promptly. Approve it when acceptable, or use the available response or dispute workflow before the deadline if a specific issue needs attention. The displayed deadline is authoritative for that invoice.',
      },
      {
        id: 'payment-details',
        question: 'Are payment details stored by MyHomeBro?',
        answer:
          'Sensitive payment credentials are processed by configured third-party payment providers. MyHomeBro keeps the project-facing records needed to show requests, amounts, statuses, receipts, and activity. Never place card or bank credentials in ordinary messages or notes.',
      },
      {
        id: 'failed-payment',
        question: 'What happens if a payment fails?',
        answer:
          'A failed payment remains incomplete and displays an action-needed state. The user may need to verify the payment method, retry through the supported flow, or contact the contractor or support. A failed attempt does not mark the obligation as paid.',
      },
      {
        id: 'refunds-payment-disputes',
        question: 'Are refunds or payment disputes decided automatically?',
        answer:
          'No. MyHomeBro records the request, source, amount, reason, evidence, approvals, provider activity, and outcome, but it does not automatically decide who is entitled to money. A refund or allocation must follow the agreement, authorization, accepted resolution, or documented external decision.',
      },
      {
        id: 'homeowner-refund-request',
        question: 'How can a homeowner request a refund?',
        answer:
          'Open the project’s homeowner action center and choose Request Refund. Select the specific escrow funding, invoice, draw, reimbursement, or externally recorded payment; enter the amount and reason; then submit it for contractor review. Submitting a request does not move money by itself.',
      },
      {
        id: 'contractor-refund',
        question: 'How can a contractor issue or respond to a refund?',
        answer:
          'Open the agreement’s funding workspace to issue an eligible refund or review a customer request. The system validates the source, available amount, prior refunds, and required authorization before processing or recording the result.',
      },
      {
        id: 'partial-refund',
        question: 'Can a refund cover only part of a payment?',
        answer:
          'Yes. An eligible payment can be refunded in full or in part, and an accepted dispute resolution can allocate different amounts to the customer and contractor. Allocations must identify the correct sources, add up correctly, and stay within the available funds.',
      },
      {
        id: 'refund-timing',
        question:
          'How long does a completed refund take to reach the customer?',
        answer:
          'MyHomeBro records when a refund is submitted and when the provider reports it as successful. The customer’s bank or card issuer controls when the credit appears, so arrival time can vary after processing is complete.',
      },
      {
        id: 'unused-contingency',
        question: 'What happens to unused contingency funds?',
        answer:
          'Approved contingency expenses are billed against the documented reserve. After project closeout and the applicable grace period, eligible unused contingency can be returned to the customer. Pending expenses, disputes, or incomplete closeout steps may delay the return.',
      },
      {
        id: 'contractor-platform-fees',
        question: 'What does MyHomeBro cost contractors?',
        answer:
          'The current structure is a 3% platform fee during the contractor’s first 60 days of qualifying activity, then 4%. Contractors processing at least $20,000 in the prior calendar month qualify for a 3.5% rate. The project fee is capped at $750, or $650 while the volume rate applies. The displayed fee review controls each transaction.',
      },
      {
        id: 'promotional-fee-waivers',
        question:
          'How do promotional fee waivers or customer promotion codes work?',
        answer:
          'MyHomeBro may grant an eligible contractor a platform-fee waiver for a defined percentage and time period. Contractors may also offer supported promotion codes to customers. Eligibility, value, dates, limits, and the resulting price or fee must be shown before authorization.',
      },
      {
        id: 'stripe-processing-fees',
        question:
          'Are payment-processing fees separate from the MyHomeBro platform fee?',
        answer:
          'Yes. The payment provider may charge processing fees separately from MyHomeBro’s platform fee. The transaction breakdown should identify the project amount, platform fee, processing-related amounts when available, and net contractor amount before completion.',
      },
    ],
  },
  {
    id: 'assistant-capture',
    label: 'Smart Capture and Project Assistant',
    audience: 'all',
    items: [
      {
        id: 'project-assistant',
        question: 'What is Project Assistant?',
        answer:
          'Project Assistant explains project information, identifies missing details, organizes notes, and prepares drafts or suggested next steps. It is advisory and does not replace the person responsible for a project, financial, professional, or legal decision.',
      },
      {
        id: 'smart-capture',
        question: 'What is Smart Capture?',
        answer:
          'Smart Capture helps collect customer details, receipts, labels, photos, measurements, and field information. Captured information enters a review workflow so a person can confirm it before it becomes an authoritative business record.',
      },
      {
        id: 'ai-decisions',
        question:
          'Does AI make final decisions or automatically change records?',
        answer:
          'No. Project Assistant can prepare explanations, classifications, recommendations, or drafts, but it does not independently approve pricing, sign agreements, release payments, resolve disputes, authorize work, or publish changes. Consequential updates require human review and confirmation.',
      },
      {
        id: 'ai-review-unavailable',
        question:
          'Can users correct AI drafts, and what happens if AI is unavailable?',
        answer:
          'Yes. Users can review, edit, reject, or replace AI-assisted drafts before applying them. If Project Assistant is unavailable or cannot safely interpret the information, users can continue through the supported manual workflow.',
      },
    ],
  },
  {
    id: 'disputes-records',
    label: 'Disputes and Records',
    audience: 'all',
    items: [
      {
        id: 'dispute-process',
        question: 'How does the dispute process work?',
        answer:
          'A dispute identifies a specific issue and related milestone or payment, records each party’s statements and evidence, and places a source-specific hold when applicable. Required claim information and party responses generally receive four business days plus one final business-day grace period. Opening a dispute does not decide fault or automatically refund money.',
      },
      {
        id: 'legal-decisions',
        question:
          'Does MyHomeBro make legal decisions or automatic dispute outcomes?',
        answer:
          'No. MyHomeBro provides workflow and recordkeeping tools, not legal representation or legal advice. Project Assistant may summarize information and compare documented options, but it does not decide fault or legal rights.',
      },
      {
        id: 'evidence-payment-effect',
        question:
          'Can users upload evidence, and can a dispute affect payment?',
        answer:
          'Yes. The dispute workflow accepts relevant messages, photos, documents, and other evidence. A qualifying dispute can hold the identified milestone or payment; it does not automatically refund or award money.',
      },
      {
        id: 'missed-dispute-deadline',
        question:
          'What happens if someone does not provide required dispute information or a response?',
        answer:
          'The platform sends deadline and grace-period notices. If required claim information is still missing after the final grace period, the source-specific hold may close and the linked invoice can resume its normal review clock. That administrative closure is not a finding that either party was right or wrong.',
      },
      {
        id: 'duplicate-dispute',
        question: 'Can the same milestone or payment be disputed repeatedly?',
        answer:
          'Not while the same issue and source already have a dispute record. Add new statements, photos, or documents to the existing case. A materially different issue or a different milestone or payment may require its own dispute record.',
      },
      {
        id: 'work-pause',
        question: 'Does opening a dispute stop the entire project?',
        answer:
          'No. A payment dispute normally holds only the identified milestone or payment. Either party can separately request a documented work pause when safety, access, hostility, sequencing, or another serious condition makes continued work unreasonable. A pause does not itself terminate the agreement or return funds.',
      },
      {
        id: 'warranty-vs-dispute',
        question:
          'What is the difference between a warranty request and a dispute?',
        answer:
          'A warranty request asks the contractor to inspect or correct covered work after completion. A dispute formally records a disagreement about scope, performance, responsibility, or payment. Begin with the warranty workflow when the primary request is inspection or corrective work.',
      },
      {
        id: 'external-resolution',
        question: 'What if the conflict must be handled outside MyHomeBro?',
        answer:
          'The parties may need qualified legal, insurance, regulatory, or other professional assistance. MyHomeBro does not act as legal counsel. An authorized settlement, court order, arbitrator decision, or other third-party document can be uploaded so the record and any permitted escrow allocation can be reconciled.',
      },
    ],
  },
  {
    id: 'privacy-security',
    label: 'Privacy and Security',
    audience: 'all',
    items: [
      {
        id: 'project-visibility',
        question: 'Who can see project information?',
        answer:
          'Project and account information is limited to authenticated or securely linked users with the relevant role, ownership, permission, or assignment. Public contractor profiles do not make private customer, payment, agreement, or project records public.',
      },
      {
        id: 'record-sharing',
        question: 'Are customer and contractor records shared publicly?',
        answer:
          'Private customer, agreement, payment, message, and project records are not intended for public listing. Contractors may separately publish selected business profile, service, portfolio, review, or contact information. Necessary service-provider sharing is described in the Privacy Policy.',
      },
      {
        id: 'offline-data',
        question:
          'Does the installed app store private project information offline?',
        answer:
          'The installed app may keep the application shell available, but private project, customer, agreement, pricing, payment, and Capture data requires a verified server connection. Users should not expect complete offline access to sensitive records.',
      },
      {
        id: 'data-choices',
        question: 'Can users update or delete their data?',
        answer:
          'Users can update supported account information and may request account deletion where permitted by law. Some agreement, payment, dispute, audit, or legal records may need to be retained. Review the Privacy Policy or use authenticated Support for an account-specific request.',
      },
    ],
  },
];

export const PUBLIC_FAQ_ITEMS = PUBLIC_FAQ_CATEGORIES.flatMap((category) =>
  category.items.map((item) => ({
    ...item,
    category: category.label,
    categoryId: category.id,
    audience: item.audience || category.audience || 'all',
  }))
);

export const PUBLIC_FAQ_CURATED_IDS = [
  'what-is-myhomebro',
  'after-project-request',
  'contractor-marketplace',
  'homeowner-cost',
  'payment-method-differences',
  'invoice-review-window',
  'homeowner-refund-request',
  'contractor-platform-fees',
  'project-assistant',
  'ai-decisions',
  'dispute-process',
  'project-visibility',
];

export const PUBLIC_FAQ_CURATED_ITEMS = PUBLIC_FAQ_CURATED_IDS.map((id) =>
  PUBLIC_FAQ_ITEMS.find((item) => item.id === id)
).filter(Boolean);

export function buildPublicFaqJsonLd(items = PUBLIC_FAQ_ITEMS) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export function filterPublicFaqItems({
  query = '',
  audience = 'all',
  category = 'all',
} = {}) {
  const normalizedQuery = String(query || '')
    .trim()
    .toLowerCase();
  return PUBLIC_FAQ_ITEMS.filter((item) => {
    const matchesAudience =
      audience === 'all' ||
      item.audience === 'all' ||
      item.audience === audience;
    const matchesCategory = category === 'all' || item.categoryId === category;
    const matchesQuery =
      !normalizedQuery ||
      `${item.question} ${item.answer}`.toLowerCase().includes(normalizedQuery);
    return matchesAudience && matchesCategory && matchesQuery;
  });
}
