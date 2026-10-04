#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import math
import secrets
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.color import rgb2gray, rgb2hsv
from skimage.feature import canny
from skimage.metrics import structural_similarity
from skimage.morphology import binary_dilation, disk

METRIC_SIZE = (768, 432)
PREVIEW_SIZE = (480, 270)


def load_rgb(path: Path, size: tuple[int, int]) -> np.ndarray:
    with Image.open(path) as image:
        image = image.convert("RGB").resize(size, Image.Resampling.LANCZOS)
        return np.asarray(image, dtype=np.float32) / 255.0


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    a = a.reshape(-1).astype(np.float64)
    b = b.reshape(-1).astype(np.float64)
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return 1.0 if np.allclose(a, b) else 0.0
    return float(np.dot(a, b) / denom)


def hist_similarity(a: np.ndarray, b: np.ndarray, bins: int = 32) -> float:
    ah, _ = np.histogram(a, bins=bins, range=(0.0, 1.0), density=False)
    bh, _ = np.histogram(b, bins=bins, range=(0.0, 1.0), density=False)
    ap = ah / max(1, ah.sum())
    bp = bh / max(1, bh.sum())
    return float(np.sqrt(ap * bp).sum())


def color_similarity(a: np.ndarray, b: np.ndarray) -> float:
    ahsv = rgb2hsv(a)
    bhsv = rgb2hsv(b)
    ah, _ = np.histogramdd(
        np.column_stack((ahsv[..., 0].ravel(), ahsv[..., 1].ravel())),
        bins=(24, 8),
        range=((0.0, 1.0), (0.0, 1.0)),
    )
    bh, _ = np.histogramdd(
        np.column_stack((bhsv[..., 0].ravel(), bhsv[..., 1].ravel())),
        bins=(24, 8),
        range=((0.0, 1.0), (0.0, 1.0)),
    )
    ap = ah / max(1.0, float(ah.sum()))
    bp = bh / max(1.0, float(bh.sum()))
    return float(np.sqrt(ap * bp).sum())


def edge_overlap(a_gray: np.ndarray, b_gray: np.ndarray) -> float:
    a_edge = canny(a_gray, sigma=1.4)
    b_edge = canny(b_gray, sigma=1.4)
    a_tol = binary_dilation(a_edge, disk(2))
    b_tol = binary_dilation(b_edge, disk(2))
    if not a_edge.any() or not b_edge.any():
        return 0.0
    a_hit = float((a_edge & b_tol).sum()) / float(a_edge.sum())
    b_hit = float((b_edge & a_tol).sum()) / float(b_edge.sum())
    return (a_hit + b_hit) / 2.0


def low_frequency_similarity(a_gray: np.ndarray, b_gray: np.ndarray) -> float:
    def low(gray: np.ndarray) -> np.ndarray:
        image = Image.fromarray(np.uint8(np.clip(gray, 0, 1) * 255), mode="L")
        return np.asarray(image.resize((32, 18), Image.Resampling.BILINEAR), dtype=np.float32) / 255.0

    return max(0.0, min(1.0, cosine(low(a_gray), low(b_gray))))


def make_preview(source: Path, dest: Path) -> None:
    with Image.open(source) as image:
        image = image.convert("RGB")
        image.thumbnail(PREVIEW_SIZE, Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", PREVIEW_SIZE, (0, 0, 0))
        x = (PREVIEW_SIZE[0] - image.width) // 2
        y = (PREVIEW_SIZE[1] - image.height) // 2
        canvas.paste(image, (x, y))
        canvas.save(dest, "JPEG", quality=68, optimize=True)


def encode(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)

    reference = load_rgb(args.reference, METRIC_SIZE)
    candidate = load_rgb(args.candidate, METRIC_SIZE)
    reference_gray = rgb2gray(reference)
    candidate_gray = rgb2gray(candidate)

    candidate_std = float(candidate_gray.std())
    candidate_mean = float(candidate_gray.mean())
    if candidate_std < 0.01 or candidate_mean < 0.003:
        raise SystemExit(
            f"candidate render looks blank: mean={candidate_mean:.6f} std={candidate_std:.6f}"
        )

    ssim = float(
        structural_similarity(
            reference_gray,
            candidate_gray,
            data_range=1.0,
        )
    )
    composition = low_frequency_similarity(reference_gray, candidate_gray)
    edges = edge_overlap(reference_gray, candidate_gray)
    color = color_similarity(reference, candidate)
    luminance = hist_similarity(reference_gray, candidate_gray)
    diagnostic = (
        0.15 * max(0.0, ssim)
        + 0.30 * composition
        + 0.25 * edges
        + 0.20 * color
        + 0.10 * luminance
    )

    metrics = {
        "schema_version": 1,
        "scene": "mycelium",
        "metric_size": list(METRIC_SIZE),
        "ssim": round(ssim, 6),
        "low_frequency_composition": round(composition, 6),
        "edge_overlap_tolerant": round(edges, 6),
        "hsv_distribution": round(color, 6),
        "luminance_histogram": round(luminance, 6),
        "diagnostic_weighted_similarity": round(diagnostic, 6),
        "note": "Symmetric pairwise diagnostics only; blind visual review remains authoritative.",
    }
    (args.out_dir / "blind-metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    diagnostics = {
        **metrics,
        "reference": args.reference.as_posix(),
        "candidate": args.candidate.as_posix(),
        "candidate_luminance_mean": round(candidate_mean, 6),
        "candidate_luminance_std": round(candidate_std, 6),
    }
    (args.out_dir / "diagnostics.json").write_text(json.dumps(diagnostics, indent=2) + "\n")

    ref_preview = args.out_dir / "reference-preview.jpg"
    cand_preview = args.out_dir / "candidate-preview.jpg"
    make_preview(args.reference, ref_preview)
    make_preview(args.candidate, cand_preview)

    if secrets.randbits(1):
        mapping = {"A": "reference", "B": "candidate"}
        a, b = ref_preview, cand_preview
    else:
        mapping = {"A": "candidate", "B": "reference"}
        a, b = cand_preview, ref_preview

    blind_a = args.out_dir / "blind-a.jpg"
    blind_b = args.out_dir / "blind-b.jpg"
    blind_a.write_bytes(a.read_bytes())
    blind_b.write_bytes(b.read_bytes())
    (args.out_dir / "reveal.json").write_text(json.dumps(mapping, indent=2) + "\n")

    print("BLIND_METRICS_JSON=" + json.dumps(metrics, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
