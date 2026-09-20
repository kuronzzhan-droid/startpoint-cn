# -*- coding: utf-8 -*-
"""白底立绘抠图：**只删与画面边缘连通的纯白背景**，其余一律保留。

作者 2026-09-21 口径：「扣立绘只扣掉背景的白色，不要导致角色本体被扣掉，场景也要保留」。
第一轮的做法（清理小孤岛、AI 前景仲裁删块、贴边场景羽化、整圈反混白带）会把特效、花瓣、
星星、影子、物件边缘这些**非白色内容**删掉或吃成半透明——本工具把这些做法全部拿掉：

1. 背景 = 与画面四边连通（4 邻接）的纯白像素（与白的距离 ≤ ``core_tol``）。
2. 被本体围住的封闭白块**默认保留**；只有配置里给了种子坐标 ``remove_seeds`` 的才并入背景
   （由人或看图代理逐块判定；``--rembg`` 只给出参考前景概率，不自动删任何东西）。
3. 抗锯齿：只处理紧贴背景的 ``aa_radius`` 像素窄带——按「像素 = α·前景色 + (1-α)·白」反解 α，
   前景色取带内侧最近的实心像素；前景本身接近白色时不反解（保持不透明）。带以外的像素
   颜色与不透明度**原样不动**。
4. 柔光特效（颜色→白的长渐变）默认不处理；确需处理时在配置里圈 ``soft_regions`` 多边形，
   只在圈内对近白像素做颜色转 alpha。
5. 小孤岛（花瓣、星星、碎屑）不清理；非白内容没有任何删除路径。

    python mod-tools/wf_portrait_white_matte.py --source 原画.png --out 母图.png \
        [--config cfg.json] [--report-dir 目录] [--rembg]
    python mod-tools/wf_portrait_white_matte.py --audit --source 原画.png --master 现有母图.png \
        [--report-dir 目录]

配置 JSON：{"core_tol": 4, "aa_radius": 2, "remove_seeds": [[x, y], ...],
           "soft_regions": [{"polygon": [[x, y], ...], "ref": 96}]}
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

FOUR = ndimage.generate_binary_structure(2, 1)
EIGHT = ndimage.generate_binary_structure(2, 2)
SOLID_DIST = 40          # 与白的距离 ≥ 40 视为「明确不是白色」的内容（审计用）
POCKET_MIN_PX = 200      # 小于此面积的封闭白点不列入待判清单（高光、牙齿、眼神光）


class MatteError(ValueError):
    pass


def load_rgb(path: Path) -> np.ndarray:
    """读原画；自带透明通道的先合成到白底（白底稿偶尔会带一个全不透明的 alpha）。"""
    image = Image.open(path)
    if image.mode in ("RGBA", "LA", "P"):
        rgba = image.convert("RGBA")
        white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        image = Image.alpha_composite(white, rgba)
    return np.asarray(image.convert("RGB")).astype(np.int32)


def white_distance(rgb: np.ndarray) -> np.ndarray:
    return (255 - rgb).max(axis=2)


def label_white(rgb: np.ndarray, core_tol: int):
    labels, _count = ndimage.label(white_distance(rgb) <= core_tol, structure=FOUR)
    border = np.unique(np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1])))
    return labels, border[border != 0]


def background_mask(rgb: np.ndarray, *, core_tol: int = 4, remove_seeds=()) -> tuple[np.ndarray, list[dict]]:
    """返回 (背景掩码, 封闭白块清单)。种子必须落在白块上，否则报错（防止坐标写错删错东西）。"""
    labels, border = label_white(rgb, core_tol)
    background = np.isin(labels, border)
    removed = set()
    for x, y in remove_seeds:
        label = int(labels[int(y), int(x)])
        if label == 0:
            raise MatteError(f"remove_seed ({x},{y}) is not on a white pixel")
        if label not in border:
            removed.add(label)
    if removed:
        background |= np.isin(labels, list(removed))
    sizes = np.bincount(labels.ravel())
    pockets = []
    for label in np.flatnonzero(sizes >= POCKET_MIN_PX):
        if label == 0 or label in border:
            continue
        ys, xs = np.nonzero(labels == label)
        pockets.append({"label": int(label), "px": int(sizes[label]),
                        "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
                        "seed": [int(xs[len(xs) // 2]), int(ys[len(ys) // 2])],
                        "removed": int(label) in removed})
    pockets.sort(key=lambda item: -item["px"])
    return background, pockets


def matte(rgb: np.ndarray, *, core_tol: int = 4, aa_radius: int = 2, remove_seeds=(), soft_regions=()):
    """返回 (RGBA uint8, 背景掩码, 封闭白块清单)。"""
    background, pockets = background_mask(rgb, core_tol=core_tol, remove_seeds=remove_seeds)
    height, width = background.shape
    alpha = np.where(background, 0, 255).astype(np.float64)
    color = rgb.astype(np.float64).copy()

    if aa_radius > 0 and background.any():
        near = ndimage.binary_dilation(background, structure=EIGHT, iterations=aa_radius)
        band = near & ~background
        interior = ~ndimage.binary_dilation(background, structure=EIGHT, iterations=aa_radius + 1)
        if interior.any() and band.any():
            _dist, (iy, ix) = ndimage.distance_transform_edt(~interior, return_indices=True)
            fore = rgb[iy[band], ix[band]].astype(np.float64)          # 带内侧最近的实心像素颜色
            pix = rgb[band].astype(np.float64)
            span = 255.0 - fore                                        # 前景离白有多远
            channel = span.argmax(axis=1)
            rows = np.arange(len(pix))
            best = span[rows, channel]
            solved = (255.0 - pix[rows, channel]) / np.maximum(best, 1.0)
            solved = np.clip(solved, 0.0, 1.0)
            solved[best < 24] = 1.0                                    # 前景本身近白：不反解，保持不透明
            solved[solved > 0.92] = 1.0
            band_alpha = solved * 255.0
            alpha[band] = band_alpha
            mixed = band_alpha < 255
            band_color = color[band]
            band_color[mixed] = fore[mixed]                            # 半透明边缘用纯前景色，去白边
            color[band] = band_color

    for region in soft_regions:
        polygon = [tuple(map(float, point)) for point in region["polygon"]]
        ref = float(region.get("ref", 96))
        mask = Image.new("L", (width, height), 0)
        ImageDraw.Draw(mask).polygon(polygon, fill=255)
        inside = (np.asarray(mask) > 0) & ~background
        dist = white_distance(rgb).astype(np.float64)
        soft = inside & (dist < ref)
        a = np.clip(dist[soft] / ref, 0.0, 1.0)
        alpha[soft] = np.minimum(alpha[soft], a * 255.0)
        safe = np.maximum(a, 1e-3)[:, None]
        color[soft] = np.clip((rgb[soft] - (1.0 - safe) * 255.0) / safe, 0, 255)

    # 背景像素的 RGB 填成最近的非背景颜色：后续缩放/滤波时不会把白色渗进边缘
    if background.any() and (~background).any():
        _dist, (iy, ix) = ndimage.distance_transform_edt(background, return_indices=True)
        color[background] = color[iy[background], ix[background]]

    rgba = np.dstack([np.clip(np.rint(color), 0, 255), np.clip(np.rint(alpha), 0, 255)]).astype(np.uint8)
    return rgba, background, pockets


def audit(rgb: np.ndarray, alpha: np.ndarray, *, core_tol: int = 4, aa_radius: int = 2) -> dict:
    """母图对原画的审计：非白内容被吃掉多少、连边白底残留多少。AA 窄带内的半透明不算被吃。"""
    labels, border = label_white(rgb, core_tol)
    connected = np.isin(labels, border)
    dist = white_distance(rgb)
    away = ndimage.distance_transform_edt(~connected) > (aa_radius + 1.5)
    solid = dist >= SOLID_DIST
    eaten = solid & away & (alpha < 250)
    eaten_hard = solid & away & (alpha < 128)
    leftover = connected & (alpha > 32)
    blob_labels, _count = ndimage.label(eaten, structure=EIGHT)
    blob_sizes = np.bincount(blob_labels.ravel())
    blobs = []
    for label in np.argsort(-blob_sizes)[:12]:
        if label == 0 or blob_sizes[label] < 30:
            continue
        ys, xs = np.nonzero(blob_labels == label)
        blobs.append({"px": int(blob_sizes[label]),
                      "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]})
    return {"solid_px": int(solid.sum()), "eaten_px": int(eaten.sum()), "eaten_hard_px": int(eaten_hard.sum()),
            "eaten_pct_of_solid": round(100.0 * float(eaten.sum()) / max(1, int(solid.sum())), 4),
            "leftover_bg_px": int(leftover.sum()), "eaten_blobs": blobs,
            "_eaten_mask": eaten, "_leftover_mask": leftover}


def rembg_probability(path: Path):
    """参考用的 AI 前景概率（GPU）。失败返回 None；**不参与任何删除决定**。"""
    try:
        import os
        import site
        for base in site.getsitepackages() + [site.getusersitepackages()]:
            nvidia = Path(base) / "nvidia"
            if nvidia.is_dir():
                for dll_dir in {p.parent for p in nvidia.rglob("*.dll")}:
                    os.add_dll_directory(str(dll_dir))
        from rembg import new_session, remove
        session = new_session("isnet-general-use")
        mask = remove(Image.open(path).convert("RGB"), session=session, only_mask=True)
        return np.asarray(mask.convert("L")).astype(np.float64) / 255.0
    except Exception as exc:  # noqa: BLE001 - 参考信息，失败不影响抠图
        print(f"[rembg advisory unavailable] {type(exc).__name__}: {exc}", file=sys.stderr)
        return None


def _composite(rgba: np.ndarray, background: tuple[int, int, int]) -> Image.Image:
    base = Image.new("RGBA", (rgba.shape[1], rgba.shape[0]), background + (255,))
    return Image.alpha_composite(base, Image.fromarray(rgba, "RGBA")).convert("RGB")


def write_previews(report_dir: Path, stem: str, rgb: np.ndarray, rgba: np.ndarray, result: dict, pockets) -> list[str]:
    report_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for tag, tone in (("light", (242, 238, 230)), ("dark", (32, 32, 48))):
        image = _composite(rgba, tone)
        image.thumbnail((1100, 1100))
        path = report_dir / f"{stem}_{tag}.jpg"
        image.save(path, quality=92)
        written.append(str(path))
    heat = rgb.astype(np.uint8).copy()
    heat[result["_eaten_mask"]] = (255, 0, 0)
    heat[result["_leftover_mask"]] = (0, 0, 255)
    image = Image.fromarray(heat)
    draw = ImageDraw.Draw(image)
    for n, pocket in enumerate(pockets):
        x0, y0, x1, y1 = pocket["bbox"]
        draw.rectangle((x0 - 3, y0 - 3, x1 + 3, y1 + 3), outline=(0, 160, 0) if not pocket["removed"] else (255, 0, 255), width=3)
        draw.text((x0, max(0, y0 - 14)), f"#{n}", fill=(0, 120, 0))
    image.thumbnail((1400, 1400))
    path = report_dir / f"{stem}_heat_pockets.jpg"
    image.save(path, quality=90)
    written.append(str(path))
    return written


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--out", type=Path, help="输出母图 PNG（RGBA）")
    parser.add_argument("--config", type=Path)
    parser.add_argument("--report-dir", type=Path)
    parser.add_argument("--audit", action="store_true", help="只审计现有母图，不写母图")
    parser.add_argument("--master", type=Path, help="--audit 时要审计的现有母图")
    parser.add_argument("--rembg", action="store_true", help="给封闭白块附上 AI 前景概率（仅供参考）")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    config = json.loads(args.config.read_text(encoding="utf-8")) if args.config else {}
    core_tol = int(config.get("core_tol", 4))
    aa_radius = int(config.get("aa_radius", 2))
    rgb = load_rgb(args.source)
    stem = (args.master or args.out or args.source).stem

    if args.audit:
        if not args.master:
            raise SystemExit("--audit needs --master")
        master = np.asarray(Image.open(args.master).convert("RGBA"))
        if master.shape[:2] != rgb.shape[:2]:
            raise SystemExit(f"size differs: master {master.shape[:2]} vs source {rgb.shape[:2]}")
        rgba = master
        _bg, pockets = background_mask(rgb, core_tol=core_tol)
        for pocket in pockets:
            x0, y0, x1, y1 = pocket["bbox"]
            pocket["master_alpha_mean"] = round(float(master[y0:y1 + 1, x0:x1 + 1, 3].mean()), 1)
    else:
        if not args.out:
            raise SystemExit("--out is required unless --audit")
        rgba, _bg, pockets = matte(rgb, core_tol=core_tol, aa_radius=aa_radius,
                                   remove_seeds=config.get("remove_seeds", ()),
                                   soft_regions=config.get("soft_regions", ()))

    if args.rembg and pockets:
        probability = rembg_probability(args.source)
        if probability is not None:
            for pocket in pockets:
                x0, y0, x1, y1 = pocket["bbox"]
                pocket["rembg_foreground_mean"] = round(float(probability[y0:y1 + 1, x0:x1 + 1].mean()), 3)

    result = audit(rgb, rgba[:, :, 3].astype(np.int32), core_tol=core_tol, aa_radius=aa_radius)
    previews = write_previews(args.report_dir, stem, rgb, rgba, result, pockets) if args.report_dir else []
    report = {k: v for k, v in result.items() if not k.startswith("_")}
    report.update({"source": str(args.source), "source_sha256": sha256(args.source), "size": [int(rgb.shape[1]), int(rgb.shape[0])],
                   "config": {"core_tol": core_tol, "aa_radius": aa_radius,
                              "remove_seeds": config.get("remove_seeds", []),
                              "soft_regions": len(config.get("soft_regions", []))},
                   "white_pockets": pockets, "previews": previews})
    if not args.audit:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(rgba, "RGBA").save(args.out)
        report["out"] = str(args.out)
        report["out_sha256"] = sha256(args.out)
    if args.report_dir:
        (args.report_dir / f"{stem}_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("size", "solid_px", "eaten_px", "eaten_hard_px", "leftover_bg_px")}
                     | {"pockets": len(pockets), "out": report.get("out")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
