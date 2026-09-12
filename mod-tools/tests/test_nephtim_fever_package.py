"""候选资产加载的真实 bundle 回退与来源证据合同。"""
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from wf_mod_tool import sha1_path
from wf_nephtim_fever_package import Candidate
import wf_nephtim_fever as assemble


class Baseline:
    def __init__(self, values):
        self.values = values

    def get(self, tier, path):
        return self.values.get((tier, path))


def hashed(path):
    value = sha1_path(path)
    return value[:2] + "/" + value[2:]


class NephtimPackageTests(unittest.TestCase):
    def test_cdn_priority_bundle_fallback_and_source_hashes(self):
        present, bundled = "battle/present.png", "battle/bundled.png"
        candidate = Candidate.__new__(Candidate)
        candidate.baseline = Baseline({("common", hashed(present)): b"cdn-newest"})
        candidate.sources = {}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bundle.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr(hashed(present), b"bundle-older")
                archive.writestr(hashed(bundled), b"bundle-only")
            load = candidate.native_assets(path)
            self.assertEqual(load(present), b"cdn-newest")
            self.assertEqual(load(bundled), b"bundle-only")
            self.assertEqual(candidate.sources, {
                ("common", present): hashlib.sha256(b"cdn-newest").hexdigest(),
                ("common", bundled): hashlib.sha256(b"bundle-only").hexdigest(),
            })
            with self.assertRaisesRegex(ValueError, "missing or ambiguous"):
                load("missing.png")
            self.assertNotIn(("common", "missing.png"), candidate.sources)

    def test_unapproved_policy_fails_before_workspace_or_live_access(self):
        with self.assertRaisesRegex(ValueError, "常驻"):
            assemble.assemble(Path("nonexistent"), Path("nonexistent"),
                              piercing_extension="self_source", apply=True)


if __name__ == "__main__":
    unittest.main()
