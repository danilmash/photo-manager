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


class EmbedImageRequest(BaseModel):
    image_b64: str


class EmbedTextRequest(BaseModel):
    text: str


class EmbeddingResponse(BaseModel):
    embedding: list[float]


_clip_model = None
_clip_preprocess = None
_clip_tokenizer = None


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


def load_clip_model():
    global _clip_model, _clip_preprocess, _clip_tokenizer
    if _clip_model is not None:
        return _clip_model, _clip_preprocess, _clip_tokenizer

    import open_clip
    import torch

    model, _, preprocess = open_clip.create_model_and_transforms(
        "xlm-roberta-base-ViT-B-32",
        pretrained="laion5b_s13b_b90k",
    )
    model.eval()
    model.to("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = open_clip.get_tokenizer("xlm-roberta-base-ViT-B-32")
    _clip_model = model
    _clip_preprocess = preprocess
    _clip_tokenizer = tokenizer
    return model, preprocess, tokenizer


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


def _normalized_vector_to_list(vec) -> list[float]:
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return [float(x) for x in vec.tolist()]


@app.post("/embed-image", response_model=EmbeddingResponse)
def embed_image(body: EmbedImageRequest):
    import torch

    try:
        image_bytes = base64.b64decode(body.image_b64)
        img = Image.open(BytesIO(image_bytes)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Невалидное изображение")

    try:
        model, preprocess, _ = load_clip_model()
        device = next(model.parameters()).device
        image = preprocess(img).unsqueeze(0).to(device)
        with torch.no_grad():
            embedding = model.encode_image(image)[0].detach().cpu().numpy()
        return EmbeddingResponse(embedding=_normalized_vector_to_list(embedding))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/embed-text", response_model=EmbeddingResponse)
def embed_text(body: EmbedTextRequest):
    import torch

    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Пустой поисковый запрос")

    try:
        model, _, tokenizer = load_clip_model()
        device = next(model.parameters()).device
        tokens = tokenizer([text]).to(device)
        with torch.no_grad():
            embedding = model.encode_text(tokens)[0].detach().cpu().numpy()
        return EmbeddingResponse(embedding=_normalized_vector_to_list(embedding))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    return {"status": "ok"}