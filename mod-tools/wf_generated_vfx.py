"""Assemble explicit transparent API frames into an offline WF flatomo family.

No provider calls, implicit store resolution or package writes. Timing is an
assembly choice (hold frames at 60 Hz), not provider supplied animation timing.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import re
import tempfile
import zlib
from pathlib import Path

from PIL import Image, ImageDraw

from wf_dsl import encode_amf3, parse_dsl
from wf_assets import png_decode


def read_image(path):
    """Accept standard API PNG and WF's lowercase signature without source writes."""
    with Image.open(io.BytesIO(png_decode(Path(path).read_bytes()))) as image:
        return image.convert("RGBA")


def read_tree(path: Path):
    if path.suffix == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        return data["tree"] if isinstance(data, dict) and "tree" in data else data
    return parse_dsl(zlib.decompress(path.read_bytes(), -15))["tree"]


def write_tree(path: Path, tree) -> None:
    compressor = zlib.compressobj(level=9, wbits=-15)
    raw = encode_amf3(tree)
    path.write_bytes(compressor.compress(raw) + compressor.flush())
    if read_tree(path) != tree:
        raise ValueError(f"AMF3 round trip failed: {path.name}")


def check_output(output: Path, sources: list[Path]) -> Path:
    output = output.resolve()
    if set(p.casefold() for p in output.parts) & {"upload", ".cdn", "assets", "package"}:
        raise ValueError("output must be a new offline directory, not a package/store")
    for source in sources:
        source = source.resolve()
        if output == source or output in source.parents or source in output.parents:
            raise ValueError("output overlaps an input")
    if output.exists():
        raise FileExistsError(output)
    return output


def split_frames(sheet: Image.Image, count: int, frame_size: tuple[int, int]):
    w, h = frame_size
    if min(w, h, count) <= 0 or max(w, h) > 4096:
        raise ValueError("positive bounded frame geometry required")
    if sheet.width % w or sheet.height % h:
        raise ValueError("sheet dimensions must be exact multiples of frame size")
    cols, rows = sheet.width // w, sheet.height // h
    if count > cols * rows or count > 2048:
        raise ValueError("frame count exceeds sheet capacity")
    sheet = sheet.convert("RGBA")
    frames = [sheet.crop(((i % cols)*w, (i // cols)*h,
                           (i % cols+1)*w, (i // cols+1)*h)) for i in range(count)]
    if not any(im.getchannel("A").getextrema()[1] for im in frames):
        raise ValueError("animation is entirely transparent")
    if any(im.getchannel("A").getextrema()[0] > 0 for im in frames):
        raise ValueError("VFX cells require a transparent background")
    return frames


def pack_images(images: list[Image.Image], names: list[str], *, trim=False,
                max_width=1024):
    """Shelf atlas; Starling trim positions use negative fx/fy."""
    if not images or len(images) != len(names) or len(set(names)) != len(names):
        raise ValueError("one unique atlas name required per image")
    tiles = []
    for image, name in zip(images, names):
        box = image.getchannel("A").getbbox() if trim else (0, 0, *image.size)
        box = box or (0, 0, 1, 1)
        tile = image.crop(box)
        if tile.width > max_width:
            raise ValueError("atlas tile exceeds maximum width")
        tiles.append((name, image.size, box, tile))
    x = y = row_h = 0
    entries, positioned = [], []
    width = 1
    for name, size, box, tile in tiles:
        if x + tile.width > max_width:
            x, y, row_h = 0, y + row_h + 1, 0
        entry = dict(n=name, x=x, y=y, w=tile.width, h=tile.height)
        if trim:
            entry.update(fx=-box[0], fy=-box[1], fw=size[0], fh=size[1])
        entries.append(entry)
        positioned.append((tile, (x, y)))
        width = max(width, x + tile.width)
        x += tile.width + 1
        row_h = max(row_h, tile.height)
    sheet = Image.new("RGBA", (width, y + row_h))
    for tile, xy in positioned:
        sheet.paste(tile, xy)
    return sheet, entries


def build_parts(count, frame_size, logical_prefix, hold=3):
    if not 1 <= count <= 2048 or not 1 <= hold <= 65535 or count * hold > 65535:
        raise ValueError("invalid animation duration")
    if not re.fullmatch(r"[A-Za-z0-9_/-]+", logical_prefix) or ".." in logical_prefix:
        raise ValueError("invalid logical texture prefix")
    w, h = frame_size
    if min(w, h) <= 0:
        raise ValueError("invalid frame size")
    # Flatomo matrix values are 4096 fixed point; strip type 0 is image.
    # Each distinct image appears once, so imageMaxNumbers a[] is exactly 1.
    parts = {
        "i": [{"s": False, "p": f"{logical_prefix}{i+1:04d}"} for i in range(count)],
        "g": [{"t": count*hold, "s": [
            {"s": i*hold, "i": i, "l": [{"m": 255, "t": hold}]}
            for i in range(count)]}],
        "m": [], "a": [1]*count, "o": [],
        "t": [{"a": 4096, "b": 0, "c": 0, "d": 4096,
               "x": round(-w/2*4096), "y": round(-h/2*4096)}],
        "c": [], "s": 1,
    }
    timeline = {"sequences": [{"begin": 1, "end": count*hold,
                                "name": "neutral", "kind": "once"}],
                "sounds": [], "points": [], "circles": [], "rectangles": [], "matrices": []}
    return parts, timeline


def previews(images, output, *, hold=3, labels=None, name="preview"):
    """Opaque checkerboard previews only; game PNG alpha is unchanged."""
    w, h = images[0].size
    factor = min(4, max(1, 128 // max(w, h)))
    preview_frames = []
    for im in images:
        canvas = Image.new("RGB", (w, h), (23, 28, 39))
        canvas.paste(im, mask=im.getchannel("A"))
        preview_frames.append(canvas.resize((w*factor, h*factor), Image.Resampling.NEAREST))
    durations = [max(10, (round((i+1)*100*hold/60)-round(i*100*hold/60))*10)
                 for i in range(len(preview_frames))]
    preview_frames[0].save(output/f"{name}.gif", save_all=True,
                           append_images=preview_frames[1:], duration=durations,
                           loop=0, disposal=2)
    chosen = sorted(set(round(i*(len(images)-1)/min(15, len(images)-1))
                        for i in range(min(16, len(images))))) if len(images)>1 else [0]
    cell_w, cell_h = preview_frames[0].size
    cols = min(4, len(chosen))
    contact = Image.new("RGB", (cols*cell_w, math.ceil(len(chosen)/cols)*(cell_h+18)), (23,28,39))
    draw = ImageDraw.Draw(contact)
    for n, i in enumerate(chosen):
        x, y = (n % cols)*cell_w, (n // cols)*(cell_h+18)
        contact.paste(preview_frames[i], (x,y))
        draw.text((x+2,y+cell_h), str(labels[i] if labels else i+1), fill="white")
    contact.save(output/f"{name}_contact.png")


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def generate_family(source, count, frame_size, output, logical_prefix, hold=3):
    source, output = Path(source), check_output(Path(output), [Path(source)])
    frames = split_frames(read_image(source), count, frame_size)
    parts, timeline = build_parts(count, frame_size, logical_prefix, hold)
    names = [item["p"] for item in parts["i"]]
    sheet, atlas = pack_images(frames, names)
    result = dict(source_sha256=file_hash(source), frames=count, frame_size=list(frame_size),
                  hold=hold, total_frames=count*hold, fps=60,
                  timing_source="assembly choice; not API source timing", logical_prefix=logical_prefix)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".vfx-", dir=output.parent) as tmp:
        target = Path(tmp)/"result"
        target.mkdir()
        sheet.save(target/"sprite_sheet.png")
        for filename, tree in [("sprite_sheet.atlas",atlas), ("effect.parts",parts),
                               ("effect.timeline",timeline)]:
            write_tree(target/f"{filename}.amf3.deflate", tree)
            (target/f"{filename}.json").write_text(json.dumps(tree,ensure_ascii=False,indent=2),encoding="utf-8")
        previews(frames,target,hold=hold)
        (target/"assembly.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
        target.rename(output)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vfx-sheet", required=True, type=Path)
    parser.add_argument("--frames", required=True, type=int)
    parser.add_argument("--frame-size", required=True, type=int, nargs=2, metavar=("W","H"))
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--logical-prefix", required=True)
    parser.add_argument("--hold", type=int, default=3)
    args = parser.parse_args()
    print(json.dumps(generate_family(args.vfx_sheet,args.frames,tuple(args.frame_size),
                                    args.output,args.logical_prefix,args.hold),ensure_ascii=False))


if __name__ == "__main__":
    main()
