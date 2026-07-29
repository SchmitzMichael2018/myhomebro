export const PUBLIC_FAQ_CATEGORIES = [
  {
    id: "getting-started",
    label: "Getting Started",
    items: [
      {
        id: "what-is-myhomebro",
        question: "What is MyHomeBro?",
        answer: "MyHomeBro is a home-project operating platform. It brings customer and job intake, estimates, agreements, milestones, payments, messages, photos, warranties, and project records into connected workspaces so contractors and customers can understand what is happening and what comes next.",
      },
      {
        id: "who-is-it-for",
        question: "Who is MyHomeBro for?",
        answer: "MyHomeBro serves contractors, homeowners and customers, property managers, and—where a property workflow supports it—tenants. Each person sees tools and records appropriate to their role and the projects or properties they are authorized to access.",
      },
      {
        id: "contractor-marketplace",
        question: "Is MyHomeBro a contractor marketplace?",
        answer: "MyHomeBro can help customers submit project requests and connect with participating contractors, but it is also a project operating platform. Availability and matching depend on location, project details, and contractor participation. MyHomeBro does not guarantee that a contractor will be available or selected.",
      },
      {
        id: "browser-or-app",
        question: "Do I need to install the app?",
        answer: "No. You can use MyHomeBro from a supported web browser. Installing it is optional and provides a convenient app icon and faster access from a phone or desktop; it does not create a different account or unlock separate project features.",
      },
    ],
  },
  {
    id: "contractors",
    label: "For Contractors",
    items: [
      {
        id: "contractor-tools",
        question: "What can contractors manage in MyHomeBro?",
        answer: "Contractors can manage customer intake, estimates, agreements, projects, milestones, schedules, payments, messages, photos, warranties, field records, and related operational work. Available tools can vary by account configuration, role, and enabled features.",
      },
      {
        id: "estimates-agreements",
        question: "Can I create estimates and agreements?",
        answer: "Yes. Contractors can prepare estimates and move approved project information into structured agreements. Estimates, agreement terms, milestones, signatures, and payment arrangements remain reviewable parts of their owning workflows; MyHomeBro does not approve them on a contractor’s behalf.",
      },
      {
        id: "teams",
        question: "Can I manage employees and subcontractors?",
        answer: "Supported contractor accounts can organize employees and subcontractors, assign appropriate access, and coordinate project responsibilities. What a team member can view or change depends on their account role, permissions, and project assignment.",
      },
      {
        id: "accounting",
        question: "Does MyHomeBro replace accounting software?",
        answer: "No. MyHomeBro helps organize project estimates, payments, receipts, expenses, and operational records, but it is not a complete accounting, tax, payroll, or banking system. Contractors should continue using qualified accounting tools and professional advice where appropriate.",
      },
    ],
  },
  {
    id: "homeowners",
    label: "For Homeowners",
    items: [
      {
        id: "homeowner-visibility",
        question: "What can homeowners see and review?",
        answer: "Homeowners can use their customer workspace or secure links to review the project information shared with them, including estimates, agreements, signatures, milestones, payment requests, updates, and available records. Visibility depends on the project, contractor workflow, and the homeowner’s authorized access.",
      },
      {
        id: "homeowner-communication",
        question: "How do homeowners communicate with contractors?",
        answer: "Where messaging is enabled, homeowners and contractors can keep project-related questions and updates connected to the relevant work. Some notices may also arrive through secure email or SMS links when the user has provided the necessary contact information and consent.",
      },
      {
        id: "property-records",
        question: "Can homeowners keep property, warranty, and project records?",
        answer: "Yes. Supported customer workspaces can organize project history, photos, documents, receipts, equipment details, warranties, and maintenance information as property records. The records available depend on what users upload, what a contractor shares, and which property features are enabled.",
      },
      {
        id: "contractor-guarantees",
        question: "Does MyHomeBro choose or guarantee contractors?",
        answer: "No. MyHomeBro may help surface or connect participating contractors, but customers make their own hiring decisions. MyHomeBro does not guarantee contractor licensing, availability, workmanship, pricing, schedules, or project outcomes; customers should perform the checks appropriate to their project and location.",
      },
    ],
  },
  {
    id: "projects-payments",
    label: "Projects and Payments",
    items: [
      {
        id: "payment-handling",
        question: "How are payments handled?",
        answer: "Payment steps are tied to the applicable agreement, invoice, milestone, or direct-payment workflow. Payment processing is provided through configured third-party payment services, and the exact approval, funding, fee, and release details are shown in the relevant project workflow before a user acts.",
      },
      {
        id: "fund-release",
        question: "Does MyHomeBro hold or release funds automatically?",
        answer: "Funding and release behavior depends on the agreement, payment method, configured rules, and required approvals. Some workflows may include scheduled or rule-based actions described in the agreement and Terms of Service. Users should review the displayed payment status and terms rather than assume every payment is held or released the same way.",
      },
      {
        id: "payment-details",
        question: "Are payment details stored by MyHomeBro?",
        answer: "Sensitive payment credentials are processed by configured third-party payment providers. MyHomeBro keeps the project-facing records needed to show payment requests, amounts, statuses, receipts, and related activity, but users should not place card or bank credentials in ordinary messages or project notes.",
      },
      {
        id: "failed-payment",
        question: "What happens if a payment fails?",
        answer: "A failed payment remains incomplete and should display a failure or action-needed state. The user may need to verify the payment method, retry through the supported payment flow, or contact the contractor or support. A failed attempt does not by itself mark the related obligation as paid.",
      },
      {
        id: "refunds-payment-disputes",
        question: "Are refunds or payment disputes handled automatically?",
        answer: "No. Refunds, reimbursements, and disputed payments follow their applicable review, authorization, provider, and agreement rules. MyHomeBro can organize the request, evidence, status, and decisions, but it does not automatically decide entitlement or bypass required human approval.",
      },
    ],
  },
  {
    id: "assistant-capture",
    label: "Smart Capture and Project Assistant",
    items: [
      {
        id: "project-assistant",
        question: "What is Project Assistant?",
        answer: "Project Assistant helps explain project information, identify missing details, organize notes, and prepare drafts or suggested next steps. It is advisory: it does not replace the contractor, customer, property manager, attorney, accountant, or other person responsible for a decision.",
      },
      {
        id: "smart-capture",
        question: "What is Smart Capture?",
        answer: "Smart Capture helps users collect customer details, receipts, product or equipment labels, photos, measurements, and field information while work is happening. Captured information enters an existing review workflow so the user can organize and confirm it before it becomes part of an authoritative business record.",
      },
      {
        id: "ai-decisions",
        question: "Does AI make final decisions or automatically change records?",
        answer: "No. Project Assistant can prepare explanations, classifications, or drafts, but it does not independently approve pricing, sign agreements, release payments, resolve disputes, authorize work, or publish changes. Consequential updates remain subject to the owning workflow’s review and confirmation steps.",
      },
      {
        id: "ai-review-unavailable",
        question: "Can users correct AI drafts, and what happens if AI is unavailable?",
        answer: "Users can review, edit, reject, or replace AI-assisted drafts before applying them. If Project Assistant is unavailable or cannot interpret the information safely, users should still be able to continue with the platform’s supported manual workflows and enter the required details themselves.",
      },
    ],
  },
  {
    id: "disputes-records",
    label: "Disputes and Records",
    items: [
      {
        id: "dispute-process",
        question: "How does the dispute process work?",
        answer: "A dispute workflow records the issue, related project or payment context, responses, evidence, status changes, and available next steps. The exact process depends on the agreement, payment state, platform rules, and Terms of Service. Opening a dispute does not guarantee a particular result.",
      },
      {
        id: "legal-decisions",
        question: "Does MyHomeBro make legal decisions or automatic dispute outcomes?",
        answer: "No. MyHomeBro provides workflow and recordkeeping tools, not legal representation or legal advice. Project Assistant may summarize information but does not decide fault or legal rights. Outcomes require the people or authorized process identified by the applicable agreement and Terms of Service.",
      },
      {
        id: "evidence-payment-effect",
        question: "Can users upload evidence, and can a dispute affect payment?",
        answer: "Supported dispute workflows can accept relevant messages, photos, documents, and other evidence for review. A dispute may affect the status or availability of related funds according to the payment workflow, agreement, provider rules, and Terms of Service; it does not automatically refund or award money.",
      },
    ],
  },
  {
    id: "privacy-security",
    label: "Privacy and Security",
    items: [
      {
        id: "project-visibility",
        question: "Who can see project information?",
        answer: "Project and account information is limited to authenticated or securely linked users with the relevant role, ownership, permission, or assignment. Contractors control what is shared through their workflows, while customers see the records made available to them. Public profiles do not make private project records public.",
      },
      {
        id: "record-sharing",
        question: "Are customer and contractor records shared publicly?",
        answer: "Private customer, agreement, payment, message, and project records are not intended for public listing. Contractors may separately publish selected business profile, service, portfolio, review, or contact information. MyHomeBro may share necessary information with service providers as described in the Privacy Policy.",
      },
      {
        id: "offline-data",
        question: "Does the installed app store private project information offline?",
        answer: "The installed app may keep the application shell available, but private project, customer, agreement, pricing, payment, and Capture data requires a verified server connection. Users should not expect complete offline access to sensitive records, and offline behavior can vary by device and browser.",
      },
      {
        id: "data-choices",
        question: "Can users update or delete their data?",
        answer: "Users can update supported account information and may request account deletion where permitted by law. Some agreement, payment, dispute, audit, or legal records may need to be retained. Review the Privacy Policy or use the authenticated Support workflow for an account-specific request.",
      },
    ],
  },
];

export const PUBLIC_FAQ_ITEMS = PUBLIC_FAQ_CATEGORIES.flatMap((category) =>
  category.items.map((item) => ({ ...item, category: category.label }))
);

export function buildPublicFaqJsonLd(items = PUBLIC_FAQ_ITEMS) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}
