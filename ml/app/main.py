from contextlib import asynccontextmanager
from concurrent.futures import ProcessPoolExecutor
import multiprocessing as mp

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import base64
import numpy as np
from io import BytesIO
from PIL import Image

from app.clip_worker import embed_image_task, embed_text_task


class DetectRequest(BaseModel):
    image_b64: str


class FaceResult(BaseModel):
    face_index: int
    bbox: dict
    embedding: list[float]
    confidence: float
    quality_score: float


class DetectResponse(BaseModel):
    faces: list[FaceResult]


class EmbedImageRequest(BaseModel):
    image_b64: str


class EmbedTextRequest(BaseModel):
    text: str


class EmbeddingResponse(BaseModel):
    embedding: list[float]


_mp_ctx = mp.get_context("spawn")
_clip_pool: ProcessPoolExecutor | None = None
_CLIP_TASK_TIMEOUT_SEC = 180


def _get_clip_pool() -> ProcessPoolExecutor:
    global _clip_pool
    if _clip_pool is None:
        _clip_pool = ProcessPoolExecutor(max_workers=1, mp_context=_mp_ctx)
    return _clip_pool


def _shutdown_clip_pool() -> None:
    global _clip_pool
    if _clip_pool is not None:
        _clip_pool.shutdown(wait=False, cancel_futures=True)
        _clip_pool = None


def _run_clip_task(fn, *args) -> list[float]:
    pool = _get_clip_pool()
    future = pool.submit(fn, *args)
    try:
        return future.result(timeout=_CLIP_TASK_TIMEOUT_SEC)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"CLIP worker failed: {exc}",
        ) from exc


def load_model():
    from deepface import DeepFace

    dummy = np.zeros((100, 100, 3), dtype=np.uint8)
    try:
        DeepFace.represent(
            dummy,
            model_name="ArcFace",
            detector_backend="retinaface",
            enforce_detection=False,
        )
    except Exception:
        pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_model()
    yield
    _shutdown_clip_pool()


app = FastAPI(title="Photo Manager ML Service", lifespan=lifespan)


def _compute_quality_score(
    face_w: int,
    face_h: int,
    img_w: int,
    img_h: int,
    confidence: float,
) -> float:
    """Heuristic 0..1 combining relative face area and detector confidence."""
    area_ratio = (face_w * face_h) / max(img_w * img_h, 1)
    area_score = min(area_ratio / 0.05, 1.0)
    return round(0.4 * area_score + 0.6 * confidence, 4)


def _is_full_frame_fallback(
    px_x: int,
    px_y: int,
    px_w: int,
    px_h: int,
    img_w: int,
    img_h: int,
) -> bool:
    """DeepFace fallback when no face is detected with enforce_detection=False."""
    return (
        px_x <= 1
        and px_y <= 1
        and px_w >= (img_w - 2)
        and px_h >= (img_h - 2)
    )


def _decode_image_b64(image_b64: str, max_side: int = 1024) -> np.ndarray:
    image_bytes = base64.b64decode(image_b64)
    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    width, height = img.size
    longest = max(width, height)
    if longest > max_side:
        scale = max_side / longest
        img = img.resize(
            (max(1, int(width * scale)), max(1, int(height * scale))),
            Image.Resampling.LANCZOS,
        )
    return np.array(img)


@app.post("/detect", response_model=DetectResponse)
def detect_faces(body: DetectRequest):
    from deepface import DeepFace

    try:
        img_array = _decode_image_b64(body.image_b64, max_side=1024)
    except Exception:
        raise HTTPException(status_code=400, detail="Невалидное изображение")

    h_img, w_img = img_array.shape[:2]

    try:
        results = DeepFace.represent(
            img_array,
            model_name="ArcFace",
            detector_backend="retinaface",
            enforce_detection=False,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    faces: list[FaceResult] = []
    for idx, r in enumerate(results):
        region = r.get("facial_area", {})

        px_x = region.get("x", 0)
        px_y = region.get("y", 0)
        px_w = region.get("w", 0)
        px_h = region.get("h", 0)
        raw_confidence = (
            region.get("confidence")
            if region.get("confidence") is not None
            else r.get("face_confidence")
        )
        try:
            confidence = float(raw_confidence) if raw_confidence is not None else 1.0
        except (TypeError, ValueError):
            confidence = 1.0

        if px_w <= 0 or px_h <= 0:
            continue
        if _is_full_frame_fallback(px_x, px_y, px_w, px_h, w_img, h_img):
            continue

        faces.append(FaceResult(
            face_index=idx,
            bbox={
                "x": round(px_x / w_img, 6),
                "y": round(px_y / h_img, 6),
                "w": round(px_w / w_img, 6),
                "h": round(px_h / h_img, 6),
            },
            embedding=r["embedding"],
            confidence=confidence,
            quality_score=_compute_quality_score(
                px_w, px_h, w_img, h_img, confidence,
            ),
        ))

    return DetectResponse(faces=faces)


@app.post("/embed-image", response_model=EmbeddingResponse)
def embed_image(body: EmbedImageRequest):
    if not body.image_b64:
        raise HTTPException(status_code=400, detail="Невалидное изображение")
    embedding = _run_clip_task(embed_image_task, body.image_b64)
    return EmbeddingResponse(embedding=embedding)


@app.post("/embed-text", response_model=EmbeddingResponse)
def embed_text(body: EmbedTextRequest):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Пустой поисковый запрос")
    embedding = _run_clip_task(embed_text_task, text)
    return EmbeddingResponse(embedding=embedding)


@app.get("/health")
def health():
    return {"status": "ok"}
