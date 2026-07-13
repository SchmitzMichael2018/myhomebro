export const SMART_CAPTURE_TYPES = {
  receipt: "Receipt",
  equipment_label: "Equipment Label",
  product_label: "Product Label",
};

export const CUSTOMER_SMART_CAPTURE_TYPES = {
  home_system_label: "Scan Appliance or Home System",
  appliance_label: "Scan Appliance",
  installed_product_label: "Add Installed Product",
  property_receipt: "Scan Receipt",
  warranty_document: "Scan Warranty",
  manual_document: "Upload Manual",
  paint_or_finish_label: "Add Paint or Finish",
  flooring_or_material_label: "Add Flooring or Material",
  property_photo: "Add Property Photo",
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
  return SMART_CAPTURE_TYPES[type] || CUSTOMER_SMART_CAPTURE_TYPES[type] || String(type || "Smart Capture").replaceAll("_", " ");
}

export function smartCaptureStatusLabel(status = "") {
  return SMART_CAPTURE_STATUS_LABELS[status] || String(status || "uploaded").replaceAll("_", " ");
}

export function smartCaptureFieldsForType(type = "") {
  if (type === "receipt" || type === "property_receipt") {
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
  if (type === "paint_or_finish_label") {
    return [
      ["product_name", "Product Line"],
      ["manufacturer", "Manufacturer"],
      ["color_name", "Color Name"],
      ["color_code", "Color Code"],
      ["finish", "Finish/Sheen"],
      ["room_or_location", "Room or Area"],
      ["lot_or_batch_number", "Lot/Batch"],
      ["notes", "Notes"],
    ];
  }
  if (type === "flooring_or_material_label") {
    return [
      ["product_name", "Product Name"],
      ["manufacturer", "Manufacturer"],
      ["sku", "SKU"],
      ["material", "Material"],
      ["color_name", "Color"],
      ["finish", "Finish"],
      ["room_or_location", "Install Location"],
      ["lot_or_batch_number", "Lot/Dye/Batch"],
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
  if (session.property_profile_id || session.customer_email || session.created_property_intelligence_record) {
    return [
      `${payload.product_name || payload.merchant_name || payload.model_number || "This reviewed item"} will be saved to the selected property.`,
      "The original source file will be preserved in home records.",
      "No contractor expense, reimbursement, payment, warranty claim, or maintenance work order will be created.",
    ];
  }
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
