// Pure functions — no React, no API calls.
// Builds pre-drafted message text for common contractor actions.

const DEFAULT_TONE = "professional";

export function draftMilestoneUpdate({ milestoneTitle = "", agreementTitle = "", customerName = "", nextMilestoneTitle = "" } = {}) {
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const jobRef = agreementTitle ? ` for "${agreementTitle}"` : "";
  const next = nextMilestoneTitle
    ? ` We're now moving into the next phase: ${nextMilestoneTitle}.`
    : " I'll be in touch with the next steps.";

  return {
    subject: `Update: ${milestoneTitle || "Milestone"} Complete`,
    body: `${greeting}

I wanted to let you know that we've completed the "${milestoneTitle || "Milestone"}" phase${jobRef}.${next}

Please reach out if you have any questions or feedback. We appreciate your trust in us and are committed to making sure everything looks great.

Thank you!`,
    tone: DEFAULT_TONE,
  };
}

export function draftSignatureFollowUp({ agreementTitle = "", customerName = "", daysSinceSent = 0 } = {}) {
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const jobRef = agreementTitle ? ` for "${agreementTitle}"` : "";
  const urgency = daysSinceSent > 7 ? " Signing will allow us to move forward and get started on your project." : "";

  return {
    subject: `Reminder: Agreement Ready for Your Signature`,
    body: `${greeting}

I wanted to follow up on the agreement${jobRef} that's been sent your way for review and signature.${urgency}

Once signed, we can finalize the project timeline and get everything moving. Please let me know if you have any questions or if anything needs clarification.

You can sign the agreement directly from the link in the original email, or I can resend it if needed.

Thank you!`,
    tone: DEFAULT_TONE,
  };
}

export function draftCheckIn({ agreementTitle = "", customerName = "", daysSinceActivity = 0 } = {}) {
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const jobRef = agreementTitle ? ` regarding "${agreementTitle}"` : "";

  return {
    subject: `Quick Check-In`,
    body: `${greeting}

I'm reaching out${jobRef} to make sure everything is on track and to see if you have any questions or need anything from my end.

${daysSinceActivity > 0 ? `It's been a bit since our last update, and I want to make sure you're informed and comfortable with where things stand. ` : ""}I'm here to make this process as smooth as possible for you — please don't hesitate to reach out.

Looking forward to hearing from you!`,
    tone: DEFAULT_TONE,
  };
}

export function draftAmendmentReason({ originalScope = "", changedItems = [], pricingDelta = null } = {}) {
  const changes = Array.isArray(changedItems) && changedItems.length
    ? changedItems.map((item) => `• ${item}`).join("\n")
    : "• Scope adjustments discussed on-site";

  const pricingNote = pricingDelta != null
    ? `\nThis change results in a pricing adjustment of ${pricingDelta > 0 ? "+" : ""}${pricingDelta}.`
    : "";

  return {
    subject: `Amendment: Scope Change Explanation`,
    body: `Hi there,

I'm sending over an amendment to our project agreement to reflect the following changes:

${changes}
${pricingNote}
${originalScope ? `\nOriginal scope: ${originalScope}\n` : ""}
These changes are necessary to complete the work correctly and to your satisfaction. I want to make sure we're fully aligned before moving forward.

Please review the amendment and let me know if you have any questions. Your signature will authorize us to proceed with the updated scope.

Thank you for your understanding.`,
    tone: DEFAULT_TONE,
  };
}
