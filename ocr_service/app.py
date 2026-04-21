from __future__ import annotations

import base64
import io
import json
from typing import Any

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from paddleocr import PaddleOCR
from PIL import Image

app = FastAPI(title="Local OCR Service")

# 初始化一次，避免每次请求重复加载模型
ocr = PaddleOCR(
    text_detection_model_name="PP-OCRv5_mobile_det",
    text_recognition_model_name="PP-OCRv5_mobile_rec",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=True,
    lang="ch",
    enable_mkldnn=False,
)


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


def _append_line(
    lines: list[dict[str, Any]],
    texts: list[str],
    scores: list[float],
    text: Any,
    score: Any = 0.0,
) -> None:
    t = str(text).strip()
    if not t:
        return

    try:
        s = float(score)
    except Exception:
        s = 0.0

    lines.append({"text": t, "score": s})
    texts.append(t)
    scores.append(s)


def _extract_lines_from_any(
    obj: Any,
    lines: list[dict[str, Any]],
    texts: list[str],
    scores: list[float],
) -> None:
    """
    兼容多种 PaddleOCR / PaddleX 返回结构：
    1) 3.x / PaddleX 风格：dict 中含 rec_texts / rec_scores
    2) 旧风格：[[box, [text, score]], ...]
    3) 嵌套 list / tuple / dict / OCRResult-like 对象
    """
    if obj is None:
        return

    # 先处理类似 OCRResult 的对象，尝试拿 json / dict 表示
    if not isinstance(obj, (dict, list, tuple, str, bytes, int, float, bool)):
        # 属性 json 可能是 dict、str，或者可调用
        if hasattr(obj, "json"):
            try:
                json_attr = getattr(obj, "json")
                if callable(json_attr):
                    data = json_attr()
                else:
                    data = json_attr

                if isinstance(data, str):
                    try:
                        data = json.loads(data)
                    except Exception:
                        pass

                _extract_lines_from_any(data, lines, texts, scores)
                return
            except Exception:
                pass

        # 某些对象可能有 dict / model_dump
        for attr_name in ("dict", "model_dump"):
            if hasattr(obj, attr_name):
                try:
                    fn = getattr(obj, attr_name)
                    if callable(fn):
                        data = fn()
                        _extract_lines_from_any(data, lines, texts, scores)
                        return
                except Exception:
                    pass

    # dict 风格：优先识别 rec_texts / rec_scores
    if isinstance(obj, dict):
        if "rec_texts" in obj:
            rec_texts = obj.get("rec_texts") or []
            rec_scores = obj.get("rec_scores") or []
            for idx, text in enumerate(rec_texts):
                score = rec_scores[idx] if idx < len(rec_scores) else 0.0
                _append_line(lines, texts, scores, text, score)
            return

        # 常见嵌套键，优先深入
        for key in ("res", "result", "data", "value", "output"):
            if key in obj:
                _extract_lines_from_any(obj.get(key), lines, texts, scores)
                return

        # 实在不确定时，遍历 value
        for value in obj.values():
            _extract_lines_from_any(value, lines, texts, scores)
        return

    # list / tuple 风格
    if isinstance(obj, (list, tuple)):
        # 旧版标准单行： [box, [text, score]]
        if len(obj) >= 2 and isinstance(obj[1], (list, tuple)) and len(obj[1]) >= 1:
            rec = obj[1]
            text = rec[0]
            score = rec[1] if len(rec) >= 2 else 0.0
            _append_line(lines, texts, scores, text, score)
            return

        # 其它情况就递归扫每个元素
        for item in obj:
            _extract_lines_from_any(item, lines, texts, scores)
        return

    # 单个字符串不直接采纳，避免把 json / 其他文本误当成 OCR 行
    return


def run_ocr_once(image: Image.Image, angle: int) -> dict[str, Any]:
    rotated = rotate_image(image, angle)
    img = pil_to_bgr_array(rotated)

    # 这里继续用 ocr.ocr，内部会走到 predict
    result = ocr.ocr(img)

    lines: list[dict[str, Any]] = []
    texts: list[str] = []
    scores: list[float] = []

    # 调试：确认真实返回类型，便于后续继续排查
    print(f"[OCR API raw type] {type(result)}")
    print(f"[OCR API raw preview] {repr(result)[:500]}")

    _extract_lines_from_any(result, lines, texts, scores)

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
    request: Request,
    file: UploadFile | None = File(default=None),
    image_base64: str | None = Form(default=None),
) -> JSONResponse:
    try:
        print("[OCR API request received]")

        # 兼容 JSON body：{ "image_base64": "..." }
        json_image_base64: str | None = None
        content_type = request.headers.get("content-type", "").lower()

        if "application/json" in content_type:
            try:
                body = await request.json()
                if isinstance(body, dict):
                    value = body.get("image_base64")
                    if isinstance(value, str):
                        json_image_base64 = value
            except Exception:
                json_image_base64 = None

        final_image_base64 = image_base64 or json_image_base64

        if file is None and not final_image_base64:
            raise HTTPException(status_code=400, detail="请上传图片文件或提供 image_base64")

        if file is not None:
            data = await file.read()
            if not data:
                raise HTTPException(status_code=400, detail="上传文件为空")
            image = load_image_from_bytes(data)
        else:
            image = load_image_from_base64(final_image_base64 or "")

        first = run_ocr_once(image, 0)

        needs_fallback_angles = (
            not first["lines"]
            or first["text_length"] < 20
            or first["avg_score"] < 0.80
        )

        if needs_fallback_angles:
            candidates = [first] + [run_ocr_once(image, angle) for angle in (90, 180, 270)]
            best = choose_best_result(candidates)
        else:
            best = first

        text_length = len((best["text"] or "").replace("\n", "").strip())
        print(f"[OCR API success] textLength={text_length}")

        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "text": best["text"],
                "angle": best["angle"],
                "avg_score": best["avg_score"],
                "lines": best["lines"],
            },
        )
    except HTTPException as exc:
        print(f"[OCR API exception] {repr(exc)}")
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "ok": False,
                "error": exc.detail,
            },
        )
    except Exception as e:
        print(f"[OCR API exception] {repr(e)}")
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": repr(e),
            },
        )
