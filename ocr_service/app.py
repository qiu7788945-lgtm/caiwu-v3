from __future__ import annotations

import base64
import io
from typing import Any

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from paddleocr import PaddleOCR
from PIL import Image

app = FastAPI(title="Local OCR Service")

# 初始化一次，避免每次请求重复加载模型
ocr = PaddleOCR(use_angle_cls=True, lang="ch")


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


def pil_to_bgr_array(image: Image.Image) -> np.ndarray:
    rgb = image.convert("RGB")
    arr = np.array(rgb)
    # RGB -> BGR
    return arr[:, :, ::-1]


def load_image_from_bytes(data: bytes) -> Image.Image:
    try:
        return Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法读取图片: {exc}") from exc


def load_image_from_base64(base64_data: str) -> Image.Image:
    raw = base64_data.strip()
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]

    try:
        data = base64.b64decode(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"base64 解码失败: {exc}") from exc

    return load_image_from_bytes(data)


def rotate_image(image: Image.Image, angle: int) -> Image.Image:
    if angle == 0:
        return image
    return image.rotate(-angle, expand=True)


def run_ocr_once(image: Image.Image, angle: int) -> dict[str, Any]:
    rotated = rotate_image(image, angle)
    img = pil_to_bgr_array(rotated)

    result = ocr.ocr(img, cls=True)
    rows = result[0] if result and len(result) > 0 and result[0] else []

    lines: list[dict[str, Any]] = []
    texts: list[str] = []
    scores: list[float] = []

    for row in rows:
        if not row or len(row) < 2:
            continue
        rec = row[1]
        if not rec or len(rec) < 2:
            continue

        text = str(rec[0]).strip()
        score = float(rec[1])
        if not text:
            continue

        texts.append(text)
        scores.append(score)
        lines.append({"text": text, "score": score})

    avg_score = sum(scores) / len(scores) if scores else 0.0
    full_text = "\n".join(texts)

    return {
        "angle": angle,
        "text": full_text,
        "avg_score": avg_score,
        "lines": lines,
        "text_length": len(full_text.replace("\n", "").strip()),
    }


def choose_best_result(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    if not candidates:
        return {
            "angle": 0,
            "text": "",
            "avg_score": 0.0,
            "lines": [],
            "text_length": 0,
        }

    return sorted(
        candidates,
        key=lambda x: (x["text_length"], x["avg_score"]),
        reverse=True,
    )[0]


@app.post("/ocr/image")
async def ocr_image(
    file: UploadFile | None = File(default=None),
    image_base64: str | None = Form(default=None),
) -> JSONResponse:
    if file is None and not image_base64:
        raise HTTPException(status_code=400, detail="请上传图片文件或提供 image_base64")

    if file is not None:
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="上传文件为空")
        image = load_image_from_bytes(data)
    else:
        image = load_image_from_base64(image_base64 or "")

    candidates = [run_ocr_once(image, angle) for angle in (0, 90, 180, 270)]
    best = choose_best_result(candidates)

    return JSONResponse(
        {
            "ok": True,
            "text": best["text"],
            "angle": best["angle"],
            "avg_score": best["avg_score"],
            "lines": best["lines"],
        }
    )
