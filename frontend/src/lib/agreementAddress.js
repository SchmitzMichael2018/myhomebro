const clean = (value) => String(value || "").trim();

export function normalizeUsPostalInput(value) {
  const digits = clean(value).replace(/\D/g, "").slice(0, 9);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function parseFormattedUsAddress(value) {
  const raw = clean(value);
  const empty = { address_line1: "", address_line2: "", city: "", state: "", postal_code: "" };
  if (!raw) return empty;
  const parts = raw.split(",").map(clean).filter(Boolean);
  if (parts.length < 3) return { ...empty, address_line1: raw };

  let postalCode = "";
  let state = "";
  let cursor = parts.length - 1;
  const combined = parts[cursor].match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (combined) {
    state = combined[1].toUpperCase();
    postalCode = combined[2];
    cursor -= 1;
  } else if (/^\d{5}(?:-\d{4})?$/.test(parts[cursor])) {
    postalCode = parts[cursor];
    cursor -= 1;
    if (/^[A-Za-z]{2}$/.test(parts[cursor] || "")) {
      state = parts[cursor].toUpperCase();
      cursor -= 1;
    }
  }
  if (!state || cursor < 1) return { ...empty, address_line1: raw };
  return { ...empty, address_line1: parts.slice(0, cursor).join(", "), city: parts[cursor], state, postal_code: postalCode };
}

export async function lookupUsZip(postalCode, fetchImpl = fetch) {
  const zip = normalizeUsPostalInput(postalCode);
  if (!/^\d{5}$/.test(zip)) return null;
  try {
    const response = await fetchImpl(`https://api.zippopotam.us/us/${zip}`);
    if (!response.ok) return null;
    const payload = await response.json();
    const place = Array.isArray(payload?.places) ? payload.places[0] : null;
    const city = clean(place?.["place name"]);
    const state = clean(place?.["state abbreviation"]).toUpperCase();
    return city && state ? { city, state, postal_code: zip } : null;
  } catch {
    return null;
  }
}
