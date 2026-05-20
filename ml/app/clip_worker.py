"""
Изолированный CLIP в отдельном процессе (spawn).
TensorFlow/DeepFace остаются только в uvicorn — загрузка PyTorch+CLIP
в том же процессе после /detect раньше роняла весь контейнер.
"""
from __future__ import annotations

import base64
import os
from io import BytesIO

import numpy as np
from PIL import Image

# Не пытаться инициализировать CUDA в дочернем процессе без GPU.
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")

_CLIP_MODEL = None
_CLIP_PREPROCESS = None
_CLIP_TOKENIZER = None


def _decode_image_b64(image_b64: str, max_side: int = 768) -> Image.Image:
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
    return img


def _load_clip():
    global _CLIP_MODEL, _CLIP_PREPROCESS, _CLIP_TOKENIZER
    if _CLIP_MODEL is not None:
        return _CLIP_MODEL, _CLIP_PREPROCESS, _CLIP_TOKENIZER

    import open_clip
    import torch

    model, _, preprocess = open_clip.create_model_and_transforms(
        "xlm-roberta-base-ViT-B-32",
        pretrained="laion5b_s13b_b90k",
    )
    model.eval()
    model.to("cpu")
    tokenizer = open_clip.get_tokenizer("xlm-roberta-base-ViT-B-32")
    _CLIP_MODEL = model
    _CLIP_PREPROCESS = preprocess
    _CLIP_TOKENIZER = tokenizer
    return model, preprocess, tokenizer


def _normalized_vector_to_list(vec: np.ndarray) -> list[float]:
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return [float(x) for x in vec.tolist()]


def embed_image_task(image_b64: str) -> list[float]:
    import torch

    img = _decode_image_b64(image_b64, max_side=768)
    model, preprocess, _ = _load_clip()
    tensor = preprocess(img).unsqueeze(0)
    with torch.no_grad():
        embedding = model.encode_image(tensor)[0].detach().cpu().numpy()
    return _normalized_vector_to_list(embedding)


def embed_text_task(text: str) -> list[float]:
    import torch

    value = (text or "").strip()
    if not value:
        raise ValueError("Пустой поисковый запрос")

    model, _, tokenizer = _load_clip()
    tokens = tokenizer([value])
    with torch.no_grad():
        embedding = model.encode_text(tokens)[0].detach().cpu().numpy()
    return _normalized_vector_to_list(embedding)
