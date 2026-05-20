import base64
from io import BytesIO
from pathlib import Path

import httpx
from PIL import Image

from app.config import settings

# Превью до 1200px в base64 перегружает TF/DeepFace+CLIP в одном процессе.
ML_DETECT_MAX_SIDE = 1024
ML_EMBED_MAX_SIDE = 768


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

    try:
        response = httpx.post(
            f"{settings.ml_service_url}/detect",
            json={"image_b64": image_b64},
            timeout=120.0,
        )
        response.raise_for_status()
        return response.json()["faces"]
    except httpx.TimeoutException:
        raise Exception("ML сервис не ответил за 120 секунд")
    except httpx.HTTPError as e:
        raise Exception(f"Ошибка ML сервиса: {e}")


def embed_image(image_path: str) -> list[float]:
    image_b64 = _image_path_to_b64(image_path, ML_EMBED_MAX_SIDE)

    try:
        response = httpx.post(
            f"{settings.ml_service_url}/embed-image",
            json={"image_b64": image_b64},
            timeout=120.0,
        )
        response.raise_for_status()
        return response.json()["embedding"]
    except httpx.TimeoutException:
        raise Exception("ML сервис не ответил за 120 секунд")
    except httpx.HTTPError as e:
        raise Exception(f"Ошибка ML сервиса: {e}")


def embed_text(text: str) -> list[float]:
    try:
        response = httpx.post(
            f"{settings.ml_service_url}/embed-text",
            json={"text": text},
            timeout=120.0,
        )
        response.raise_for_status()
        return response.json()["embedding"]
    except httpx.TimeoutException:
        raise Exception("ML сервис не ответил за 120 секунд")
    except httpx.HTTPError as e:
        raise Exception(f"Ошибка ML сервиса: {e}")
