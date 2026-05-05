import base64
import httpx
from pathlib import Path
from app.config import settings


def detect_faces(image_path: str) -> list[dict]:
    """
    Отправляет изображение в ml сервис, возвращает список лиц.
    Каждое лицо: { bbox, embedding, confidence }
    """
    image_bytes = Path(image_path).read_bytes()
    image_b64 = base64.b64encode(image_bytes).decode()

    try:
        response = httpx.post(
            f"{settings.ml_service_url}/detect",
            json={"image_b64": image_b64},
            timeout=30.0,
        )
        response.raise_for_status()
        return response.json()["faces"]
    except httpx.TimeoutException:
        raise Exception("ML сервис не ответил за 30 секунд")
    except httpx.HTTPError as e:
        raise Exception(f"Ошибка ML сервиса: {e}")


def embed_image(image_path: str) -> list[float]:
    image_bytes = Path(image_path).read_bytes()
    image_b64 = base64.b64encode(image_bytes).decode()

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