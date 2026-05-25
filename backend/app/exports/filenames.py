from __future__ import annotations

import re
import uuid
from pathlib import Path


def sanitize_filename_part(value: str) -> str:
    cleaned = re.sub(r"[^\w\-. ]+", "_", value.strip(), flags=re.UNICODE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._")
    return cleaned[:100] or "photo"


def build_export_filename(
    *,
    title: str | None,
    source_filename: str,
    asset_id: uuid.UUID,
    export_ext: str,
) -> str:
    stem = Path(source_filename).stem
    base = sanitize_filename_part(title or stem)
    short_id = str(asset_id).split("-")[0]
    return f"{base}_{short_id}.{export_ext.lstrip('.')}"
