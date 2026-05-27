import base64
from io import BytesIO

import httpx
from PIL import Image

from app.config import settings

# Превью до 1200px в base64 перегружает TF/DeepFace+CLIP в одном процессе.
ML_DETECT_MAX_SIDE = 1024
ML_EMBED_MAX_SIDE = 768
ML_REQUEST_TIMEOUT_SEC = 120.0


class MlServiceError(Exception):
    """Ошибка вызова ML-сервиса с понятным сообщением для faces_error."""


def _extract_http_detail(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    detail = body.get("detail")
    if isinstance(detail, str) and detail.strip():
        return detail.strip()
    if isinstance(detail, list):
        parts: list[str] = []
        for item in detail:
            if isinstance(item, dict):
                msg = item.get("msg")
                if isinstance(msg, str) and msg.strip():
                    parts.append(msg.strip())
            elif isinstance(item, str) and item.strip():
                parts.append(item.strip())
        if parts:
            return "; ".join(parts)
    return None


def _raise_ml_http_error(response: httpx.Response, *, operation: str) -> None:
    detail = _extract_http_detail(response)
    if detail:
        raise MlServiceError(f"Ошибка ML ({operation}): {detail}")
    raise MlServiceError(
        f"Ошибка ML ({operation}): HTTP {response.status_code}"
    )


def _post_ml(path: str, payload: dict) -> dict:
    try:
        response = httpx.post(
            f"{settings.ml_service_url}{path}",
            json=payload,
            timeout=ML_REQUEST_TIMEOUT_SEC,
        )
    except httpx.TimeoutException as exc:
        raise MlServiceError(
            f"ML сервис не ответил за {int(ML_REQUEST_TIMEOUT_SEC)} секунд"
        ) from exc
    except httpx.HTTPError as exc:
        raise MlServiceError(f"Ошибка соединения с ML сервисом: {exc}") from exc

    if response.is_error:
        _raise_ml_http_error(response, operation=path)

    try:
        body = response.json()
    except ValueError as exc:
        raise MlServiceError("ML сервис вернул невалидный JSON") from exc

    if not isinstance(body, dict):
        raise MlServiceError("ML сервис вернул неожиданный формат ответа")
    return body


def _image_path_to_b64(image_path: str, max_side: int) -> str:
    with Image.open(image_path) as img:
        img = img.convert("RGB")
        width, height = img.size
        longest = max(width, height)
        if longest > max_side:
            scale = max_side / longest
            img = img.resize(
                (max(1, int(width * scale)), max(1, int(height * scale))),
                Image.Resampling.LANCZOS,
            )
        buffer = BytesIO()
        img.save(buffer, format="JPEG", quality=85)
        return base64.b64encode(buffer.getvalue()).decode()


def detect_faces(image_path: str) -> list[dict]:
    """
    Отправляет изображение в ml сервис, возвращает список лиц.
    Каждое лицо: { bbox, embedding, confidence }
    """
    image_b64 = _image_path_to_b64(image_path, ML_DETECT_MAX_SIDE)
    body = _post_ml("/detect", {"image_b64": image_b64})
    faces = body.get("faces")
    if not isinstance(faces, list):
        raise MlServiceError("ML сервис не вернул список лиц")
    return faces


def embed_image(image_path: str) -> list[float]:
    image_b64 = _image_path_to_b64(image_path, ML_EMBED_MAX_SIDE)
    body = _post_ml("/embed-image", {"image_b64": image_b64})
    embedding = body.get("embedding")
    if not isinstance(embedding, list):
        raise MlServiceError("ML сервис не вернул embedding изображения")
    return embedding


def embed_text(text: str) -> list[float]:
    body = _post_ml("/embed-text", {"text": text})
    embedding = body.get("embedding")
    if not isinstance(embedding, list):
        raise MlServiceError("ML сервис не вернул embedding текста")
    return embedding
