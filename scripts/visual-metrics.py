#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import shutil
from pathlib import Path

import imagehash
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps
from skimage.metrics import structural_similarity


def rgb(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def arr(image: Image.Image) -> np.ndarray:
    return np.asarray(image, dtype=np.float32) / 255.0


def gray(a: np.ndarray) -> np.ndarray:
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def safe_ssim(a: np.ndarray, b: np.ndarray) -> float:
    return float(structural_similarity(a, b, data_range=1.0))


def weighted_centroid(luma: np.ndarray) -> tuple[float, float]:
    threshold = float(np.quantile(luma, 0.78))
    weights = np.clip(luma - threshold, 0.0, None)
    total = float(weights.sum())
    h, w = luma.shape
    if total <= 1e-9:
        return (0.5, 0.5)
    yy, xx = np.mgrid[0:h, 0:w]
    return (
        float((xx * weights).sum() / total / max(w - 1, 1)),
        float((yy * weights).sum() / total / max(h - 1, 1)),
    )


def centroid_distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return float(math.dist(a, b) / math.sqrt(2.0))


def edge_image(image: Image.Image) -> np.ndarray:
    edges = ImageOps.grayscale(image).filter(ImageFilter.FIND_EDGES)
    data = np.asarray(edges, dtype=np.float32) / 255.0
    return data


def compare(target: Image.Image, render: Image.Image) -> dict:
    if render.size != target.size:
        render = render.resize(target.size, Image.Resampling.LANCZOS)

    ta = arr(target)
    ra = arr(render)
    tg = gray(ta)
    rg = gray(ra)

    mae = float(np.abs(ta - ra).mean())
    rmse = float(np.sqrt(np.square(ta - ra).mean()))
    ssim_rgb = float(
        structural_similarity(ta, ra, channel_axis=2, data_range=1.0)
    )
    edge_t = edge_image(target)
    edge_r = edge_image(render)
    edge_ssim = safe_ssim(edge_t, edge_r)

    target_centroid = weighted_centroid(tg)
    render_centroid = weighted_centroid(rg)

    mean_target = ta.mean(axis=(0, 1))
    mean_render = ra.mean(axis=(0, 1))

    return {
        "ssim_rgb": ssim_rgb,
        "ssim_edges": edge_ssim,
        "mae": mae,
        "rmse": rmse,
        "phash_distance": int(
            imagehash.phash(target) - imagehash.phash(render)
        ),
        "brightness_mean_target": float(tg.mean()),
        "brightness_mean_render": float(rg.mean()),
        "brightness_std_target": float(tg.std()),
        "brightness_std_render": float(rg.std()),
        "dark_fraction_target": float((tg < 0.10).mean()),
        "dark_fraction_render": float((rg < 0.10).mean()),
        "bright_fraction_target": float((tg > 0.75).mean()),
        "bright_fraction_render": float((rg > 0.75).mean()),
        "mean_rgb_target": [float(x) for x in mean_target],
        "mean_rgb_render": [float(x) for x in mean_render],
        "bright_centroid_target": list(target_centroid),
        "bright_centroid_render": list(render_centroid),
        "bright_centroid_distance": centroid_distance(
            target_centroid, render_centroid
        ),
    }


def diff_heatmap(target: Image.Image, render: Image.Image) -> Image.Image:
    if render.size != target.size:
        render = render.resize(target.size, Image.Resampling.LANCZOS)
    diff = ImageChops.difference(target, render)
    g = ImageOps.grayscale(diff)
    return Image.merge("RGB", (g, Image.new("L", g.size), Image.new("L", g.size)))


def make_pair(a: Image.Image, b: Image.Image, title_a: str, title_b: str) -> Image.Image:
    h = max(a.height, b.height)
    canvas = Image.new("RGB", (a.width + b.width, h + 34), (8, 8, 10))
    canvas.paste(a, (0, 34))
    canvas.paste(b, (a.width, 34))
    draw = ImageDraw.Draw(canvas)
    draw.text((12, 10), title_a, fill=(220, 220, 225))
    draw.text((a.width + 12, 10), title_b, fill=(220, 220, 225))
    return canvas


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--specs", default="visual/scenes.json")
    parser.add_argument("--run-a", required=True)
    parser.add_argument("--run-b", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    root = Path.cwd()
    specs = json.loads((root / args.specs).read_text())
    run_a = root / args.run_a
    run_b = root / args.run_b
    output = root / args.output
    targets_out = output / "target"
    pairs_out = output / "pairs"
    diff_out = output / "diff"
    output.mkdir(parents=True, exist_ok=True)
    targets_out.mkdir(parents=True, exist_ok=True)
    pairs_out.mkdir(parents=True, exist_ok=True)
    diff_out.mkdir(parents=True, exist_ok=True)

    report: dict[str, dict] = {}
    md = [
        "# Dream Loop scene-only visual verification",
        "",
        "Machine metrics are intentionally componentized; there is no single opaque pass/fail score.",
        "",
        "| world | run stability SSIM | target SSIM | edge SSIM | pHash Δ | bright centroid Δ | MAE |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]

    for spec in specs:
        world = spec["id"]
        target_path = root / spec["target"]
        a_path = run_a / f"{world}.png"
        b_path = run_b / f"{world}.png"

        target = rgb(target_path)
        a_img = rgb(a_path)
        b_img = rgb(b_path)

        target_to_a = compare(target, a_img)
        stability = compare(a_img, b_img)

        shutil.copy2(target_path, targets_out / f"{world}.png")
        make_pair(target, a_img, "reference", "render").save(
            pairs_out / f"{world}.png"
        )
        diff_heatmap(target, a_img).save(diff_out / f"{world}.png")

        report[world] = {
            "target_size": list(target.size),
            "render_size": list(a_img.size),
            "target_vs_render": target_to_a,
            "run_a_vs_run_b": stability,
        }
        md.append(
            "| {world} | {stable:.4f} | {ssim:.4f} | {edge:.4f} | {phash} | {centroid:.4f} | {mae:.4f} |".format(
                world=world,
                stable=stability["ssim_rgb"],
                ssim=target_to_a["ssim_rgb"],
                edge=target_to_a["ssim_edges"],
                phash=target_to_a["phash_distance"],
                centroid=target_to_a["bright_centroid_distance"],
                mae=target_to_a["mae"],
            )
        )

    (output / "metrics.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    (output / "metrics.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))

    unstable = [
        world
        for world, values in report.items()
        if values["run_a_vs_run_b"]["ssim_rgb"] < 0.985
    ]
    if unstable:
        print(
            "warning: capture is not yet deterministic enough for strict visual gating: "
            + ", ".join(unstable)
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
