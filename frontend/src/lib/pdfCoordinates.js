const ROTATIONS = new Set([0, 90, 180, 270]);

function assertRotation(rotation) {
  const normalized = Number(rotation) % 360;
  if (!ROTATIONS.has(normalized)) throw new Error("Unsupported PDF rotation.");
  return normalized;
}

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

export function displayToCanonical(point, rotation = 0, clampToPage = false) {
  const r = assertRotation(rotation);
  let u = Number(point.x);
  let v = Number(point.y);
  if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error("Malformed display coordinate.");
  if (clampToPage) {
    u = clamp(u);
    v = clamp(v);
  } else if (u < 0 || u > 1 || v < 0 || v > 1) {
    throw new Error("Coordinate is outside the PDF page.");
  }
  if (r === 90) return { x: v, y: 1 - u };
  if (r === 180) return { x: 1 - u, y: 1 - v };
  if (r === 270) return { x: 1 - v, y: u };
  return { x: u, y: v };
}

export function canonicalToDisplay(point, rotation = 0) {
  const r = assertRotation(rotation);
  const x = Number(point.x);
  const y = Number(point.y);
  if (![x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) {
    throw new Error("Malformed canonical coordinate.");
  }
  if (r === 90) return { x: 1 - y, y: x };
  if (r === 180) return { x: 1 - x, y: 1 - y };
  if (r === 270) return { x: y, y: 1 - x };
  return { x, y };
}

export function pointerToCanonical(event, element, rotation = 0) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) throw new Error("PDF page is not measurable.");
  return displayToCanonical(
    { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height },
    rotation
  );
}

export function canonicalToSvg(point, rotation = 0) {
  const display = canonicalToDisplay(point, rotation);
  return { x: display.x * 1000, y: display.y * 1000 };
}
