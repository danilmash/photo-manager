from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import base64
import numpy as np
from io import BytesIO
from PIL import Image


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


def load_model():
    from deepface import DeepFace

    dummy = np.zeros((100, 100, 3), dtype=np.uint8)
    try:
        DeepFace.represent(dummy, model_name="Facenet", enforce_detection=False)
    except Exception:
        pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_model()
    yield


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


@app.post("/detect", response_model=DetectResponse)
def detect_faces(body: DetectRequest):
    from deepface import DeepFace

    try:
        image_bytes = base64.b64decode(body.image_b64)
        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        img_array = np.array(img)
    except Exception:
        raise HTTPException(status_code=400, detail="Невалидное изображение")

    h_img, w_img = img_array.shape[:2]

    try:
        results = DeepFace.represent(
            img_array,
            model_name="Facenet",
            detector_backend="opencv",
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
        confidence = float(region.get("confidence", 1.0))

        if px_w <= 0 or px_h <= 0:
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


@app.get("/health")
def health():
    return {"status": "ok"}