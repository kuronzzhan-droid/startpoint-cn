"""Frozen-site packaging is append-only except four reviewed UI entry files."""
from __future__ import annotations

import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_wiki_battle as package
import test_wiki_battle_content as fixtures


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.ContentTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        f = self.fixture
        self.site, self.defs, self.root = f.site, f.defs, f.root
        self.ui = self.root / "ui"
        self.ui.mkdir()
        self.output = self.root / "candidate"
        self.evidence = self.root / "battle-media-evidence.json"
        # Real content-addressed fixture paths exercise the packaging hash gate.
        for old in ("sprite.webp", "voice.mp3"):
            path = self.site / "media" / old
            new = digest(path.read_bytes()) + path.suffix
            path.rename(path.with_name(new))
            f.media = json.loads(json.dumps(f.media).replace("media/" + old, "media/" + new))
        coffin = b"new-native-coffin"
        url = "media/battle/" + digest(coffin) + ".webp"
        f.media["coffin"] = {**copy.deepcopy(f.media["coffin"]), "url": url}
        dest = self.root / "battle-native-media" / url
        dest.parent.mkdir(parents=True)
        dest.write_bytes(coffin)
        f.write()
        self.write_evidence()
        self.base_html = '<html><head><link rel="stylesheet" href="styles.css?v=old"><script src="data.js" defer></script><script src="pages.js" defer></script><script src="dungeons.js" defer></script><script src="router.js" defer></script></head><body>Wiki</body></html>'
        (self.site / "index.html").write_text(self.base_html, encoding="utf-8")
        for name in ("styles.css", "pages.js", "dungeons.js", "router.js", "_worker.js", "_headers", "_routes.json"):
            (self.site / name).write_text("/* frozen " + name + " */", encoding="utf-8")
        for name in package.UI_REPLACEMENTS - {"index.html"}:
            (self.ui / name).write_text("/* reviewed " + name + " */", encoding="utf-8")
        (self.ui / "index.html").write_text(self.base_html.replace('<script src="router.js"', '<script src="battle-loader.js" data-battle-version="dev" defer></script><script src="router.js"'), encoding="utf-8")
        for name in package.BATTLE_ASSETS:
            (self.ui / name).write_text("/* " + name + " */", encoding="utf-8")
        self.pin = self.add_patch("FROZEN_MANIFEST_SHA256", "")
        self.add_patch("UI_ROOT", self.ui)
        self.add_patch("REPO", self.root / "repo")
        self.add_patch("_head", return_value="a" * 40)
        self.add_patch("_committed", side_effect=lambda paths: {p: p.read_bytes() for p in paths})
        self.pin_manifest()

    def add_patch(self, name, value=mock.DEFAULT, **kwargs):
        patcher = mock.patch.object(package, name, value, **kwargs)
        value = patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def write_evidence(self):
        self.evidence.write_text(json.dumps(self.fixture.media), encoding="utf-8")

    def inventory(self, path):
        return {p.relative_to(path).as_posix(): p.read_bytes() for p in path.rglob("*") if p.is_file()}

    def pin_manifest(self):
        files = [{"path": name, "bytes": len(raw), "sha256": digest(raw)} for name, raw in sorted(self.inventory(self.site).items())]
        path = self.site.with_name(self.site.name + "-sha256.json")
        path.write_text(json.dumps({"sourceCommit": "a" * 40, "files": files}), encoding="utf-8")
        package.FROZEN_MANIFEST_SHA256 = digest(path.read_bytes())

    def build(self, **kwargs):
        return package.build_candidate(self.site, self.output, self.defs, self.evidence, **kwargs)

    def test_copy_preserves_old_payload_and_worker_independently(self):
        before = self.inventory(self.site)
        receipt = self.build()
        result = self.inventory(self.output)
        self.assertEqual(self.inventory(self.site), before)
        for name, raw in before.items():
            if name not in package.UI_REPLACEMENTS:
                self.assertEqual(result[name], raw, name)
        self.assertEqual(len(result) - len(before), 15)
        self.assertEqual(receipt["characters"], 6)
        self.assertTrue(receipt["oldPayloadUnchanged"])
        self.assertEqual(receipt["addedMedia"], [self.fixture.media["coffin"]["url"]])
        (self.output / "_worker.js").write_bytes(b"candidate edit")
        self.assertEqual((self.site / "_worker.js").read_bytes(), before["_worker.js"])
        self.assertNotIn("audit", (self.output / "data/battle-content.js").read_text(encoding="utf-8"))
        self.assertTrue(self.output.with_name("candidate-receipt.json").is_file())

    def test_lazy_assets_do_not_become_eager_and_version_is_deterministic(self):
        first = self.build(check_only=True)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.output.with_name("candidate-receipt.json").exists())
        second = self.build()
        self.assertEqual(first["version"], second["version"])
        html = (self.output / "index.html").read_text(encoding="utf-8")
        self.assertIn('data-battle-version="' + first["version"] + '"', html)
        self.assertIn("battle-loader.js?v=" + first["version"], html)
        self.assertNotIn("battle.css", html)
        for name in package.BATTLE_ASSETS - {"battle-loader.js", "battle.css"}:
            self.assertNotIn(name, html)
        self.output = self.root / "second"
        self.fixture.rows["fire"][0]["skill"]["description"] = "新的技能说明"
        self.fixture.write()
        self.assertNotEqual(first["version"], self.build(check_only=True)["version"])

    def test_output_overlap_existing_or_repository_is_rejected(self):
        for target in (self.site, self.site / "nested", self.root, package.REPO / "inside"):
            with self.subTest(target=target), self.assertRaises(ValueError):
                package.build_candidate(self.site, target, self.defs, self.evidence)

    def test_unknown_manifest_or_changed_frozen_bytes_fail_without_output(self):
        package.FROZEN_MANIFEST_SHA256 = "0" * 64
        with self.assertRaisesRegex(ValueError, "清单"):
            self.build()
        self.pin_manifest()
        (self.site / "_worker.js").write_bytes(b"unexpected")
        with self.assertRaisesRegex(ValueError, "冻结"):
            self.build()
        self.assertFalse(self.output.exists())

    def test_uncommitted_source_is_rejected(self):
        originals = {p: p.read_bytes() for p in self.ui.iterdir()}
        (self.ui / "router.js").write_text("changed")
        with mock.patch.object(package, "_committed", side_effect=lambda paths: {p: originals.get(p, p.read_bytes()) for p in paths}):
            with self.assertRaisesRegex(ValueError, "提交"):
                self.build()

    def test_manifest_traversal_and_duplicate_paths_are_rejected(self):
        manifest = self.site.with_name("site-sha256.json")
        for name in ("../escape", "data.js"):
            self.pin_manifest()
            data = json.loads(manifest.read_text(encoding="utf-8"))
            data["files"].append({"path": name, "sha256": "0" * 64, "bytes": 0})
            manifest.write_text(json.dumps(data))
            package.FROZEN_MANIFEST_SHA256 = digest(manifest.read_bytes())
            with self.assertRaises(ValueError):
                self.build()

    def test_missing_old_media_or_extra_source_file_is_rejected(self):
        next((self.site / "media").iterdir()).unlink()
        with self.assertRaises(ValueError):
            self.build()
        self.pin_manifest()
        (self.site / "private.db").write_bytes(b"bad")
        with self.assertRaises(ValueError):
            self.build()
        self.assertFalse(self.output.exists())

    def test_missing_reference_or_unsafe_media_or_private_field_is_rejected(self):
        original = copy.deepcopy(self.fixture.media)
        for field, value in (("avatar", "media/missing.webp"), ("avatar", "https://example.org/a.webp"), ("privatePath", "hidden")):
            self.fixture.media = copy.deepcopy(original)
            self.fixture.media["media"][fixtures.IDS[0]][field] = value
            self.write_evidence()
            with self.assertRaises(ValueError):
                self.build()
        self.assertFalse(self.output.exists())

    def test_missing_character_definition_is_rejected(self):
        self.fixture.rows["fire"] = []
        self.fixture.write()
        with self.assertRaises(ValueError):
            self.build()

    def test_new_media_hash_drift_is_rejected(self):
        path = self.root / "battle-native-media" / self.fixture.media["coffin"]["url"]
        path.write_bytes(b"changed native output")
        with self.assertRaisesRegex(ValueError, "媒体"):
            self.build()

    def test_total_file_gate_and_new_file_budget_fail_before_creation(self):
        for name, limit in (("MAX_STATIC_FILES", 1), ("MAX_ADDED_FILES", 14)):
            with mock.patch.object(package, name, limit), self.assertRaises(ValueError):
                self.build()
        self.assertFalse(self.output.exists())

    def test_private_code_literal_or_unexpected_eager_module_is_rejected(self):
        (self.ui / "battle-page.js").write_text('const password = "unsafe-fixture";')
        with self.assertRaisesRegex(ValueError, "公开"):
            self.build()
        (self.ui / "battle-page.js").write_text("/* safe */")
        path = self.ui / "index.html"
        path.write_text(path.read_text(encoding="utf-8").replace("battle-loader.js", "battle-page.js"))
        with self.assertRaisesRegex(ValueError, "首页"):
            self.build()

    def test_reparse_path_is_rejected_before_read_or_write(self):
        with mock.patch.object(package, "is_junction", side_effect=lambda p: Path(p) == self.site):
            with self.assertRaisesRegex(ValueError, "链接"):
                self.build()

    def test_definition_mutation_during_compile_is_not_adopted_as_new_input(self):
        compile_content = package.build_content

        def changing(*args):
            result = compile_content(*args)
            path = self.defs / "stages.json"
            path.write_text(path.read_text(encoding="utf-8") + "\n")
            return result

        with mock.patch.object(package, "build_content", side_effect=changing):
            with self.assertRaisesRegex(ValueError, "输入.*变化"):
                self.build()
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
