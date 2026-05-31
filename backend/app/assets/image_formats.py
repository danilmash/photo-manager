"""Поддерживаемые форматы загрузки и распознавание RAW по расширению/MIME."""

from __future__ import annotations

from pathlib import Path

STANDARD_MIME_TYPES: frozenset[str] = frozenset(
    {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/tiff",
        "image/webp",
        "image/heic",
        "image/heif",
    }
)

# Расширение (lower, без точки) -> канонический MIME для хранения в БД.
RAW_EXTENSIONS: dict[str, str] = {
    "3fr": "image/x-hasselblad-3fr",
    "arw": "image/x-sony-arw",
    "cr2": "image/x-canon-cr2",
    "cr3": "image/x-canon-cr3",
    "dcr": "image/x-kodak-dcr",
    "dng": "image/x-adobe-dng",
    "erf": "image/x-epson-erf",
    "kdc": "image/x-kodak-kdc",
    "mrw": "image/x-minolta-mrw",
    "nef": "image/x-nikon-nef",
    "nrw": "image/x-nikon-nrw",
    "orf": "image/x-olympus-orf",
    "pef": "image/x-pentax-pef",
    "raf": "image/x-fuji-raf",
    "raw": "image/x-panasonic-raw",
    "rw2": "image/x-panasonic-rw2",
    "rwl": "image/x-leica-rwl",
    "sr2": "image/x-sony-sr2",
    "srf": "image/x-sony-srf",
    "srw": "image/x-samsung-srw",
    "x3f": "image/x-sigma-x3f",
}

RAW_MIME_TYPES: frozenset[str] = frozenset(RAW_EXTENSIONS.values())

# MIME, которые браузеры/OS присваивают RAW, но не совпадают с каноническими image/x-*.
RAW_MIME_ALIASES: dict[str, str] = {
    "image/dng": "image/x-adobe-dng",
    "application/x-adobe-dng": "image/x-adobe-dng",
    "image/vnd.adobe.raw-image": "image/x-adobe-dng",
    "image/x-raw": "image/x-adobe-dng",
}

ALLOWED_MIME_TYPES: frozenset[str] = (
    STANDARD_MIME_TYPES | RAW_MIME_TYPES | frozenset(RAW_MIME_ALIASES.keys())
)


def file_extension(filename: str | None) -> str:
    if not filename:
        return ""
    return Path(filename).suffix.lstrip(".").lower()


def is_raw_mime(mime_type: str | None) -> bool:
    if not mime_type:
        return False
    normalized = mime_type.split(";", 1)[0].strip().lower()
    return normalized in RAW_MIME_TYPES or normalized in RAW_MIME_ALIASES


def is_raw_upload(*, mime_type: str | None, filename: str | None) -> bool:
    if is_raw_mime(mime_type):
        return True
    return file_extension(filename) in RAW_EXTENSIONS


def resolve_upload_mime(content_type: str | None, filename: str | None) -> str | None:
    """Возвращает нормализованный MIME или None, если формат не поддерживается."""
    declared = (content_type or "").split(";", 1)[0].strip().lower()
    ext = file_extension(filename)

    # Для известных RAW-расширений доверяем расширению: Chrome/Edge часто шлют
    # image/dng, image/tiff или application/octet-stream вместо image/x-adobe-dng.
    if ext in RAW_EXTENSIONS:
        return RAW_EXTENSIONS[ext]

    if declared in ALLOWED_MIME_TYPES:
        if declared == "image/jpg":
            return "image/jpeg"
        if declared in RAW_MIME_ALIASES:
            return RAW_MIME_ALIASES[declared]
        return declared

    return None
