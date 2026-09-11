"""装载星风快门专属图标，并编码为客户端存储态 PNG。"""
from io import BytesIO
from pathlib import Path

from PIL import Image

from wf_assets import png_encode

ICON_PATH = Path(__file__).resolve().parent / "assets/celtie-fever-icons/starwind-shutter.png"


def stock_icon_bytes():
    raw = ICON_PATH.read_bytes()
    with Image.open(BytesIO(raw)) as icon:
        if icon.size != (48, 48) or icon.mode != "RGBA":
            raise ValueError("starwind shutter requires a 48x48 RGBA icon")
        if icon.getextrema()[3] != (0, 255):
            raise ValueError("starwind shutter requires visible content and transparency")
    return png_encode(raw)
