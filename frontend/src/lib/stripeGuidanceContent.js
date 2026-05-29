// Pure data — no UI. Import STRIPE_GUIDANCE where you need copy.
export const STRIPE_ENTITY_TYPE_SESSION_KEY = "mhb_stripe_entity_type";

export const STRIPE_GUIDANCE = {
  intro: {
    default:
      "To receive payments through MyHomeBro, I need to connect your bank account. Stripe handles this securely — it takes about 2 minutes and you only do it once.",
  },

  entity: {
    sole_proprietor:
      "For a sole proprietor, Stripe will ask for your Social Security Number for identity verification. This is standard and secure — your SSN is never stored on MyHomeBro.",
    llc: "For an LLC, have your EIN (Employer Identification Number) ready — it's on your IRS confirmation letter. Your SSN works too for single-member LLCs.",
    corporation:
      "For a corporation, Stripe needs your EIN, business address, and the name of a beneficial owner with 25%+ ownership.",
  },

  step: {
    business_info:
      "Stripe is asking about your business. Have your business name and address ready.",
    bank_account:
      "You'll need your routing number (9 digits, bottom-left of a check) and account number. Both are also in your online banking under account details.",
    identity_verification:
      "Stripe needs to verify your identity — required by US financial regulations. A driver's license or passport works. The photo goes directly to Stripe and is never stored on MyHomeBro.",
    default:
      "Complete each section — you can save and come back if you need to gather documents.",
  },

  completion: {
    success:
      "You're all set — payments will go directly to your bank account, usually within 2 business days of a milestone being approved.",
    pending:
      "Stripe is reviewing your information — this usually takes 1–2 business days. You can keep building jobs in the meantime. I'll let you know here when your account is verified.",
    incomplete:
      "Stripe needs a bit more information before your account is active.",
    restricted:
      "Stripe has flagged something on your account that needs attention. Let me walk you through what's needed.",
  },

  faq: {
    ssn_why: {
      q: "Why does Stripe need my SSN?",
      a: "US financial regulations require identity verification for anyone receiving payments. Your SSN is encrypted and goes directly to Stripe — never stored on MyHomeBro. Stripe is used by millions of businesses including Amazon and Shopify.",
    },
    is_safe: {
      q: "Is this safe?",
      a: "Yes — Stripe is PCI Level 1 certified, the highest level of payment security. Your bank details go directly to Stripe and are never visible to MyHomeBro or your customers.",
    },
    when_paid: {
      q: "When do I get paid?",
      a: "When a homeowner approves a milestone, funds are released from escrow and deposited to your bank — typically within 2 business days. Track every payment in the Invoices section.",
    },
    no_ein: {
      q: "I don't have my EIN handy",
      a: "Your EIN is on your IRS confirmation letter or at IRS.gov/businesses. If you don't have it handy, save your progress and come back — Stripe will hold your place.",
    },
    personal_account: {
      q: "Can I use a personal account?",
      a: "Yes — a personal checking account works, especially for sole proprietors. A business account is recommended if you have one, but not required to get started.",
    },
  },
};

export function getStepGuidance(rawStep) {
  if (!rawStep) return STRIPE_GUIDANCE.step.default;
  const normalized = String(rawStep).toLowerCase().replace(/[\s-]+/g, "_");
  return STRIPE_GUIDANCE.step[normalized] || STRIPE_GUIDANCE.step.default;
}

export function getEntityGuidance(entityType) {
  return STRIPE_GUIDANCE.entity[entityType] || null;
}

export function readEntityTypeFromSession() {
  try {
    return (
      window.sessionStorage?.getItem(STRIPE_ENTITY_TYPE_SESSION_KEY) || null
    );
  } catch {
    return null;
  }
}

export function writeEntityTypeToSession(value) {
  try {
    if (value) {
      window.sessionStorage?.setItem(STRIPE_ENTITY_TYPE_SESSION_KEY, value);
    } else {
      window.sessionStorage?.removeItem(STRIPE_ENTITY_TYPE_SESSION_KEY);
    }
  } catch {
    // ignore
  }
}
