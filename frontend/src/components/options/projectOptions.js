// frontend/src/components/options/projectOptions.js
// Single source of truth for Project Types/Subtypes used across Wizard & Step1.

// Keep all labels you already used in Step1 ("Installation", "Outdoor", etc.)
// and the richer Wizard taxonomy. You can prune later; backend cares that
// what's sent matches allowed values.

export const PROJECT_TYPES = [
  // Core categories
  { value: "Remodel", label: "Remodel" },
  { value: "New Construction", label: "New Construction" },
  { value: "Repair", label: "Repair" },
  { value: "HVAC", label: "HVAC" },
  { value: "Roofing", label: "Roofing" },
  { value: "Electrical", label: "Electrical" },
  { value: "Plumbing", label: "Plumbing" },
  { value: "Landscaping", label: "Landscaping" },
  { value: "Painting", label: "Painting" },
  { value: "Flooring", label: "Flooring" },

  // Step1-only labels preserved so existing data still round-trips
  { value: "Installation", label: "Installation" },
  { value: "Outdoor", label: "Outdoor" },
  { value: "Inspection", label: "Inspection" },
  { value: "DIY Help", label: "DIY Help" },

  // Catch-all
  { value: "Other", label: "Other / Custom…" },
];

// Subtypes for the main categories used by the Wizard. For categories that
// don’t have a fixed list (e.g., Installation, Outdoor, DIY Help), the UI
// will fall back to the "custom subtype" text box.
export const SUBTYPES_BY_TYPE = {
  Remodel: ["Kitchen", "Bathroom", "Whole Home", "Basement", "Garage", "Patio / Deck"],
  "New Construction": ["Single Family", "ADU", "Garage", "Shed"],
  Repair: ["Water Damage", "Structural", "Cosmetic"],
  HVAC: ["Install", "Repair", "Maintenance", "Ductwork"],
  Roofing: ["Asphalt Shingle", "Metal", "Flat", "Repair", "Inspection"],
  Electrical: ["Panel", "Rewire", "Lighting", "EV Charger"],
  Plumbing: ["Repipe", "Water Heater", "Leak", "Drain"],
  Landscaping: ["Sod", "Irrigation", "Hardscape", "Trees"],
  Painting: ["Interior", "Exterior", "Cabinets"],
  Flooring: ["Tile", "Hardwood", "Laminate", "Vinyl", "Carpet"],

  // No fixed subtypes on purpose (falls back to custom text input):
  Installation: [],
  Outdoor: [],
  Inspection: [],
  "DIY Help": [],
  Other: [],
};
