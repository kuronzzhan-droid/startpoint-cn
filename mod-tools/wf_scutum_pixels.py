"""把作者单帧像素裁回原始网格，使用原生序列名与稳定角色中心。"""
import io
import zlib

import numpy as np
from PIL import Image

import wf_assets
import wf_dsl
from wf_campus_art_images import png, sha
from wf_character_revision import encode_tree
from wf_scutum_seed import CODE


def build(seed, source_dir, output):
    path = source_dir / "c23cd12e08fcaebc43c14b9ebb153e69.png"
    raw = path.read_bytes()
    source = Image.open(io.BytesIO(raw)).convert("RGBA")
    if source.size != (260, 300):
        raise ValueError("unreviewed source pixel grid")
    sprite = source.resize((26, 30), Image.Resampling.NEAREST)
    if not np.array_equal(np.asarray(source), np.asarray(sprite.resize(source.size, Image.Resampling.NEAREST))):
        raise ValueError("source is not a lossless 10x pixel grid")
    output.mkdir(parents=True, exist_ok=True)
    sprite.resize((260, 300), Image.Resampling.NEAREST).save(output / "pixel-preview.png")
    counts = {}
    for stem, animation in (("sprite_sheet", "pixelart"), ("special_sprite_sheet", "special")):
        prefix = f"character/{CODE}/pixelart/"
        atlas_path = prefix + stem + ".atlas.amf3.deflate"
        atlas = wf_dsl.parse_dsl(zlib.decompress(seed.outputs["common", atlas_path], -15))["tree"]
        # 所有角色姿势引用同一作者图；取消母本蓄力动作，避免角色变形或闪烁。
        for item in atlas:
            name = item["n"]
            item.clear()
            item.update(n=name, x=0, y=0, w=26, h=30, fx=-115, fy=-113, fw=256, fh=256)
        sheet = Image.new("RGBA", (32, 32))
        sheet.alpha_composite(sprite)
        seed.emit("common", atlas_path, encode_tree(atlas))
        seed.emit("common", prefix + stem + ".png", wf_assets.png_encode(png(sheet)))
        frame_path = prefix + animation + ".frame.amf3.deflate"
        frame = wf_dsl.parse_dsl(zlib.decompress(seed.outputs["common", frame_path], -15))["tree"]
        frame["scale"] = 3
        seed.emit("common", frame_path, encode_tree(frame))
        counts[animation] = len(atlas)
    return dict(source=str(path), sha256=sha(raw), native_pixels=[26, 30],
                lossless_grid=True, display_scale=3, stable_single_pose=True, frame_references=counts)
