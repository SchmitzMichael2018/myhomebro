export const UNIT_CATALOG = [
  ["ea", "Each", "ea"], ["ls", "Lump Sum", "LS"],
  ["hr", "Hour", "hr"], ["day", "Day", "day"],
  ["in", "Inch", "in"], ["ft", "Foot", "ft"], ["lf", "Linear Foot", "LF"],
  ["sf", "Square Foot", "SF"], ["sy", "Square Yard", "SY"],
  ["cf", "Cubic Foot", "CF"], ["cy", "Cubic Yard", "CY"],
  ["lb", "Pound", "lb"], ["ton", "Ton", "ton"], ["gal", "Gallon", "gal"],
  ["sheet", "Sheet", "sheet"], ["roll", "Roll", "roll"], ["bag", "Bag", "bag"],
  ["box", "Box", "box"], ["fixture", "Fixture", "fixture"], ["room", "Room", "room"],
  ["assembly", "Assembly", "assembly"], ["trip", "Trip", "trip"], ["bundle", "Bundle", "bundle"],
];

const UNIT_ALIASES = new Map([
  ["each", "ea"], ["item", "ea"], ["items", "ea"], ["lump sum", "ls"], ["lump-sum", "ls"],
  ["hour", "hr"], ["hours", "hr"], ["hrs", "hr"], ["days", "day"],
  ["inch", "in"], ["inches", "in"], ["foot", "ft"], ["feet", "ft"],
  ["linear feet", "lf"], ["linear foot", "lf"], ["linear ft", "lf"], ["lin ft", "lf"],
  ["square feet", "sf"], ["square foot", "sf"], ["sq ft", "sf"], ["sqft", "sf"],
  ["square yards", "sy"], ["square yard", "sy"], ["sq yd", "sy"],
  ["cubic feet", "cf"], ["cubic foot", "cf"], ["cu ft", "cf"],
  ["cubic yards", "cy"], ["cubic yard", "cy"], ["cu yd", "cy"],
  ["pound", "lb"], ["pounds", "lb"], ["lbs", "lb"], ["tons", "ton"], ["gallon", "gal"], ["gallons", "gal"],
]);
UNIT_CATALOG.forEach(([code]) => UNIT_ALIASES.set(code.toLowerCase(), code));

export function recognizeUnit(value = "") {
  return UNIT_ALIASES.get(String(value).trim().toLowerCase()) || null;
}

export function unitDisplay(value = "") {
  const code = recognizeUnit(value);
  const item = UNIT_CATALOG.find(([candidate]) => candidate === code);
  return item ? item[2] : String(value || "").trim();
}

export function normalizeCustomUnit(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function unitValueForSave(value = "") {
  return recognizeUnit(value) || normalizeCustomUnit(value === "__other__" ? "" : value);
}

export function customUnitError(value = "") {
  if (value === "__other__") return "Enter a custom unit.";
  const clean = normalizeCustomUnit(value);
  if (!clean) return "Enter a custom unit.";
  if (clean.length > 30) return "Custom unit must be 30 characters or fewer.";
  if (/[<>]/.test(clean)) return "Custom unit cannot contain markup.";
  if (/https?:\/\/|www\.|\S+@\S+|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/i.test(clean)) return "Enter a unit, not a URL or contact detail.";
  return "";
}
