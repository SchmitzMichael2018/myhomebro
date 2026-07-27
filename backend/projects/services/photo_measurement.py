import io
from decimal import Decimal

from django.conf import settings
from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import ValidationError

from projects.services.plan_measurement_geometry import (
    calculate_annotation,
    calculate_calibration,
    validate_point,
)

CALCULATION_VERSION = "photo_geometry.v1"
FORMATS = {"JPEG": ("image/jpeg", "JPEG", ".jpg"), "PNG": ("image/png", "PNG", ".png"), "WEBP": ("image/webp", "WEBP", ".webp")}
ORIENTATION_TRANSFORMS = {
    1: "identity", 2: "flip_horizontal", 3: "rotate_180", 4: "flip_vertical",
    5: "transpose", 6: "rotate_90_cw", 7: "transverse", 8: "rotate_90_ccw",
}


def normalize_image(raw, filename):
    if len(raw) > settings.MEASUREMENT_PHOTO_MAX_BYTES:
        raise ValidationError({"file": "Image exceeds the configured size limit."})
    Image.MAX_IMAGE_PIXELS = settings.MEASUREMENT_PHOTO_MAX_PIXELS
    try:
        with Image.open(io.BytesIO(raw)) as source:
            source.verify()
        with Image.open(io.BytesIO(raw)) as source:
            if source.format not in FORMATS:
                raise ValidationError({"file": "Use a JPEG, PNG, or WebP image."})
            original_size = source.size
            orientation = int(source.getexif().get(274, 1) or 1)
            normalized = ImageOps.exif_transpose(source)
            width, height = normalized.size
            if (
                width > settings.MEASUREMENT_PHOTO_MAX_WIDTH
                or height > settings.MEASUREMENT_PHOTO_MAX_HEIGHT
                or width * height > settings.MEASUREMENT_PHOTO_MAX_PIXELS
            ):
                raise ValidationError({"file": "Decoded image dimensions exceed configured limits."})
            mime, output_format, suffix = FORMATS[source.format]
            output = io.BytesIO()
            save_image = normalized.convert("RGB") if output_format == "JPEG" else normalized.copy()
            options = {"quality": 92} if output_format in {"JPEG", "WEBP"} else {}
            save_image.save(output, format=output_format, **options)
            return {
                "content": ContentFile(output.getvalue(), name=f"normalized-{filename.rsplit('.', 1)[0]}{suffix}"),
                "mime": mime, "original_width": original_size[0], "original_height": original_size[1],
                "width": width, "height": height, "orientation": orientation,
                "transform": ORIENTATION_TRANSFORMS.get(orientation, "identity"),
            }
    except ValidationError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError):
        raise ValidationError({"file": "Image is corrupt or unsafe to decode."})


def create_calibration_data(document, geometry, known_length, unit):
    page_box = {"width": str(document.normalized_width), "height": str(document.normalized_height)}
    canonical, known, pixels, scale = calculate_calibration(geometry, known_length, unit, page_box)
    if pixels < Decimal(settings.MEASUREMENT_PHOTO_MIN_REFERENCE_PIXELS):
        raise ValidationError({"reference_geometry": "Reference line is too short in the normalized image."})
    points = [validate_point(point) for point in canonical["points"]]
    warnings = ["Perspective can produce incorrect results.", "Reference and target must remain on the same physical plane."]
    evidence = ["Known reference entered by the user.", "Same-plane attestation recorded.", "EXIF orientation normalized and GPS metadata removed."]
    if pixels < Decimal(min(document.normalized_width, document.normalized_height)) * Decimal("0.1"):
        warnings.append("Reference occupies a small portion of the image.")
    if any(p["x"] < Decimal(".05") or p["x"] > Decimal(".95") or p["y"] < Decimal(".05") or p["y"] > Decimal(".95") for p in points):
        warnings.append("Reference is near the image edge.")
    confidence = "medium" if warnings else "high_estimate"
    return canonical, known, pixels, scale, confidence, evidence, warnings


def calculate_photo_annotation(document, calibration, geometry_type, geometry):
    proxy = type("Calibration", (), {
        "page_box": {"width": str(document.normalized_width), "height": str(document.normalized_height)},
        "scale_per_point": calibration.scale_per_pixel,
        "unit": calibration.unit,
    })()
    canonical, value, unit, perimeter = calculate_annotation(geometry_type, geometry, proxy)
    points = [validate_point(point) for point in canonical["points"]]
    reference = [validate_point(point) for point in calibration.reference_geometry["points"]]
    warnings = list(calibration.warnings)
    evidence = list(calibration.evidence) + ["Target geometry recalculated by the server."]
    if any(p["x"] < Decimal(".03") or p["x"] > Decimal(".97") or p["y"] < Decimal(".03") or p["y"] > Decimal(".97") for p in points):
        warnings.append("Target is near the image edge.")
    target_center = (sum((p["x"] for p in points), Decimal(0)) / len(points), sum((p["y"] for p in points), Decimal(0)) / len(points))
    reference_center = ((reference[0]["x"] + reference[1]["x"]) / 2, (reference[0]["y"] + reference[1]["y"]) / 2)
    if abs(target_center[0] - reference_center[0]) + abs(target_center[1] - reference_center[1]) > Decimal(".75"):
        warnings.append("Target is far from the known reference.")
    confidence = "medium" if warnings else "high_estimate"
    return canonical, value, unit, perimeter, confidence, evidence, sorted(set(warnings))


def repeat_statistics(rows):
    values = [Decimal(row.normalized_value) for row in rows]
    if not values:
        return None
    minimum, maximum = min(values), max(values)
    mean = sum(values, Decimal(0)) / len(values)
    spread = maximum - minimum
    relative = spread / mean if mean else Decimal(0)
    return {
        "minimum": str(minimum), "maximum": str(maximum), "mean": str(mean),
        "absolute_spread": str(spread), "relative_spread": str(relative),
        "variance_warning": relative > Decimal(settings.MEASUREMENT_PHOTO_REPEAT_VARIANCE_THRESHOLD),
    }
