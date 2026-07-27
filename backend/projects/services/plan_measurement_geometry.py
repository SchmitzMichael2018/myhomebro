from decimal import Decimal, InvalidOperation, localcontext

from django.conf import settings
from rest_framework.exceptions import ValidationError


CALCULATION_VERSION = "pdf_geometry.v1"
SUPPORTED_UNITS = {"inches", "feet", "millimeters", "centimeters", "meters"}
UNIT_TO_INCHES = {
    "inches": Decimal("1"),
    "feet": Decimal("12"),
    "millimeters": Decimal("0.0393700787401575"),
    "centimeters": Decimal("0.393700787401575"),
    "meters": Decimal("39.3700787401575"),
}
MAX_DECIMAL = Decimal("99999999999999")
MIN_REFERENCE_DISTANCE = Decimal("0.005")


def _decimal(value, field):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValidationError({field: "Must be a finite decimal."})
    if not result.is_finite() or abs(result) > MAX_DECIMAL:
        raise ValidationError({field: "Is outside the supported range."})
    return result


def validate_point(value):
    if not isinstance(value, dict) or set(value) != {"x", "y"}:
        raise ValidationError({"geometry": "Each point must contain only x and y."})
    point = {"x": _decimal(value["x"], "geometry"), "y": _decimal(value["y"], "geometry")}
    if any(number < 0 or number > 1 for number in point.values()):
        raise ValidationError({"geometry": "Canonical coordinates must be between 0 and 1."})
    return point


def validate_geometry(annotation_type, geometry):
    if not isinstance(geometry, dict) or set(geometry) != {"points"} or not isinstance(geometry["points"], list):
        raise ValidationError({"geometry": "Geometry must contain only a points list."})
    points = [validate_point(point) for point in geometry["points"]]
    limits = {"line": (2, 2), "polyline": (2, 200), "polygon": (3, settings.MEASUREMENT_PDF_MAX_POLYGON_VERTICES), "count": (1, 1)}
    if annotation_type not in limits:
        raise ValidationError({"annotation_type": "Unsupported annotation type."})
    minimum, maximum = limits[annotation_type]
    if not minimum <= len(points) <= maximum:
        raise ValidationError({"geometry": f"{annotation_type} requires {minimum} to {maximum} points."})
    if annotation_type == "polygon":
        unique = {(p["x"], p["y"]) for p in points}
        if len(unique) < 3:
            raise ValidationError({"geometry": "A polygon requires three unique vertices."})
        if _self_intersects(points):
            raise ValidationError({"geometry": "Self-intersecting polygons are not supported."})
    return {"points": [{"x": str(p["x"]), "y": str(p["y"])} for p in points]}


def _distance(a, b, width=Decimal("1"), height=Decimal("1")):
    with localcontext() as context:
        context.prec = 40
        dx = (b["x"] - a["x"]) * width
        dy = (b["y"] - a["y"]) * height
        return (dx * dx + dy * dy).sqrt()


def canonical_distance(geometry, page_box):
    points = [validate_point(point) for point in geometry["points"]]
    width = _decimal(page_box.get("width"), "page_box.width")
    height = _decimal(page_box.get("height"), "page_box.height")
    if width <= 0 or height <= 0:
        raise ValidationError({"page_box": "Width and height must be positive."})
    return sum((_distance(points[i - 1], points[i], width, height) for i in range(1, len(points))), Decimal("0"))


def calculate_calibration(reference_geometry, known_length, unit, page_box):
    if unit not in SUPPORTED_UNITS:
        raise ValidationError({"unit": "Unsupported measurement unit."})
    known = _decimal(known_length, "known_length")
    if known <= 0:
        raise ValidationError({"known_length": "Must be positive."})
    geometry = validate_geometry("line", reference_geometry)
    distance = canonical_distance(geometry, page_box)
    if distance < MIN_REFERENCE_DISTANCE:
        raise ValidationError({"reference_geometry": "Reference line is too short."})
    return geometry, known, distance, known / distance


def calculate_annotation(annotation_type, geometry, calibration):
    geometry = validate_geometry(annotation_type, geometry)
    points = [validate_point(point) for point in geometry["points"]]
    width = _decimal(calibration.page_box["width"], "page_box.width")
    height = _decimal(calibration.page_box["height"], "page_box.height")
    scale = calibration.scale_per_point
    perimeter = None
    if annotation_type == "count":
        value, unit = Decimal("1"), "each"
    elif annotation_type in {"line", "polyline"}:
        value = (
            sum((_distance(points[i - 1], points[i], width, height) for i in range(1, len(points))), Decimal("0"))
            * scale * UNIT_TO_INCHES[calibration.unit]
        )
        unit = "inches"
    else:
        closed = points + [points[0]]
        perimeter = (
            sum((_distance(closed[i - 1], closed[i], width, height) for i in range(1, len(closed))), Decimal("0"))
            * scale * UNIT_TO_INCHES[calibration.unit]
        )
        twice_area = sum(
            ((points[i]["x"] * width) * (points[(i + 1) % len(points)]["y"] * height)
             - (points[(i + 1) % len(points)]["x"] * width) * (points[i]["y"] * height))
            for i in range(len(points))
        )
        value = abs(twice_area) / Decimal("2") * scale * scale * UNIT_TO_INCHES[calibration.unit] ** 2
        unit = "square_inches"
    if value > MAX_DECIMAL:
        raise ValidationError({"geometry": "Calculated result is outside the supported range."})
    return geometry, value, unit, perimeter


def _orientation(a, b, c):
    value = (b["y"] - a["y"]) * (c["x"] - b["x"]) - (b["x"] - a["x"]) * (c["y"] - b["y"])
    return 0 if value == 0 else (1 if value > 0 else 2)


def _segments_intersect(a, b, c, d):
    return _orientation(a, b, c) != _orientation(a, b, d) and _orientation(c, d, a) != _orientation(c, d, b)


def _self_intersects(points):
    count = len(points)
    for i in range(count):
        for j in range(i + 1, count):
            if i == j or (i + 1) % count == j or i == (j + 1) % count:
                continue
            if _segments_intersect(points[i], points[(i + 1) % count], points[j], points[(j + 1) % count]):
                return True
    return False
