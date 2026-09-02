from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PHASE4_ROOT = ROOT / "work" / "seris_v2" / "phase4_client"
DISCOVERY = PHASE4_ROOT / "discovery_render_scale_single_site"
DISCOVERY_MANIFEST = PHASE4_ROOT / "patch-manifest-phase4.discovery.json"
FINAL_BASELINE = PHASE4_ROOT / "baseline.json"
FINAL_MANIFEST = PHASE4_ROOT / "patch-manifest-phase4.json"
PATCH_MODULE = PHASE4_ROOT / "phase4_pcode.py"
DISCOVERY_BUILD = PHASE4_ROOT / "discovery_build_r3"
FINAL_BUILD = PHASE4_ROOT / "final_build"

REQUIRED_CAPABILITIES = (
    "DataDrivenFrameScale",
    "FormAwareDragonUI",
    "FormAwarePowerFlip",
    "FormAwareSkill",
    "MatchedCutin",
    "MatchedVoice",
    "ModDualForm",
    "SpecialPixelSlot",
)

PATCH_SITE_KEYS = {
    "site_id",
    "method_name",
    "class_name",
    "trait_name",
    "pcode_path",
    "body_index",
    "method_info_index",
    "baseline_abc_code_sha256",
    "input_pcode_canonical_sha256",
    "output_pcode_canonical_sha256",
    "patch_id",
    "expected_anchor_count",
    "required_maxstack",
    "required_localcount",
    "provides",
}


def load_module():
    spec = importlib.util.spec_from_file_location("seris_phase4_pcode", PATCH_MODULE)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load {PATCH_MODULE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestSerisPhase4Baseline(unittest.TestCase):
    def test_discovery_baseline_is_hash_locked_and_explicitly_nonfinal(self) -> None:
        report = json.loads((DISCOVERY / "baseline.json").read_text(encoding="utf-8"))
        swf = DISCOVERY / "baseline.swf"
        self.assertEqual("discovery_only", report["state"])
        self.assertTrue(swf.is_file())
        self.assertEqual(
            report["embedded_swf_sha256"], hashlib.sha256(swf.read_bytes()).hexdigest()
        )
        self.assertFalse(report["publish"])
        self.assertFalse(report["installed"])

    def test_final_dualsite_baseline_is_present_ready_and_never_skipped(self) -> None:
        self.assertTrue(FINAL_BASELINE.is_file(), "final dual-site baseline handoff is missing")
        report = json.loads(FINAL_BASELINE.read_text(encoding="utf-8"))
        self.assertEqual("ready", report["state"])
        apk = ROOT / report["source_apk"]
        swf = PHASE4_ROOT / report["extracted_swf"]
        self.assertTrue(apk.is_file())
        self.assertTrue(swf.is_file())
        self.assertEqual(report["source_apk_sha256"], hashlib.sha256(apk.read_bytes()).hexdigest())
        self.assertEqual(report["embedded_swf_sha256"], hashlib.sha256(swf.read_bytes()).hexdigest())
        self.assertEqual("assets/worldflipper_android_release.swf", report["embedded_swf_member"])


class TestSerisPhase4Manifest(unittest.TestCase):
    def _load_discovery(self) -> dict:
        self.assertTrue(DISCOVERY_MANIFEST.is_file(), "Phase 4 discovery manifest is missing")
        return json.loads(DISCOVERY_MANIFEST.read_text(encoding="utf-8"))

    def test_discovery_manifest_declares_staged_existing_class_injection(self) -> None:
        manifest = self._load_discovery()
        self.assertEqual(4, manifest["schema_version"])
        self.assertEqual("discovery_only", manifest["state"])
        self.assertEqual("pure_pcode_existing_classes", manifest["injection_strategy"])
        self.assertEqual(list(REQUIRED_CAPABILITIES), manifest["required_capabilities"])
        self.assertEqual(
            {
                "schema_version",
                "state",
                "injection_strategy",
                "baseline",
                "required_capabilities",
                "patch_sites",
                "native_sites",
                "data_contracts",
            },
            set(manifest),
        )
        serialized = json.dumps(manifest, ensure_ascii=False)
        for token in ("DualFormPresentationController", "DualFormViewController", "helper_class"):
            self.assertNotIn(token, serialized)

    def test_coverage_is_union_of_patch_native_and_data_contracts(self) -> None:
        manifest = self._load_discovery()
        providers = (
            manifest["patch_sites"] + manifest["native_sites"] + manifest["data_contracts"]
        )
        provided = {capability for provider in providers for capability in provider["provides"]}
        self.assertTrue(set(REQUIRED_CAPABILITIES).issubset(provided))
        self.assertEqual(9, len(manifest["patch_sites"]))
        self.assertEqual(
            len(manifest["patch_sites"]),
            len({site["site_id"] for site in manifest["patch_sites"]}),
        )

    def test_every_patch_site_has_fail_closed_stage_locks(self) -> None:
        manifest = self._load_discovery()
        for site in manifest["patch_sites"]:
            with self.subTest(site=site.get("site_id")):
                self.assertEqual(PATCH_SITE_KEYS, set(site))
                self.assertGreaterEqual(site["expected_anchor_count"], 1)
                self.assertGreaterEqual(site["required_maxstack"], 1)
                self.assertGreaterEqual(site["required_localcount"], 1)
                for key in (
                    "baseline_abc_code_sha256",
                    "input_pcode_canonical_sha256",
                    "output_pcode_canonical_sha256",
                ):
                    self.assertRegex(site[key], r"^[0-9a-f]{64}$")

    def test_every_data_contract_evidence_path_exists(self) -> None:
        manifest = self._load_discovery()
        for contract in manifest["data_contracts"]:
            with self.subTest(contract=contract["contract_id"]):
                evidence = ROOT / contract["evidence"]
                self.assertTrue(evidence.is_file(), f"missing evidence: {evidence}")

    def test_final_manifest_is_bound_to_final_dualsite_baseline(self) -> None:
        self.assertTrue(FINAL_MANIFEST.is_file(), "final Phase 4 manifest is missing")
        baseline = json.loads(FINAL_BASELINE.read_text(encoding="utf-8"))
        manifest = json.loads(FINAL_MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual("ready", manifest["state"])
        self.assertEqual(baseline["embedded_swf_sha256"], manifest["baseline"]["swf_sha256"])
        self.assertTrue(manifest["baseline"]["release_eligible"])
        self.assertEqual(
            "work/seris_v2/phase4_client/final_baseline/baseline.swf",
            manifest["baseline"]["source"],
        )
        native = {site["site_id"]: site for site in manifest["native_sites"]}
        for site_id, baseline_key in (
            ("final_dualsite_pixel_art_frame_scale", "pixel_art_character_view"),
            ("final_dualsite_member_view_frame_scale", "member_view"),
        ):
            with self.subTest(site=site_id):
                self.assertIn(site_id, native)
                self.assertEqual(
                    baseline["dual_site_verification"][baseline_key]["abc_code_sha256"],
                    native[site_id]["baseline_abc_code_sha256"],
                )
                self.assertNotEqual("0" * 64, native[site_id]["baseline_abc_code_sha256"])


class TestSerisPhase4PatchFunctions(unittest.TestCase):
    def test_special_pixel_swap_is_seris_scoped_and_keeps_frame_scale_data_driven(self) -> None:
        module = load_module()
        patched = module._patch_dual_swap(module.LEGACY.SELECT_VIEW_ANCHOR, 1)

        tag_marker = 'pushstring "ModDualForm"'
        seris_guard = 'pushstring "seris_dragon_king"'
        unique_guard = "pushbyte 22"
        self.assertEqual(1, patched.count(tag_marker))
        self.assertEqual(1, patched.count(seris_guard))
        self.assertEqual(1, patched.count(unique_guard))
        self.assertLess(patched.index(tag_marker), patched.index(seris_guard))
        self.assertLess(patched.index(seris_guard), patched.index(unique_guard))

        # Route C owns scale through each animation's frame metadata.  The swap
        # must not reintroduce SCALE_RENDERER or copy the outgoing form's scale.
        self.assertNotIn("SCALE_RENDERER", patched)
        self.assertNotIn('initproperty QName(PackageNamespace(""),"scaleX")', patched)
        self.assertNotIn('initproperty QName(PackageNamespace(""),"scaleY")', patched)
        self.assertIn(
            module._code(
                "getlocal 24",
                f"iffalse {module.LEGACY.DUAL_FORM_SWAP_REJOIN_LABEL}",
                "getlocal 24",
                "pushbyte 21",
            ),
            patched,
        )

    def test_patch_module_generates_all_sites_and_rejects_second_application(self) -> None:
        self.assertTrue(PATCH_MODULE.is_file(), "Phase 4 patch module is missing")
        module = load_module()
        manifest = json.loads(DISCOVERY_MANIFEST.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            report = module.generate_patch_set(
                DISCOVERY / "baseline.swf",
                [DISCOVERY / "pcode" / "scripts", DISCOVERY / "pcode_more" / "scripts", DISCOVERY / "pcode_skill" / "scripts"],
                output,
                DISCOVERY_MANIFEST,
            )
            self.assertEqual(9, len(report["outputs"]))
            for item in report["outputs"]:
                patched = Path(item["output"]).read_text(encoding="utf-8")
                with self.subTest(site=item["site_id"]):
                    with self.assertRaises(module.PcodePatchError):
                        module.patch_method_block(patched, item["site"])

    def test_discovery_build_reopens_every_stage_and_stays_non_release(self) -> None:
        report_path = DISCOVERY_BUILD / "build-report.json"
        self.assertTrue(report_path.is_file(), "staged discovery build report is missing")
        report = json.loads(report_path.read_text(encoding="utf-8"))
        manifest = json.loads(DISCOVERY_MANIFEST.read_text(encoding="utf-8"))
        expected_outputs = {
            site["site_id"]: site["output_pcode_canonical_sha256"]
            for site in manifest["patch_sites"]
        }
        self.assertEqual("offline_verified_discovery_only", report["state"])
        self.assertEqual(9, len(report["stages"]))
        self.assertEqual(list(range(1, 10)), [stage["sequence"] for stage in report["stages"]])
        self.assertTrue(all(stage["ffdec_reopen_verified"] for stage in report["stages"]))
        self.assertEqual(
            expected_outputs,
            {stage["site_id"]: stage["output_pcode_canonical_sha256"] for stage in report["stages"]},
        )
        self.assertTrue(report["final_export_verified"])
        self.assertFalse(report["release_eligible"])
        self.assertFalse(report["publish"])
        self.assertFalse(report["installed"])

    def test_final_build_reopens_every_stage_against_final_manifest(self) -> None:
        report_path = FINAL_BUILD / "build-report.json"
        self.assertTrue(report_path.is_file(), "final baseline staged build report is missing")
        report = json.loads(report_path.read_text(encoding="utf-8"))
        manifest = json.loads(FINAL_MANIFEST.read_text(encoding="utf-8"))
        expected_outputs = {
            site["site_id"]: site["output_pcode_canonical_sha256"]
            for site in manifest["patch_sites"]
        }
        self.assertEqual("offline_verified_final_baseline", report["state"])
        self.assertEqual(9, len(report["stages"]))
        self.assertTrue(all(stage["ffdec_reopen_verified"] for stage in report["stages"]))
        self.assertEqual(
            expected_outputs,
            {stage["site_id"]: stage["output_pcode_canonical_sha256"] for stage in report["stages"]},
        )
        self.assertTrue(report["final_export_verified"])
        self.assertFalse(report["release_eligible"])
        self.assertFalse(report["publish"])
        self.assertFalse(report["installed"])


if __name__ == "__main__":
    unittest.main()
