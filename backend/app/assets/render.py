from __future__ import annotations

import uuid
from pathlib import Path

from wand.color import Color
from wand.image import Image

from app.assets.recipes import normalize_recipe
from app.exports.filenames import build_export_filename

EXPORT_JPEG_QUALITY = 95


def _apply_channel_shift(img: Image, channel: str, delta: float) -> None:
    if delta > 0:
        img.evaluate(operator="add", value=delta, channel=channel)
    elif delta < 0:
        img.evaluate(operator="subtract", value=abs(delta), channel=channel)


def apply_recipe(img: Image, recipe: dict) -> None:
    if recipe["flip_horizontal"]:
        img.flop()
    if recipe["flip_vertical"]:
        img.flip()

    rotation_degrees = float(recipe["rotation_degrees"])
    if abs(rotation_degrees) > 0.001:
        img.rotate(rotation_degrees, background=Color("black"))

    crop = recipe["crop"]
    if crop["x"] > 0 or crop["y"] > 0 or crop["w"] < 1 or crop["h"] < 1:
        left = int(round(img.width * crop["x"]))
        top = int(round(img.height * crop["y"]))
        width = max(1, int(round(img.width * crop["w"])))
        height = max(1, int(round(img.height * crop["h"])))
        left = max(0, min(left, max(img.width - 1, 0)))
        top = max(0, min(top, max(img.height - 1, 0)))
        width = max(1, min(width, img.width - left))
        height = max(1, min(height, img.height - top))
        img.crop(left=left, top=top, width=width, height=height, reset_coords=True)

    exposure = float(recipe["exposure"])
    saturation = float(recipe["saturation"])
    if exposure != 0 or saturation != 0:
        img.modulate(
            brightness=max(0.0, 100.0 + exposure),
            saturation=max(0.0, 100.0 + saturation),
            hue=100.0,
        )

    contrast = float(recipe["contrast"])
    if contrast != 0:
        img.brightness_contrast(brightness=0.0, contrast=contrast)

    quantum_range = float(img.quantum_range)

    shadows = float(recipe["shadows"])
    if shadows != 0:
        img.sigmoidal_contrast(
            sharpen=shadows < 0,
            strength=max(0.1, abs(shadows) / 20.0),
            midpoint=0.25 * quantum_range,
        )

    highlights = float(recipe["highlights"])
    if highlights != 0:
        img.sigmoidal_contrast(
            sharpen=highlights < 0,
            strength=max(0.1, abs(highlights) / 20.0),
            midpoint=0.75 * quantum_range,
        )

    temperature = float(recipe["temperature"])
    if temperature != 0:
        delta = quantum_range * (abs(temperature) / 100.0) * 0.06
        if temperature > 0:
            _apply_channel_shift(img, "red", delta)
            _apply_channel_shift(img, "blue", -delta)
        else:
            _apply_channel_shift(img, "red", -delta)
            _apply_channel_shift(img, "blue", delta)

    tint = float(recipe["tint"])
    if tint != 0:
        delta = quantum_range * (abs(tint) / 100.0) * 0.05
        _apply_channel_shift(img, "green", -delta if tint > 0 else delta)

    sharpness = float(recipe["sharpness"])
    if sharpness > 0:
        img.sharpen(radius=0.0, sigma=max(0.1, 0.5 + sharpness / 40.0))

    vignette = float(recipe["vignette"])
    if vignette > 0:
        sigma = max(img.width, img.height) * (vignette / 100.0) * 0.12
        img.vignette(
            radius=0.0,
            sigma=max(1.0, sigma),
            x=int(img.width * 0.08),
            y=int(img.height * 0.08),
        )

    img.clamp()


def _resolve_export_format(source_mime: str | None) -> tuple[str, str, str]:
    mime = (source_mime or "").lower()
    if mime in {"image/jpeg", "image/jpg"}:
        return "jpeg", "jpg", "image/jpeg"
    if mime == "image/png":
        return "png", "png", "image/png"
    return "jpeg", "jpg", "image/jpeg"


def render_asset_export_bytes(
    *,
    original_path: Path,
    recipe: dict | None,
    source_filename: str,
    source_mime: str | None,
    title: str | None,
    asset_id: uuid.UUID,
) -> tuple[bytes, str, str]:
    normalized = normalize_recipe(recipe)
    fmt, ext, out_mime = _resolve_export_format(source_mime)

    with Image(filename=str(original_path)) as img:
        img.auto_orient()
        with img.clone() as processed:
            apply_recipe(processed, normalized)
            processed.format = fmt
            if fmt == "jpeg":
                processed.compression_quality = EXPORT_JPEG_QUALITY
            blob = processed.make_blob()

    filename = build_export_filename(
        title=title,
        source_filename=source_filename,
        asset_id=asset_id,
        export_ext=ext,
    )
    return blob, filename, out_mime
