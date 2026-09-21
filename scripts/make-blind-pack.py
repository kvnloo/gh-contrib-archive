#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import secrets
from pathlib import Path

from PIL import Image, ImageDraw


def load(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def letterbox(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    if image.size == size:
        return image
    copy = image.copy()
    copy.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, (5, 5, 7))
    x = (size[0] - copy.width) // 2
    y = (size[1] - copy.height) // 2
    canvas.paste(copy, (x, y))
    return canvas


def pair(a: Image.Image, b: Image.Image, world_token: str) -> Image.Image:
    width = max(a.width, b.width)
    height = max(a.height, b.height)
    a = letterbox(a, (width, height))
    b = letterbox(b, (width, height))
    header = 48
    canvas = Image.new("RGB", (width * 2, height + header), (5, 5, 7))
    canvas.paste(a, (0, header))
    canvas.paste(b, (width, header))
    draw = ImageDraw.Draw(canvas)
    draw.text((14, 12), f"{world_token} / A", fill=(235, 235, 240))
    draw.text((width + 14, 12), f"{world_token} / B", fill=(235, 235, 240))
    return canvas


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--specs", default="visual/scenes.json")
    parser.add_argument("--renders", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--key", required=True)
    args = parser.parse_args()

    root = Path.cwd()
    specs = json.loads((root / args.specs).read_text())
    renders = root / args.renders
    output = root / args.output
    key_path = root / args.key
    output.mkdir(parents=True, exist_ok=True)
    key_path.parent.mkdir(parents=True, exist_ok=True)

    key: dict[str, dict[str, str]] = {}
    for index, spec in enumerate(specs, start=1):
        world = spec["id"]
        target = load(root / spec["target"])
        render = load(renders / f"{world}.png")
        if target.size != render.size:
            render = render.resize(target.size, Image.Resampling.LANCZOS)

        token = f"scene-{index:02d}"
        target_left = bool(secrets.randbits(1))
        left, right = (target, render) if target_left else (render, target)
        pair(left, right, token).save(output / f"{token}.png")
        key[token] = {
            "world": world,
            "A": "reference" if target_left else "render",
            "B": "render" if target_left else "reference",
        }

    key_path.write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
