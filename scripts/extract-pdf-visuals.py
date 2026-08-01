#!/usr/bin/env python3
"""Extract likely visual assets from PDFs for PPT generation.

The fast pdf-marker path used by Scholar Harness extracts text only. This
helper complements it by extracting embedded raster images and rendering
figure/table regions from PDF pages so downstream Codex analysis can inspect
visual evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except Exception as exc:  # pragma: no cover - reported to caller
    print(json.dumps({"success": False, "error": f"PyMuPDF unavailable: {exc}"}, ensure_ascii=True))
    sys.exit(2)


CAPTION_RE = re.compile(
    r"(?:^\s*|(?<=[.!?。]\s))((?:(?:fig(?:ure)?\.?|f\s*i\s*g\s*u\s*r\s*e)|(?:table|t\s*a\s*b\s*l\s*e)|图表|图|表)\s*"
    r"(?:\d+(?:[.-]\d+)?|[ivxlcdm]+|[一二三四五六七八九十百]+)\s*\.?)",
    re.IGNORECASE,
)
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]+")


def safe_stem(value: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1F]+', "_", value).strip(" ._")
    return cleaned[:90] or "pdf"


def clean_text(value: str, max_len: int = 1200) -> str:
    text = CONTROL_RE.sub(" ", str(value or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_len]


def caption_match(value: str) -> re.Match[str] | None:
    match = CAPTION_RE.search(clean_text(value, 1600))
    return match if match and match.start() <= 4 else None


def is_caption_text(value: str) -> bool:
    return caption_match(value) is not None


def has_real_caption(item: dict) -> bool:
    caption = clean_text(item.get("caption", ""), 1200)
    title = clean_text(item.get("captionTitle", ""), 320)
    return bool(is_caption_text(caption) or title)


def perceptual_hash(image_path: Path, grid: int = 16) -> int | None:
    pix = None
    converted = None
    try:
        pix = fitz.Pixmap(str(image_path))
        if pix.alpha or pix.n not in (1, 3):
            converted = fitz.Pixmap(fitz.csRGB, pix)
            pix = converted
        if pix.width <= 0 or pix.height <= 0:
            return None
        samples = pix.samples
        values: list[int] = []
        for gy in range(grid):
            y = min(pix.height - 1, int((gy + 0.5) * pix.height / grid))
            for gx in range(grid):
                x = min(pix.width - 1, int((gx + 0.5) * pix.width / grid))
                offset = y * pix.stride + x * pix.n
                if pix.n == 1:
                    gray = int(samples[offset])
                else:
                    red, green, blue = samples[offset], samples[offset + 1], samples[offset + 2]
                    gray = int(0.299 * red + 0.587 * green + 0.114 * blue)
                values.append(gray)
        average = sum(values) / max(1, len(values))
        result = 0
        for value in values:
            result = (result << 1) | int(value >= average)
        return result
    except Exception:
        return None
    finally:
        converted = None
        pix = None


def visual_item_quality(item: dict) -> int:
    source = clean_text(item.get("source", ""), 80).lower()
    score = {
        "caption-crop": 45,
        "visual-region": 35,
        "embedded-image": 30,
        "caption-page-fallback": 10,
    }.get(source, 0)
    if has_real_caption(item):
        score += 60
    confidence = clean_text(item.get("confidence", ""), 40).lower()
    score += {"high": 15, "medium": 8, "low": 0}.get(confidence, 0)
    return score


def dedupe_visual_items(items: list[dict]) -> list[dict]:
    unique: list[dict] = []
    signatures: list[tuple[str, int | None, float]] = []
    for item in items:
        image_path = Path(str(item.get("absolutePath") or ""))
        if not image_path.is_file():
            continue
        try:
            exact = hashlib.sha256(image_path.read_bytes()).hexdigest()
        except OSError:
            exact = ""
        width = max(1, int(item.get("width") or 1))
        height = max(1, int(item.get("height") or 1))
        aspect = width / height
        visual_hash = perceptual_hash(image_path)

        duplicate_index = -1
        for index, (known_exact, known_hash, known_aspect) in enumerate(signatures):
            exact_match = bool(exact and known_exact and exact == known_exact)
            perceptual_match = (
                visual_hash is not None
                and known_hash is not None
                and abs(aspect - known_aspect) / max(aspect, known_aspect, 0.01) <= 0.12
                and bin(visual_hash ^ known_hash).count("1") <= 10
            )
            if exact_match or perceptual_match:
                duplicate_index = index
                break

        if duplicate_index < 0:
            item["contentHash"] = exact
            unique.append(item)
            signatures.append((exact, visual_hash, aspect))
            continue
        if visual_item_quality(item) > visual_item_quality(unique[duplicate_index]):
            old_path = Path(str(unique[duplicate_index].get("absolutePath") or ""))
            if old_path != image_path:
                old_path.unlink(missing_ok=True)
            item["contentHash"] = exact
            unique[duplicate_index] = item
            signatures[duplicate_index] = (exact, visual_hash, aspect)
        else:
            image_path.unlink(missing_ok=True)
    return unique


def caption_meta(text: str) -> dict:
    caption = clean_text(text, 1200)
    match = caption_match(caption)
    label = clean_text(match.group(1), 80) if match else ""
    title = caption
    if match:
        title = clean_text(caption[match.end():].lstrip(" .:：-"), 320)
    elif label and title.lower().startswith(label.lower()):
        title = clean_text(title[len(label):].lstrip(" .:：-"), 320)
    if not title:
        title = caption[:320]
    return {
        "caption": caption,
        "captionLabel": label,
        "captionTitle": title,
    }


def rect_area(rect: fitz.Rect) -> float:
    return max(0.0, rect.width) * max(0.0, rect.height)


def rect_union(rects: list[fitz.Rect]) -> fitz.Rect | None:
    if not rects:
        return None
    merged = fitz.Rect(rects[0])
    for rect in rects[1:]:
        merged |= rect
    return merged


def expand_rect(rect: fitz.Rect, page_rect: fitz.Rect, pad: float) -> fitz.Rect:
    return fitz.Rect(
        max(page_rect.x0, rect.x0 - pad),
        max(page_rect.y0, rect.y0 - pad),
        min(page_rect.x1, rect.x1 + pad),
        min(page_rect.y1, rect.y1 + pad),
    )


def pixmap_to_png(pix: fitz.Pixmap, output_path: Path) -> tuple[int, int]:
    colorspace_name = getattr(getattr(pix, "colorspace", None), "name", "") or ""
    needs_rgb = (
        pix.alpha
        or pix.n not in (1, 3)
        or colorspace_name not in ("", "DeviceGray", "DeviceRGB")
    )
    if needs_rgb:
        converted = fitz.Pixmap(fitz.csRGB, pix)
        try:
            converted.save(output_path)
            return converted.width, converted.height
        finally:
            converted = None
    pix.save(output_path)
    return pix.width, pix.height


def render_clip(page: fitz.Page, clip: fitz.Rect, output_path: Path, zoom: float = 2.0) -> tuple[int, int]:
    matrix = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=False)
    try:
        pix.save(output_path)
        return pix.width, pix.height
    finally:
        pix = None


def page_text_blocks(page: fitz.Page) -> list[tuple[fitz.Rect, str]]:
    blocks: list[tuple[fitz.Rect, str]] = []
    data = page.get_text("dict")
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        lines: list[str] = []
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            text = "".join(str(span.get("text", "")) for span in spans).strip()
            if text:
                lines.append(text)
        joined = clean_text(" ".join(lines), 1600)
        if joined:
            blocks.append((fitz.Rect(block.get("bbox", (0, 0, 0, 0))), joined))
    return sorted(blocks, key=lambda item: (round(item[0].y0, 1), round(item[0].x0, 1)))


def guess_section_title(blocks: list[tuple[fitz.Rect, str]], target_index: int) -> str:
    for _, text in reversed(blocks[:target_index]):
        clean = clean_text(text, 180)
        if is_caption_text(clean):
            continue
        if len(clean) <= 90 and (
            re.match(r"^\d+(?:\.\d+)*\s+[A-Z]", clean)
            or re.match(r"^[A-Z][A-Za-z ,:/()-]{4,80}$", clean)
            or re.match(r"^(Abstract|Introduction|Materials|Methods|Results|Discussion|Conclusion)", clean, re.I)
        ):
            return clean
    return ""


def nearest_caption(blocks: list[tuple[fitz.Rect, str]], target: fitz.Rect) -> tuple[int, fitz.Rect, str] | None:
    best: tuple[float, int, fitz.Rect, str] | None = None
    for index, (rect, text) in enumerate(blocks):
        if not is_caption_text(text):
            continue
        vertical_gap = 0.0
        if rect.y0 >= target.y1:
            vertical_gap = rect.y0 - target.y1
        elif target.y0 >= rect.y1:
            vertical_gap = target.y0 - rect.y1
        horizontal_gap = abs((rect.x0 + rect.x1) / 2 - (target.x0 + target.x1) / 2) * 0.08
        score = vertical_gap + horizontal_gap
        if rect.y0 < target.y0:
            score += 80
        if best is None or score < best[0]:
            best = (score, index, rect, text)
    # A body paragraph elsewhere on the page may mention "Fig. 1", but it is
    # not the caption for an embedded publisher mark. Real captions are
    # spatially adjacent to their figure.
    if not best or best[0] > 160:
        return None
    return best[1], best[2], best[3]


def context_for_index(blocks: list[tuple[fitz.Rect, str]], index: int) -> dict:
    before: list[str] = []
    after: list[str] = []
    for _, text in reversed(blocks[max(0, index - 5):index]):
        if is_caption_text(text):
            continue
        before.append(text)
        if len(" ".join(before)) > 650:
            break
    before = list(reversed(before))
    for _, text in blocks[index + 1:index + 7]:
        if is_caption_text(text):
            continue
        after.append(text)
        if len(" ".join(after)) > 650:
            break
    return {
        "sectionTitle": guess_section_title(blocks, index),
        "contextBefore": clean_text(" ".join(before), 700),
        "contextAfter": clean_text(" ".join(after), 700),
        "nearbyText": clean_text(" ".join(before + after), 1200),
    }


def context_for_rect(blocks: list[tuple[fitz.Rect, str]], target: fitz.Rect) -> dict:
    caption = nearest_caption(blocks, target)
    if caption:
        index, _, text = caption
        meta = caption_meta(text)
        return {**meta, **context_for_index(blocks, index)}

    before: list[str] = []
    after: list[str] = []
    before_candidates = [(rect, text) for rect, text in blocks if rect.y1 <= target.y0 and not is_caption_text(text)]
    after_candidates = [(rect, text) for rect, text in blocks if rect.y0 >= target.y1 and not is_caption_text(text)]
    for _, text in reversed(before_candidates[-4:]):
        before.append(text)
    for _, text in after_candidates[:4]:
        after.append(text)
    before_ordered = list(reversed(before))
    return {
        "caption": "",
        "captionLabel": "",
        "captionTitle": "",
        "sectionTitle": "",
        "contextBefore": clean_text(" ".join(before_ordered), 700),
        "contextAfter": clean_text(" ".join(after), 700),
        "nearbyText": clean_text(" ".join(before_ordered + after), 1200),
    }


def caption_crops(
    doc: fitz.Document,
    pdf_path: Path,
    output_dir: Path,
    existing: int,
    max_assets: int,
) -> list[dict]:
    items: list[dict] = []
    pdf_stem = safe_stem(pdf_path.stem)
    for page_index in range(len(doc)):
        if existing + len(items) >= max_assets:
            break
        page = doc[page_index]
        page_rect = page.rect
        blocks = page_text_blocks(page)
        for block_index, (rect, text) in enumerate(blocks):
            if existing + len(items) >= max_assets:
                break
            if not is_caption_text(text):
                continue
            top = max(page_rect.y0, rect.y0 - min(page_rect.height * 0.52, 380))
            bottom = min(page_rect.y1, rect.y1 + 28)
            clip = fitz.Rect(page_rect.x0 + 28, top, page_rect.x1 - 28, bottom)
            if clip.height < 100 or clip.width < 160:
                continue
            filename = f"{pdf_stem}_p{page_index + 1:03d}_caption_{len(items) + 1:02d}.png"
            output_path = output_dir / filename
            width, height = render_clip(page, clip, output_path)
            meta = caption_meta(text)
            context = context_for_index(blocks, block_index)
            items.append({
                "filename": filename,
                "absolutePath": str(output_path),
                "sourcePdf": pdf_path.name,
                "page": page_index + 1,
                "source": "caption-crop",
                **meta,
                **context,
                "width": width,
                "height": height,
                "description": clean_text(f"{meta['captionLabel'] or 'Figure/Table'} on page {page_index + 1}: {meta['captionTitle'] or meta['caption']}", 360),
                "suggestedUse": clean_text("Use on the slide whose text discusses this exact figure/table caption and nearby result/method context.", 220),
                "confidence": "high" if meta["captionTitle"] else "medium",
            })
    return items


def visual_region_crops(
    doc: fitz.Document,
    pdf_path: Path,
    output_dir: Path,
    existing: int,
    max_assets: int,
    pages_with_caption_crop: set[int],
) -> list[dict]:
    items: list[dict] = []
    pdf_stem = safe_stem(pdf_path.stem)
    for page_index in range(len(doc)):
        if existing + len(items) >= max_assets:
            break
        page_number = page_index + 1
        if page_number in pages_with_caption_crop:
            continue
        page = doc[page_index]
        page_rect = page.rect
        blocks = page_text_blocks(page)
        rects: list[fitz.Rect] = []

        for block in page.get_text("dict").get("blocks", []):
            if block.get("type") == 1:
                rect = fitz.Rect(block.get("bbox", (0, 0, 0, 0)))
                if rect_area(rect) > rect_area(page_rect) * 0.02:
                    rects.append(rect)

        drawings = page.get_drawings()
        if len(drawings) >= 8:
            drawing_rects = [
                fitz.Rect(d.get("rect"))
                for d in drawings
                if d.get("rect") and rect_area(fitz.Rect(d.get("rect"))) > 24
            ]
            if drawing_rects:
                rects.append(rect_union(drawing_rects))

        rects = [rect for rect in rects if rect is not None]
        merged = rect_union(rects)
        if not merged:
            continue
        merged = expand_rect(merged, page_rect, 28)
        page_area = rect_area(page_rect)
        if rect_area(merged) < page_area * 0.035 or merged.width < 160 or merged.height < 100:
            continue
        if rect_area(merged) > page_area * 0.85:
            continue
        filename = f"{pdf_stem}_p{page_number:03d}_visual_{len(items) + 1:02d}.png"
        output_path = output_dir / filename
        width, height = render_clip(page, merged, output_path)
        context = context_for_rect(blocks, merged)
        items.append({
            "filename": filename,
            "absolutePath": str(output_path),
            "sourcePdf": pdf_path.name,
            "page": page_number,
            "source": "visual-region",
            **context,
            "width": width,
            "height": height,
            "description": clean_text(f"Detected visual region on PDF page {page_number}. {context.get('captionTitle') or context.get('nearbyText')}", 360),
            "suggestedUse": "Use after matching its caption/nearby text to a method, result, or discussion slide.",
            "confidence": "medium" if context.get("captionTitle") else "low",
        })
    return items


def caption_page_fallbacks(
    doc: fitz.Document,
    pdf_path: Path,
    output_dir: Path,
    existing: int,
    max_assets: int,
    pages_with_items: set[int],
) -> list[dict]:
    items: list[dict] = []
    pdf_stem = safe_stem(pdf_path.stem)
    for page_index in range(len(doc)):
        if existing + len(items) >= max_assets:
            break
        page_number = page_index + 1
        if page_number in pages_with_items:
            continue
        page = doc[page_index]
        page_rect = page.rect
        blocks = page_text_blocks(page)
        caption_block: tuple[int, fitz.Rect, str] | None = None
        for block_index, (rect, text) in enumerate(blocks):
            if is_caption_text(text):
                caption_block = (block_index, rect, text)
                break
        if not caption_block:
            continue
        block_index, _rect, text = caption_block
        clip = fitz.Rect(
            page_rect.x0 + 18,
            page_rect.y0 + 18,
            page_rect.x1 - 18,
            page_rect.y1 - 18,
        )
        if clip.width < 160 or clip.height < 160:
            continue
        filename = f"{pdf_stem}_p{page_number:03d}_caption_page_{len(items) + 1:02d}.png"
        output_path = output_dir / filename
        width, height = render_clip(page, clip, output_path, zoom=1.6)
        meta = caption_meta(text)
        context = context_for_index(blocks, block_index)
        items.append({
            "filename": filename,
            "absolutePath": str(output_path),
            "sourcePdf": pdf_path.name,
            "page": page_number,
            "source": "caption-page-fallback",
            **meta,
            **context,
            "width": width,
            "height": height,
            "description": clean_text(f"Fallback rendered PDF page {page_number} because a caption was found but no embedded/visual region was extracted. {meta['captionTitle'] or meta['caption']}", 360),
            "suggestedUse": "Use when no tighter crop is available; manually crop or inspect the figure/table region on this rendered page.",
            "confidence": "medium" if meta["captionTitle"] else "low",
        })
    return items


def embedded_images(
    doc: fitz.Document,
    pdf_path: Path,
    output_dir: Path,
    existing: int,
    max_assets: int,
) -> list[dict]:
    items: list[dict] = []
    seen: set[int] = set()
    seen_hashes: set[str] = set()
    pdf_stem = safe_stem(pdf_path.stem)
    for page_index in range(len(doc)):
        if existing + len(items) >= max_assets:
            break
        page = doc[page_index]
        blocks = page_text_blocks(page)
        for image_index, image in enumerate(page.get_images(full=True)):
            if existing + len(items) >= max_assets:
                break
            xref = int(image[0])
            if xref in seen:
                continue
            seen.add(xref)
            pix = None
            try:
                pix = fitz.Pixmap(doc, xref)
                if pix.width < 160 or pix.height < 100:
                    continue
                digest = hashlib.sha1(pix.samples).hexdigest()
                if digest in seen_hashes:
                    continue
                seen_hashes.add(digest)
                rects = page.get_image_rects(xref)
                image_rect = rect_union([fitz.Rect(rect) for rect in rects]) if rects else None
                context = context_for_rect(blocks, image_rect) if image_rect else {
                    "caption": "",
                    "captionLabel": "",
                    "captionTitle": "",
                    "sectionTitle": "",
                    "contextBefore": "",
                    "contextAfter": "",
                    "nearbyText": "",
                }
                image_aspect = pix.width / max(1, pix.height)
                page_area_ratio = rect_area(image_rect) / max(1.0, rect_area(page.rect)) if image_rect else 0.0
                if page_index == 0 and not has_real_caption(context):
                    continue
                if not has_real_caption(context) and (
                    (0 < page_area_ratio < 0.018)
                    or image_aspect > 6.5
                    or image_aspect < 0.12
                ):
                    continue
                filename = f"{pdf_stem}_p{page_index + 1:03d}_embedded_{image_index + 1:02d}.png"
                output_path = output_dir / filename
                width, height = pixmap_to_png(pix, output_path)
                items.append({
                    "filename": filename,
                    "absolutePath": str(output_path),
                    "sourcePdf": pdf_path.name,
                    "page": page_index + 1,
                    "source": "embedded-image",
                    **context,
                    "width": width,
                    "height": height,
                    "rectX": image_rect.x0 if image_rect else 0,
                    "rectY": image_rect.y0 if image_rect else 0,
                    "rectWidth": image_rect.width if image_rect else 0,
                    "rectHeight": image_rect.height if image_rect else 0,
                    "pageAreaRatio": page_area_ratio,
                    "description": clean_text(f"Embedded image from PDF page {page_index + 1}. {context.get('captionTitle') or context.get('nearbyText')}", 360),
                    "suggestedUse": "Use after matching its caption/nearby text to the slide content.",
                    "confidence": "high" if context.get("captionTitle") else "medium",
                })
            except Exception:
                continue
            finally:
                pix = None
    return items


def extract_from_pdf(pdf_path: Path, output_dir: Path, max_assets: int) -> list[dict]:
    items: list[dict] = []
    with fitz.open(pdf_path) as doc:
        items.extend(embedded_images(doc, pdf_path, output_dir, len(items), max_assets))
        caption_items = caption_crops(doc, pdf_path, output_dir, len(items), max_assets)
        items.extend(caption_items)
        caption_pages = {int(item["page"]) for item in caption_items}
        items.extend(visual_region_crops(doc, pdf_path, output_dir, len(items), max_assets, caption_pages))
        pages_with_items = {int(item["page"]) for item in items if "page" in item}
        items.extend(caption_page_fallbacks(doc, pdf_path, output_dir, len(items), max_assets, pages_with_items))
    return dedupe_visual_items(items[:max_assets])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_path", type=Path)
    parser.add_argument("--max-assets", type=int, default=80)
    args = parser.parse_args()

    project_path = args.project_path.resolve()
    sources_dir = project_path / "sources"
    output_dir = project_path / "images" / "pdf-figures"
    output_dir.mkdir(parents=True, exist_ok=True)
    pdfs = sorted(sources_dir.rglob("*.pdf")) if sources_dir.exists() else []

    items: list[dict] = []
    errors: list[dict] = []
    for pdf_path in pdfs:
        if len(items) >= args.max_assets:
            break
        try:
            remaining = args.max_assets - len(items)
            items.extend(extract_from_pdf(pdf_path, output_dir, remaining))
        except Exception as exc:
            errors.append({"fileName": pdf_path.name, "error": str(exc)})

    manifest = {
        "success": not errors,
        "count": len(items),
        "errors": errors,
        "items": items,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
