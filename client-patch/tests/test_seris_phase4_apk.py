from __future__ import annotations

import hashlib
import importlib.util
import json
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PHASE4 = ROOT / "work" / "seris_v2" / "phase4_client"
ASSEMBLER = PHASE4 / "assemble_phase4_apk.py"
APK = PHASE4 / "apk" / "WorldFlipper-seris-v2-phase4.apk"
REPORT = PHASE4 / "apk" / "build-report.json"
SWF_MEMBER = "assets/worldflipper_android_release.swf"


def load_module():
    spec = importlib.util.spec_from_file_location("seris_phase4_apk", ASSEMBLER)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load {ASSEMBLER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestSerisPhase4Apk(unittest.TestCase):
    def test_apksigner_parser_requires_same_cert_and_v1_v2_v3(self) -> None:
        module = load_module()
        sample = "\n".join(
            (
                "Verified using v1 scheme (JAR signing): true",
                "Verified using v2 scheme (APK Signature Scheme v2): true",
                "Verified using v3 scheme (APK Signature Scheme v3): true",
                "Verified using v4 scheme (APK Signature Scheme v4): false",
                "Signer #1 certificate SHA-256 digest: " + "ab" * 32,
            )
        )
        parsed = module.parse_apksigner_verify(sample)
        self.assertEqual("ab" * 32, parsed["certificate_sha256"])
        self.assertEqual({"v1": True, "v2": True, "v3": True}, parsed["schemes"])
        with self.assertRaises(module.AssemblyError):
            module.parse_apksigner_verify(sample.replace("v2 scheme (APK Signature Scheme v2): true", "v2 scheme (APK Signature Scheme v2): false"))

    def test_signed_apk_report_is_hash_locked_and_embeds_final_swf(self) -> None:
        self.assertTrue(APK.is_file(), "Phase 4 signed APK is missing")
        self.assertTrue(REPORT.is_file(), "Phase 4 APK build report is missing")
        report = json.loads(REPORT.read_text(encoding="utf-8"))
        self.assertEqual("offline_signed_apk_ready_for_phase5", report["state"])
        self.assertEqual(hashlib.sha256(APK.read_bytes()).hexdigest(), report["apk"]["sha256"])
        with zipfile.ZipFile(APK, "r") as archive:
            embedded = archive.read(SWF_MEMBER)
        self.assertEqual(hashlib.sha256(embedded).hexdigest(), report["embedded_swf_sha256"])
        self.assertEqual(report["base_signature"]["certificate_sha256"], report["output_signature"]["certificate_sha256"])
        self.assertEqual({"v1": True, "v2": True, "v3": True}, report["output_signature"]["schemes"])
        self.assertTrue(report["android_manifest_byte_exact"])
        self.assertFalse(report["publish"])
        self.assertFalse(report["installed"])


if __name__ == "__main__":
    unittest.main()
