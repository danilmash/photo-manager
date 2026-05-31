"""Нормализация метаданных ImageMagick/Wand для хранения и отображения."""

from __future__ import annotations

from typing import Any


def _deep_get(data: dict[str, Any] | None, *paths: str) -> Any | None:
    if not isinstance(data, dict):
        return None

    for path in paths:
        current: Any = data
        found = True
        for key in path.split("."):
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                found = False
                break
        if found and current not in (None, "", [], {}):
            return current
    return None


def _first(*values: Any) -> Any | None:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


def _normalize_numeric(value: Any) -> Any | None:
    if value in (None, "", [], {}):
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else value
    text = str(value).strip()
    if not text:
        return None
    try:
        number = float(text)
        return int(number) if number.is_integer() else number
    except ValueError:
        return text


# ImageMagick/LibRaw кладёт RAW-поля в other с префиксом dng:.
_DNG_TO_EXIF: tuple[tuple[str, str], ...] = (
    ("dng:make", "Make"),
    ("dng:camera.model.name", "Model"),
    ("dng:lens", "LensModel"),
    ("dng:iso.setting", "ISOSpeedRatings"),
    ("dng:f.number", "FNumber"),
    ("dng:exposure.time", "ExposureTime"),
    ("dng:focal.length", "FocalLength"),
    ("dng:create.date", "DateTimeOriginal"),
)


def normalize_exif_fields(
    exif: dict[str, Any] | None,
    other: dict[str, Any] | None = None,
    xmp: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Собирает плоский EXIF-словарь из exif/other/xmp для хранения и фильтров."""
    merged: dict[str, Any] = {}
    if isinstance(exif, dict):
        merged.update(exif)
    if isinstance(other, dict):
        for src_key, dst_key in _DNG_TO_EXIF:
            if dst_key not in merged and other.get(src_key) not in (None, "", [], {}):
                value = other[src_key]
                if dst_key in {"ISOSpeedRatings", "FNumber"}:
                    value = _normalize_numeric(value)
                merged[dst_key] = value
    if isinstance(xmp, dict):
        for key in ("Make", "Model", "DateTimeOriginal", "LensModel"):
            if key not in merged:
                value = _deep_get(xmp, key, f"tiff:{key}", f"exif:{key}")
                if value not in (None, "", [], {}):
                    merged[key] = value
    return merged


def extract_photo_display_fields(
    *,
    exif: dict[str, Any] | None,
    other: dict[str, Any] | None = None,
    xmp: dict[str, Any] | None = None,
    rendered_width: int | None = None,
    rendered_height: int | None = None,
) -> dict[str, Any | None]:
    normalized = normalize_exif_fields(exif, other, xmp)
    other = other if isinstance(other, dict) else {}

    return {
        "width": _first(
            rendered_width,
            _deep_get(
                normalized,
                "ImageWidth",
                "EXIF.ExifImageWidth",
                "Composite.ImageWidth",
            ),
            _normalize_numeric(other.get("width")),
        ),
        "height": _first(
            rendered_height,
            _deep_get(
                normalized,
                "ImageHeight",
                "EXIF.ExifImageHeight",
                "Composite.ImageHeight",
            ),
            _normalize_numeric(other.get("height")),
        ),
        "taken_at": _first(
            _deep_get(
                normalized,
                "DateTimeOriginal",
                "EXIF.DateTimeOriginal",
                "Composite.SubSecDateTimeOriginal",
            ),
            other.get("dng:create.date"),
            other.get("date:create"),
        ),
        "camera_make": _first(
            _deep_get(normalized, "Make", "IFD0.Make"),
            other.get("dng:make"),
        ),
        "camera_model": _first(
            _deep_get(normalized, "Model", "IFD0.Model"),
            other.get("dng:camera.model.name"),
        ),
        "lens": _first(
            _deep_get(normalized, "LensModel", "EXIF.LensModel"),
            other.get("dng:lens"),
        ),
        "iso": _first(
            _normalize_numeric(_deep_get(normalized, "ISOSpeedRatings", "EXIF.ISOSpeedRatings")),
            _normalize_numeric(other.get("dng:iso.setting")),
        ),
        "aperture": _first(
            _normalize_numeric(_deep_get(normalized, "FNumber", "EXIF.FNumber")),
            _normalize_numeric(other.get("dng:f.number")),
        ),
        "shutter_speed": _first(
            _deep_get(normalized, "ExposureTime", "EXIF.ExposureTime"),
            other.get("dng:exposure.time"),
        ),
        "focal_length": _first(
            _deep_get(normalized, "FocalLength", "EXIF.FocalLength"),
            other.get("dng:focal.length"),
        ),
    }
