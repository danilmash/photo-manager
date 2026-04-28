from __future__ import annotations

from copy import deepcopy
from typing import Any


DEFAULT_PHOTO_RECIPE: dict[str, Any] = {
    "crop": {
        "x": 0.0,
        "y": 0.0,
        "w": 1.0,
        "h": 1.0,
    },
    "rotation_degrees": 0.0,
    "flip_horizontal": False,
    "flip_vertical": False,
    "exposure": 0.0,
    "contrast": 0.0,
    "highlights": 0.0,
    "shadows": 0.0,
    "temperature": 0.0,
    "tint": 0.0,
    "saturation": 0.0,
    "sharpness": 0.0,
    "vignette": 0.0,
}


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _coerce_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(value, (int, float)):
        return bool(value)
    return default


def normalize_recipe(recipe: dict[str, Any] | None) -> dict[str, Any]:
    normalized = deepcopy(DEFAULT_PHOTO_RECIPE)
    if not isinstance(recipe, dict):
        return normalized

    crop = recipe.get("crop")
    if isinstance(crop, dict):
        normalized["crop"] = {
            "x": _clamp(_coerce_float(crop.get("x"), 0.0), 0.0, 1.0),
            "y": _clamp(_coerce_float(crop.get("y"), 0.0), 0.0, 1.0),
            "w": _clamp(_coerce_float(crop.get("w"), 1.0), 0.0, 1.0),
            "h": _clamp(_coerce_float(crop.get("h"), 1.0), 0.0, 1.0),
        }
        normalized["crop"]["w"] = _clamp(
            normalized["crop"]["w"],
            0.0,
            1.0 - normalized["crop"]["x"],
        )
        normalized["crop"]["h"] = _clamp(
            normalized["crop"]["h"],
            0.0,
            1.0 - normalized["crop"]["y"],
        )

    normalized["rotation_degrees"] = _clamp(
        _coerce_float(recipe.get("rotation_degrees"), 0.0),
        -180.0,
        180.0,
    )
    normalized["flip_horizontal"] = _coerce_bool(
        recipe.get("flip_horizontal"),
        False,
    )
    normalized["flip_vertical"] = _coerce_bool(
        recipe.get("flip_vertical"),
        False,
    )

    for field in (
        "exposure",
        "contrast",
        "highlights",
        "shadows",
        "temperature",
        "tint",
        "saturation",
    ):
        normalized[field] = _clamp(
            _coerce_float(recipe.get(field), 0.0),
            -100.0,
            100.0,
        )

    normalized["sharpness"] = _clamp(
        _coerce_float(recipe.get("sharpness"), 0.0),
        0.0,
        100.0,
    )
    normalized["vignette"] = _clamp(
        _coerce_float(recipe.get("vignette"), 0.0),
        0.0,
        100.0,
    )

    return normalized
