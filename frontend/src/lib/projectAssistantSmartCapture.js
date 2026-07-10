export const SMART_CAPTURE_TYPES = {
  receipt: "Receipt",
  equipment_label: "Equipment Label",
  product_label: "Product Label",
};

export const SMART_CAPTURE_STATUS_LABELS = {
  uploaded: "Uploaded",
  processing: "Processing",
  review_ready: "Review Ready",
  needs_information: "Needs Information",
  approved: "Approved",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function smartCaptureTypeLabel(type = "") {
  return SMART_CAPTURE_TYPES[type] || String(type || "Smart Capture").replaceAll("_", " ");
}

export function smartCaptureStatusLabel(status = "") {
  return SMART_CAPTURE_STATUS_LABELS[status] || String(status || "uploaded").replaceAll("_", " ");
}

export function smartCaptureFieldsForType(type = "") {
  if (type === "receipt") {
    return [
      ["merchant_name", "Merchant"],
      ["purchase_date", "Purchase Date"],
      ["total", "Total"],
      ["tax", "Tax"],
      ["suggested_category", "Category"],
      ["project_reference", "Project"],
      ["notes", "Notes"],
    ];
  }
  return [
    ["destination", "Destination"],
    ["product_name", "Product Name"],
    ["manufacturer", "Manufacturer"],
    ["model_number", "Model Number"],
    ["serial_number", "Serial Number"],
    ["sku", "SKU"],
    ["warranty_expiration", "Warranty Expiration"],
    ["notes", "Notes"],
  ];
}

export function smartCaptureApprovalSummary(session = {}) {
  const payload = session.structured_payload || {};
  if (session.capture_type === "receipt") {
    return [
      `An expense for ${payload.total || payload.amount || "the reviewed amount"} will be created.`,
      "The source receipt image will be stored with the expense.",
      "No reimbursement, payment, or funds release will be triggered.",
    ];
  }
  return [
    `${payload.product_name || payload.model_number || "This item"} will be saved as an asset or property record.`,
    "The original label image and extracted fields remain auditable.",
    "No warranty claim or maintenance work order will be created.",
  ];
}
