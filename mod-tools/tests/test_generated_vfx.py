"""Generated art must keep cell geometry, transparency and valid flatomo pools."""
import importlib
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    vfx = importlib.import_module("wf_generated_vfx")
except ModuleNotFoundError:
    vfx = None


class GeneratedVfxTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(vfx, "generated VFX implementation is missing")

    def test_split_row_major_and_reject_bad_grid(self):
        sheet = Image.new("RGBA", (8, 4))
        sheet.putpixel((1, 1), (255, 0, 0, 255))
        sheet.putpixel((5, 1), (0, 255, 0, 255))
        frames = vfx.split_frames(sheet, 2, (4, 4))
        self.assertEqual(frames[1].getpixel((1, 1)), (0, 255, 0, 255))
        for count, size in [(3, (4, 4)), (2, (3, 4)), (0, (4, 4))]:
            with self.assertRaises(ValueError):
                vfx.split_frames(sheet, count, size)

    def test_reject_opaque_background_and_blank_animation(self):
        for image in [Image.new("RGBA", (4, 4), "red"),
                      Image.new("RGBA", (4, 4))]:
            with self.assertRaises(ValueError):
                vfx.split_frames(image, 1, (4, 4))

    def test_family_has_exact_spans_single_image_pools_and_center(self):
        images = [Image.new("RGBA", (8, 6)) for _ in range(3)]
        images[0].putpixel((2, 1), (255, 0, 0, 255))
        parts, timeline = vfx.build_parts(3, (8, 6), "effect/demo", hold=4)
        self.assertEqual(parts["a"], [1, 1, 1])
        self.assertEqual(parts["g"][0]["t"], 12)
        self.assertEqual([s["s"] for s in parts["g"][0]["s"]], [0, 4, 8])
        self.assertEqual([s["l"][0]["t"] for s in parts["g"][0]["s"]], [4]*3)
        self.assertEqual(parts["t"][0]["x"], -4 * 4096)
        self.assertEqual(parts["t"][0]["y"], -3 * 4096)
        self.assertEqual(timeline["sequences"][0]["end"], 12)
        self.assertEqual(timeline["sequences"][0]["kind"], "once")

    def test_family_write_readback_and_existing_output_refused(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            sheet = Image.new("RGBA", (8, 4))
            sheet.putpixel((1, 1), (255, 0, 0, 255))
            sheet.putpixel((5, 1), (0, 255, 0, 255))
            source = root / "input.png"
            sheet.save(source)
            result = vfx.generate_family(source, 2, (4, 4), root / "out", "effect/demo", 3)
            self.assertEqual(result["frames"], 2)
            self.assertEqual(vfx.read_tree(root/"out/effect.parts.amf3.deflate")["a"], [1,1])
            self.assertTrue((root/"out/preview.gif").is_file())
            with self.assertRaises(FileExistsError):
                vfx.generate_family(source, 2, (4, 4), root / "out", "effect/demo", 3)

    def test_output_protects_sources_and_live_named_directories(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for output, sources in [(root/"upload/new", []), (root, [root/"in.png"]),
                                    (root/"source/new", [root/"source"])]:
                with self.assertRaises(ValueError):
                    vfx.check_output(output, sources)

    def test_gif_duration_tracks_sixty_hz_instead_of_forcing_twenty_ms(self):
        with tempfile.TemporaryDirectory() as td:
            images = [Image.new("RGBA", (4,4), color) for color in ("red","green","blue")]
            vfx.previews(images,Path(td),hold=1)
            with Image.open(Path(td)/"preview.gif") as gif:
                duration = 0
                for i in range(gif.n_frames):
                    gif.seek(i)
                    duration += gif.info["duration"]
                self.assertEqual(duration,50)


if __name__ == "__main__":
    unittest.main()
