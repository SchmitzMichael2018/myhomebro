export const QUICK_CAPTURE_APPROVAL_ACTIONS = {
  create_customer: "Create Customer Only",
  create_customer_and_opportunity: "Create Customer & Opportunity",
  create_opportunity_for_existing_customer: "Add Opportunity To Existing Customer",
  create_reminder: "Create Reminder",
};

export function quickCaptureIntentLabel(intent = "") {
  return String(intent || "save_capture_draft")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getQuickCaptureMissingFields(prepared = {}) {
  return Array.isArray(prepared?.missing_fields)
    ? prepared.missing_fields.filter(Boolean)
    : [];
}

export function canApproveQuickCapture(prepared = {}) {
  const intent = prepared?.intent || "";
  const missing = getQuickCaptureMissingFields(prepared);
  return Boolean(QUICK_CAPTURE_APPROVAL_ACTIONS[intent] && missing.length === 0);
}

export function approvalActionForQuickCapture(prepared = {}) {
  const intent = prepared?.intent || "";
  if (!canApproveQuickCapture(prepared)) return null;
  return {
    action: intent,
    label: QUICK_CAPTURE_APPROVAL_ACTIONS[intent],
  };
}

export function draftRowsFromQuickCapture(prepared = {}) {
  const customer = prepared?.customer_draft || {};
  const opportunity = prepared?.opportunity_draft || {};
  const message = prepared?.message_draft || {};
  const reminder = prepared?.reminder_draft || {};
  const rows = [];

  if (customer.display_name || customer.email || customer.phone) {
    rows.push({
      title: "Customer Draft",
      items: [
        ["Name", customer.display_name],
        ["Email", customer.email],
        ["Phone", customer.phone],
        ["Address", customer.address],
      ],
    });
  }

  if (opportunity.description || opportunity.project_category || opportunity.property_address) {
    rows.push({
      title: "Opportunity Draft",
      items: [
        ["Title", opportunity.title],
        ["Category", opportunity.project_category],
        ["Subtype", opportunity.project_subtype],
        ["Address", opportunity.property_address],
        ["Scope", opportunity.description],
        ["Budget", opportunity.budget],
      ],
    });
  }

  if (message.message || message.recipient) {
    rows.push({
      title: "Message Draft",
      items: [
        ["Status", message.status_label || "Drafted - not sent"],
        ["Channel", message.channel],
        ["Recipient", message.recipient],
        ["Subject", message.subject],
        ["Message", message.message],
      ],
    });
  }

  if (reminder.title || reminder.due_at) {
    rows.push({
      title: "Reminder Draft",
      items: [
        ["Status", reminder.status_label || "Drafted - not created"],
        ["Title", reminder.title],
        ["Due", reminder.due_at],
        ["Note", reminder.note],
      ],
    });
  }

  return rows;
}
