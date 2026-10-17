#!/usr/bin/env python3
"""Source-only delivery regressions: disposable Git repos and real TypeScript emit."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools/build-cloud-overlay.py"


class SourceBuildOverlayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.install_scratch = tempfile.TemporaryDirectory(prefix="overlay-ts-dependencies-")
        cls.addClassCleanup(cls.install_scratch.cleanup)
        cls.dependencies = Path(cls.install_scratch.name)
        cls.package = {"name": "overlay-fixture", "version": "1.0.0", "private": True,
                       "devDependencies": {"typescript": "5.4.5"}}
        repo_lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
        ts_entry = repo_lock["packages"]["node_modules/typescript"]
        cls.lock = {"name": "overlay-fixture", "version": "1.0.0", "lockfileVersion": 3,
                    "requires": True, "packages": {"": cls.package, "node_modules/typescript": ts_entry}}
        (cls.dependencies / "package.json").write_text(json.dumps(cls.package), encoding="utf-8")
        (cls.dependencies / "package-lock.json").write_text(json.dumps(cls.lock), encoding="utf-8")
        installed_root = Path(os.environ.get("STARPOINT_TEST_DEPENDENCY_ROOT", ROOT))
        compiler = installed_root / "node_modules/typescript"
        if compiler.is_dir():
            shutil.copytree(compiler, cls.dependencies / "node_modules/typescript")
            hidden = {**cls.lock, "packages": {"node_modules/typescript": ts_entry}}
            (cls.dependencies / "node_modules/.package-lock.json").write_text(json.dumps(hidden), encoding="utf-8")
        else:
            subprocess.run(["npm.cmd" if os.name == "nt" else "npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
                           cwd=cls.dependencies, capture_output=True, check=True)
        cls.toolchain = {"node": subprocess.check_output(["node", "-p", "process.versions.node"], text=True).strip(),
                         "npm": subprocess.check_output(["npm.cmd" if os.name == "nt" else "npm", "--version"], text=True).strip(),
                         "typescript": "5.4.5"}

    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="overlay-source-build-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Overlay Fixture")
        self.git("config", "user.email", "overlay@example.invalid")
        self.git("config", "core.autocrlf", "false")
        self.write(".gitignore", "out/\n")
        self.write("package.json", json.dumps(self.package))
        self.write("package-lock.json", json.dumps(self.lock))
        self.write("tsconfig.json", json.dumps({"compilerOptions": {
            "rootDir": "src", "outDir": "out", "target": "es2016", "module": "commonjs",
            "resolveJsonModule": True, "esModuleInterop": True, "strict": True}, "include": ["src/**/*"]}))
        self.write("src/value.ts", "export const enum Budget { Value = 1 }\n")
        self.write("src/runtime.ts", "import { Budget } from './value'; export const current = Budget.Value;\n")
        self.write("src/worker.ts", "export const worker = 'ready';\n")
        self.policy = {"schema": 1, "output_dir": "out", "toolchain": self.toolchain,
                       "required_outputs": ["out/runtime.js", "out/worker.js"]}
        self.write("tools/runtime-build-policy.json", json.dumps(self.policy))
        self.base = self.commit("initial source-only runtime")
        spec = importlib.util.spec_from_file_location("overlay_source_build_under_test", TOOL)
        self.tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.tool)
        self.tool.REPO = str(self.repo)
        self.tool.OUT_ROOT = str(self.root / "packages")
        self.tool.RECORD = str(self.root / "delivery.json")
        Path(self.tool.RECORD).write_text(json.dumps({"latest_delivery": {"batch": "old"}}), encoding="utf-8")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.repo, text=True).strip()

    def write(self, relative, text):
        file = self.repo / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text, encoding="utf-8", newline="\n")

    def commit(self, message):
        # Explicit paths in this disposable fixture only; never stage the real checkout.
        names = self.git("ls-files", "--modified", "--others", "--exclude-standard").splitlines()
        if names:
            self.git("add", "--", *names)
        self.git("commit", "-m", message)
        return self.git("rev-parse", "HEAD")

    def invoke(self, batch="fixture", source="HEAD", base=None):
        arguments = [str(TOOL), "--batch", batch, "--base", base or self.base,
                     "--source", source, "--dependency-root", str(self.dependencies)]
        output = io.StringIO()
        with mock.patch.object(sys, "argv", arguments), contextlib.redirect_stdout(output):
            self.tool.main()
        return json.loads(output.getvalue())

    def archive(self, result):
        with zipfile.ZipFile(result["zip"]) as archive:
            self.assertIsNone(archive.testzip())
            return {name: archive.read(name) for name in archive.namelist()}

    def test_transitive_emit_and_dirty_ignored_output(self):
        self.write("src/value.ts", "export const enum Budget { Value = 7 }\n")
        head = self.commit("update inlined enum")
        self.write("out/runtime.js", "untrusted local output")
        self.write("out/injected.js", "must not ship")
        result = self.invoke()
        payload = self.archive(result)
        self.assertIn(b"7", payload["out/runtime.js"])
        self.assertNotIn("src/runtime.ts", payload)
        self.assertNotIn("out/injected.js", payload)
        receipt = json.loads(Path(result["release_receipt"]).read_text(encoding="utf-8"))
        self.assertEqual(receipt["runtime_build"]["source"]["source_commit"], head)
        self.assertEqual(receipt["runtime_build"]["source"]["lockfile_sha256"],
                         hashlib.sha256((self.repo / "package-lock.json").read_bytes()).hexdigest())
        record = json.loads(Path(self.tool.RECORD).read_text(encoding="utf-8"))["latest_delivery"]
        self.assertFalse(record["validation"]["members_match_committed_bytes"])
        self.assertTrue(record["validation"]["generated_members_match_fixed_source_build"])
        self.assertEqual((self.repo / "out/runtime.js").read_text(), "untrusted local output")

    def test_new_module_and_copied_json_are_delivered(self):
        self.write("src/feature.json", '{"name":"new payload"}')
        self.write("src/feature.ts", "import data from './feature.json'; export const name = data.name;\n")
        self.write("src/runtime.ts", "export { name } from './feature';\n")
        self.commit("new dependency and json")
        payload = self.archive(self.invoke())
        self.assertIn("out/feature.js", payload)
        self.assertEqual(json.loads(payload["out/feature.json"]), {"name": "new payload"})

    def test_static_asset_json_and_cdn_zip_keep_original_bytes(self):
        self.write("assets/shared.json", '{"static":"exact original bytes"}')
        self.write("src/asset-reader.ts", "import data from '../assets/shared.json'; export const value = data.static;\n")
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("production/android_upload/character.bin", b"original client payload\x00\xff")
        relative = "assets/asset-patch/active/fixture.zip"
        file = self.repo / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(buffer.getvalue())
        self.write("assets/asset-patch/production/excluded.bin", "excluded loose resource")
        self.commit("static assets and runtime reader")
        payload = self.archive(self.invoke())
        self.assertEqual(payload["assets/shared.json"], b'{"static":"exact original bytes"}')
        self.assertEqual(payload[relative], buffer.getvalue())
        self.assertIn("out/asset-reader.js", payload)
        self.assertNotIn("assets/asset-patch/production/excluded.bin", payload)

    def test_runtime_docs_json_changes_ship_without_changed_javascript(self):
        relative = "docs/generated/character_table.json"
        self.write(relative, '{"fixture":"old"}')
        self.write("src/doc-reader.ts", "import table from '../docs/generated/character_table.json'; export const value = table.fixture;\n")
        baseline = self.commit("runtime docs lookup fixture")
        self.write(relative, '{"fixture":"new exact bytes"}')
        self.write("docs/generated/unrelated.json", '{"excluded":true}')
        self.commit("update runtime docs lookup only")
        payload = self.archive(self.invoke(base=baseline))
        self.assertEqual(payload, {relative: b'{"fixture":"new exact bytes"}'})
        self.assertNotIn("out/doc-reader.js", payload)
        self.assertNotIn("docs/generated/unrelated.json", payload)

    def test_actual_module_removal_lists_only_runtime_removal(self):
        self.write("src/optional.ts", "export const optional = 1;\n")
        before = self.commit("optional module")
        self.git("rm", "--", "src/optional.ts")
        self.commit("remove optional module")
        result = self.invoke(base=before)
        deletes = Path(result["delete_files_list"]).read_text(encoding="utf-8")
        self.assertIn("out/optional.js\n", deletes)
        self.assertNotIn("out/worker.js", deletes)

    def legacy_baseline(self):
        self.git("rm", "--", "tools/runtime-build-policy.json")
        compiler = self.dependencies / "node_modules/typescript/bin/tsc"
        subprocess.run(["node", str(compiler), "--project", "tsconfig.json", "--incremental", "false"],
                       cwd=self.repo, check=True, capture_output=True)
        names = [file.relative_to(self.repo).as_posix() for file in (self.repo / "out").rglob("*") if file.is_file()]
        self.git("add", "-f", "--", *names)
        return self.commit("historical committed output"), {name: (self.repo / name).read_bytes() for name in names}

    def test_untracking_is_not_a_deployment_delete(self):
        legacy, _ = self.legacy_baseline()
        self.git("rm", "--cached", "-r", "--", "out")
        self.write("tools/runtime-build-policy.json", json.dumps(self.policy))
        self.commit("migrate tracking only")
        members, deleted, _, identity = self.tool.prepare_overlay(legacy, self.git("rev-parse", "HEAD"), str(self.dependencies))
        self.assertFalse(any(name.startswith("out/") for name in deleted))
        self.assertFalse(any(name.startswith("out/") for name in members))
        self.assertEqual(identity["baseline"]["mode"], "git-blobs")

    def test_historical_rollback_preserves_committed_output_bytes(self):
        _, old = self.legacy_baseline()
        # Historical emitted output may differ from what today's compiler would produce.
        old["out/runtime.js"] += b"\n// historical customized output bytes\n"
        (self.repo / "out/runtime.js").write_bytes(old["out/runtime.js"])
        self.git("add", "-f", "--", "out/runtime.js")
        legacy = self.commit("historical output differs from recompilation")
        self.git("rm", "--cached", "-r", "--", "out")
        self.write("tools/runtime-build-policy.json", json.dumps(self.policy))
        self.write("src/value.ts", "export const enum Budget { Value = 9 }\n")
        head = self.commit("migrate and update runtime")
        self.write("src/runtime.ts", "uncommitted invalid TS local edit")
        payload = self.archive(self.invoke(source=legacy, base=head))
        self.assertEqual(payload["out/runtime.js"], old["out/runtime.js"])
        self.assertEqual((self.repo / "src/runtime.ts").read_text(), "uncommitted invalid TS local edit")

    def partial_legacy(self):
        self.write("src/historical.ts", "import { Budget } from './value'; export const historical = Budget.Value;\n")
        self.legacy_baseline()
        self.git("rm", "--cached", "--", "out/historical.js")
        # A recorded historical blob must continue to win over fresh emit bytes.
        runtime = self.repo / "out/runtime.js"
        runtime.write_bytes(runtime.read_bytes() + b"\n// recorded historical output\n")
        self.git("add", "-f", "--", "out/runtime.js")
        return self.commit("partial historical out inventory")

    def migrate_partial_legacy(self):
        self.git("rm", "--cached", "-r", "--", "out")
        self.write("tools/runtime-build-policy.json", json.dumps(self.policy))

    def test_identical_inputs_preserve_unrecorded_legacy_modules_with_explicit_origin(self):
        legacy = self.partial_legacy()
        self.migrate_partial_legacy()
        head = self.commit("tracking migration with identical compile inputs")
        result = self.invoke(source=legacy, base=head)
        receipt = json.loads(Path(result["release_receipt"]).read_text(encoding="utf-8"))
        target = receipt["runtime_build"]["source"]
        self.assertEqual(target["mode"], "git-blobs-with-preserved-generated")
        self.assertEqual(target["preserved_generated_files"], ["out/historical.js"])
        self.assertIn("out/historical.js", target["files"])
        self.assertNotIn("out/historical.js", target["git_blob_files"])
        self.assertEqual(target["preserved_from_build_commit"], head)
        self.assertTrue(target["compile_inputs_identical"])
        self.assertNotIn("out/historical.js", receipt["deleted_files"])
        payload = self.archive(result)
        self.assertNotIn("out/historical.js", payload)
        self.assertIn(b"recorded historical output", payload["out/runtime.js"])

    def test_changed_compile_inputs_reject_missing_legacy_module_even_when_its_source_is_unchanged(self):
        legacy = self.partial_legacy()
        self.migrate_partial_legacy()
        self.write("src/value.ts", "export const enum Budget { Value = 99 }\n")
        head = self.commit("transitive emit changes missing historical module")
        with self.assertRaisesRegex(SystemExit, "历史实际产物"):
            self.invoke(source=legacy, base=head)
        self.assertFalse(Path(self.tool.OUT_ROOT).exists())

    def test_restoring_unrecorded_module_absent_from_current_build_is_rejected(self):
        legacy = self.partial_legacy()
        self.migrate_partial_legacy()
        self.git("rm", "--", "src/historical.ts")
        head = self.commit("current source no longer contains historical module")
        with self.assertRaisesRegex(SystemExit, "历史实际产物"):
            self.invoke(source=legacy, base=head)
        self.assertFalse(Path(self.tool.OUT_ROOT).exists())

    def test_missing_source_in_legacy_target_allows_actual_new_module_removal(self):
        legacy, _ = self.legacy_baseline()
        self.migrate_partial_legacy()
        self.write("src/current-only.ts", "export const currentOnly = true;\n")
        head = self.commit("new source-only module")
        result = self.invoke(source=legacy, base=head)
        receipt = json.loads(Path(result["release_receipt"]).read_text(encoding="utf-8"))
        self.assertIn("out/current-only.js", receipt["deleted_files"])
        self.assertNotIn("out/runtime.js", receipt["deleted_files"])

    def test_changed_inputs_reject_unrecorded_target_json_even_when_current_emit_has_none(self):
        self.write("src/config.json", '{"historical": true}')
        self.write("src/runtime.ts", "import config from './config.json'; export const runtime = config.historical;\n")
        legacy, _ = self.legacy_baseline()
        self.git("rm", "--cached", "--", "out/config.json")
        legacy = self.commit("unrecorded historical JSON output")
        self.migrate_partial_legacy()
        self.write("src/runtime.ts", "export const runtime = true;\n")
        self.git("rm", "--", "src/config.json")
        head = self.commit("changed input with unrecorded historical JSON")
        with self.assertRaisesRegex(SystemExit, "历史 JSON.*历史实际产物"):
            self.invoke(source=legacy, base=head)
        self.assertFalse(Path(self.tool.OUT_ROOT).exists())

    def test_changed_inputs_reject_uncertain_historical_tsx_extension(self):
        self.write("src/view.tsx", "export const view = true;\n")
        legacy, _ = self.legacy_baseline()
        self.migrate_partial_legacy()
        self.write("src/value.ts", "export const enum Budget { Value = 99 }\n")
        head = self.commit("changed input with historical TSX")
        with self.assertRaisesRegex(SystemExit, "历史 JSX.*历史实际产物"):
            self.invoke(source=legacy, base=head)
        self.assertFalse(Path(self.tool.OUT_ROOT).exists())

    def test_legacy_blob_batch_preserves_binary_and_shared_blob_bytes(self):
        self.git("rm", "--", "tools/runtime-build-policy.json")
        data = b"\x00\xff\n123 blob 4\nbytes after fake header\r\n"
        for relative in ["out/binary.js", "out/same-content.js"]:
            file = self.repo / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
        self.git("add", "-f", "--", "out/binary.js", "out/same-content.js")
        legacy = self.commit("binary historical blob fixture")
        self.assertEqual(self.tool.committed_out_bytes(legacy),
                         {"out/binary.js": data, "out/same-content.js": data})

    def test_compile_failure_creates_no_package_or_record(self):
        before_record = Path(self.tool.RECORD).read_bytes()
        self.write("src/runtime.ts", "export const wrong: number = 'not a number';\n")
        self.commit("invalid compile fixture")
        with self.assertRaisesRegex(SystemExit, "TypeScript|TS2322|not assignable"):
            self.invoke()
        self.assertFalse(Path(self.tool.OUT_ROOT).exists())
        self.assertEqual(Path(self.tool.RECORD).read_bytes(), before_record)

    def test_missing_required_worker_rejects_before_package(self):
        self.git("rm", "--", "src/worker.ts")
        self.commit("missing required worker fixture")
        with self.assertRaisesRegex(SystemExit, "Missing required runtime output"):
            self.invoke()
        self.assertFalse(Path(self.tool.OUT_ROOT).exists())

    def test_unknown_legacy_baseline_is_rejected(self):
        self.git("rm", "--", "tools/runtime-build-policy.json")
        legacy = self.commit("legacy without committed runtime")
        self.write("tools/runtime-build-policy.json", json.dumps(self.policy))
        self.write("src/value.ts", "export const enum Budget { Value = 8 }\n")
        self.commit("migrate unknown baseline")
        with self.assertRaisesRegex(SystemExit, "基线"):
            self.invoke(base=legacy)
        self.assertFalse(Path(self.tool.OUT_ROOT).exists())


if __name__ == "__main__":
    unittest.main()
