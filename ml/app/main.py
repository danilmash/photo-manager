from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import base64
import numpy as np
from io import BytesIO
from PIL import Image

app = FastAPI(title="Photo Manager ML Service")

class DetectRequest(BaseModel):
    image_b64: str 

class FaceResult(BaseModel):
    bbox: dict          # { x, y, width, height }
    embedding: list[float]
    confidence: float

class DetectResponse(BaseModel):
    faces: list[FaceResult]

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    yield

def load_model():
    """Загружаем модель один раз при старте"""
    from deepface import DeepFace
    # прогрев — чтобы модель загрузилась в память
    dummy = np.zeros((100, 100, 3), dtype=np.uint8)
    try:
        DeepFace.represent(dummy, model_name="Facenet", enforce_detection=False)
    except Exception:
        pass

@app.post("/detect", response_model=DetectResponse)
def detect_faces(body: DetectRequest):
    from deepface import DeepFace

    try:
        # Декодируем base64 → PIL Image → numpy array
        image_bytes = base64.b64decode(body.image_b64)
        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        img_array = np.array(img)
    except Exception:
        raise HTTPException(status_code=400, detail="Невалидное изображение")

    try:
        # Находим все лица и получаем эмбеддинги
        results = DeepFace.represent(
            img_array,
            model_name="Facenet",      # 128-мерные векторы, быстро на CPU
            detector_backend="opencv", # самый быстрый детектор
            enforce_detection=False,   # не падать если лиц нет
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    faces = []
    for r in results:
        region = r.get("facial_area", {})
        faces.append(FaceResult(
            bbox={
                "x": region.get("x", 0),
                "y": region.get("y", 0),
                "w": region.get("w", 0),
                "h": region.get("h", 0),
            },
            embedding=r["embedding"],
            confidence=region.get("confidence", 1.0),
        ))

    return DetectResponse(faces=faces)


@app.get("/health")
def health():
    return {"status": "ok"}