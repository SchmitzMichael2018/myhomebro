function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeProjectTypeKey(value = "") {
  return safeStr(value).toLowerCase();
}

function measurementConfigMap() {
  return {
    siding: [
      {
        key: "measurement_exterior_square_footage",
        label: "Exterior square footage",
        type: "number",
        placeholder: "e.g., 1200",
      },
      {
        key: "measurement_linear_feet",
        label: "Linear feet",
        type: "number",
        placeholder: "e.g., 180",
      },
      {
        key: "measurement_stories",
        label: "Number of stories",
        type: "select",
        options: [
          { value: "1", label: "1" },
          { value: "2", label: "2" },
          { value: "3+", label: "3+" },
        ],
      },
      {
        key: "measurement_notes",
        label: "Additional measurement notes",
        type: "textarea",
        placeholder: "Any access, trim, or condition notes the contractor should know.",
      },
    ],
    exterior: [
      {
        key: "measurement_exterior_square_footage",
        label: "Exterior square footage",
        type: "number",
        placeholder: "e.g., 1200",
      },
      {
        key: "measurement_linear_feet",
        label: "Linear feet",
        type: "number",
        placeholder: "e.g., 180",
      },
      {
        key: "measurement_stories",
        label: "Number of stories",
        type: "select",
        options: [
          { value: "1", label: "1" },
          { value: "2", label: "2" },
          { value: "3+", label: "3+" },
        ],
      },
      {
        key: "measurement_notes",
        label: "Additional measurement notes",
        type: "textarea",
        placeholder: "Any access, trim, or condition notes the contractor should know.",
      },
    ],
    painting: [
      {
        key: "measurement_room_count",
        label: "Number of rooms",
        type: "number",
        placeholder: "e.g., 3",
      },
      {
        key: "measurement_square_footage",
        label: "Approx. square footage",
        type: "number",
        placeholder: "e.g., 850",
      },
      {
        key: "measurement_ceiling_included",
        label: "Ceiling included?",
        type: "radio",
        options: [
          { value: "Yes", label: "Yes" },
          { value: "No", label: "No" },
        ],
      },
      {
        key: "measurement_trim_included",
        label: "Trim included?",
        type: "radio",
        options: [
          { value: "Yes", label: "Yes" },
          { value: "No", label: "No" },
        ],
      },
      {
        key: "measurement_notes",
        label: "Additional measurement notes",
        type: "textarea",
        placeholder: "Add any rooms, surfaces, or prep notes.",
      },
    ],
    concrete: [
      {
        key: "measurement_square_footage",
        label: "Square footage",
        type: "number",
        placeholder: "e.g., 500",
      },
      {
        key: "measurement_thickness",
        label: "Thickness",
        type: "number",
        placeholder: "e.g., 4",
      },
      {
        key: "measurement_cubic_yards",
        label: "Cubic yards (optional)",
        type: "number",
        placeholder: "e.g., 6.5",
      },
      {
        key: "measurement_notes",
        label: "Additional measurement notes",
        type: "textarea",
        placeholder: "Add forms, slope, access, or reinforcement notes.",
      },
    ],
  };
}

export function getMeasurementFieldConfigForProjectType(projectTypeKey = "") {
  const key = normalizeProjectTypeKey(projectTypeKey);
  return measurementConfigMap()[key] || [
    {
      key: "measurement_notes",
      label: "Measurement notes",
      type: "textarea",
      placeholder: "Approximate measurements are fine. Contractor should verify before final pricing or work begins.",
    },
  ];
}

export function getMeasurementFieldKeysForProjectType(projectTypeKey = "") {
  return getMeasurementFieldConfigForProjectType(projectTypeKey).map((field) => field.key);
}
