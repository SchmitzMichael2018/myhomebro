export function pointerToImageCoordinate(event, element) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) throw new Error("Image is not measurable.");
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  if (![x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) throw new Error("Coordinate is outside the image.");
  return { x, y };
}

export function imageCoordinateToSvg(point) {
  const x = Number(point.x), y = Number(point.y);
  if (![x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) throw new Error("Malformed image coordinate.");
  return { x: x * 1000, y: y * 1000 };
}
