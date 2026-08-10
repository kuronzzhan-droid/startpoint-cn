from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


TOOLS_DIR = Path(__file__).resolve().parents[1]


class EmbeddedSnapshotPortabilityTests(unittest.TestCase):
    def test_local_machine_launcher_is_not_distributed(self) -> None:
        self.assertFalse((TOOLS_DIR / ".1启动.ps1").exists())

    def test_server_root_consumers_use_the_shared_resolver(self) -> None:
        sources = {}
        for name in (
            "wf_dev_catalog.py",
            "wf_fantasy_shop.py",
            "wf_final_state_guard.py",
            "wf_mode15_build.py",
            "wf_rogue_save.py",
        ):
            source = (TOOLS_DIR / name).read_text(encoding="utf-8-sig")
            sources[name] = source
            self.assertIn("resolve_server_dir", source, name)
        forbidden = {
            "wf_dev_catalog.py": ("ROOT = Path(__file__).resolve().parent.parent", "_SERVER_DIR"),
            "wf_fantasy_shop.py": ("PROJECT_ROOT", 'PROJECT_ROOT / "server"'),
            "wf_final_state_guard.py": ("TOOL_DIR.parent.parent",),
            "wf_mode15_build.py": ('MOD_DIR.parent / "server"',),
            "wf_rogue_save.py": ('os.path.join(ROOT, "server")',),
        }
        for name, patterns in forbidden.items():
            for pattern in patterns:
                self.assertNotIn(pattern, sources[name], f"{name}: {pattern}")

    def test_executable_python_has_no_private_f_drive_or_asus_profile(self) -> None:
        offenders = []
        for path in TOOLS_DIR.glob("*.py"):
            source = path.read_text(encoding="utf-8-sig")
            if "F:\\" in source or "C:\\Users\\ASUS" in source:
                offenders.append(path.name)
        self.assertEqual([], offenders)

    def test_reference_only_boundary_is_at_the_top_of_readme(self) -> None:
        top = "\n".join(
            (TOOLS_DIR / "README.md").read_text(encoding="utf-8").splitlines()[:20]
        )
        self.assertIn("reference-only", top)
        self.assertIn("禁止", top)
        self.assertIn("publish", top)
        self.assertIn("store", top)
        self.assertIn("device", top)

    def test_private_runtime_path_is_removed_from_pure_server_doc(self) -> None:
        text = (TOOLS_DIR / "PURE_SERVER_FANTASY_TOOLING.md").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("C:\\Users\\ASUS", text)
        self.assertNotIn("F:\\", text)

    def test_extended_boss_trial_module_is_unique_and_portable(self) -> None:
        self.assertFalse((TOOLS_DIR / "test_wf_boss_trial.py").exists())
        extended = TOOLS_DIR / "tests" / "test_wf_boss_trial_extended.py"
        self.assertTrue(extended.is_file())
        self.assertNotIn("F:\\", extended.read_text(encoding="utf-8"))

    def _run_without_local_configuration(self, script: str, *args: str):
        env = os.environ.copy()
        for key in (
            "WF_TARGET_STORE",
            "WF_SERVER_DIR",
            "WF_MOD_TOOLS_DIR",
            "WF_MODE15_TOKEN_ICON",
        ):
            env.pop(key, None)
        return subprocess.run(
            [sys.executable, str(TOOLS_DIR / script), *args],
            cwd=TOOLS_DIR,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    def test_token_installer_requires_an_explicit_write_target(self) -> None:
        result = self._run_without_local_configuration(
            "install_mode15_token_icon.py", "--source", "missing.png"
        )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("--target-store", result.stdout + result.stderr)

    def test_weapon_builder_write_requires_an_explicit_write_target(self) -> None:
        result = self._run_without_local_configuration(
            "build_fantasy_weapon_candidates.py", "--write"
        )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("--target-store", result.stdout + result.stderr)

    def test_mode15_module_import_does_not_resolve_store_or_server(self) -> None:
        env = os.environ.copy()
        env.pop("WF_TARGET_STORE", None)
        env["WF_SERVER_DIR"] = str(TOOLS_DIR / "missing-server")
        result = subprocess.run(
            [sys.executable, "-X", "utf8", "-c", "import wf_mode15_build"],
            cwd=TOOLS_DIR,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def test_mode15_explicit_server_root_wins_before_runtime_loads(self) -> None:
        with tempfile.TemporaryDirectory() as td, tempfile.TemporaryDirectory() as store:
            server = Path(td)
            (server / "src").mkdir()
            (server / "src" / "cn-server.ts").write_text("// fixture\n", encoding="utf-8")
            (server / "package.json").write_text("{}\n", encoding="utf-8")
            env = os.environ.copy()
            env["WF_TARGET_STORE"] = store
            env["WF_SERVER_DIR"] = str(TOOLS_DIR / "missing-server")
            code = (
                "import sys; from pathlib import Path; import wf_mode15_build as mode15; "
                "print(mode15.resolve_server_root(Path(sys.argv[1])))"
            )
            result = subprocess.run(
                [sys.executable, "-X", "utf8", "-c", code, str(server)],
                cwd=TOOLS_DIR,
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(str(server.resolve()), result.stdout.strip())

    def test_dev_catalog_explicit_cdn_root_reaches_argparse_without_server(self) -> None:
        with tempfile.TemporaryDirectory() as cdn:
            env = os.environ.copy()
            env.pop("WF_CDN_DIR", None)
            env.pop("WF_PROFILE", None)
            env["WF_SERVER_DIR"] = str(TOOLS_DIR / "missing-server")
            result = subprocess.run(
                [
                    sys.executable,
                    "-X",
                    "utf8",
                    str(TOOLS_DIR / "wf_dev_catalog.py"),
                    "--cdn-root",
                    cdn,
                    "--help",
                ],
                cwd=TOOLS_DIR,
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("usage:", result.stdout.lower())

    def test_token_installer_uses_only_explicit_temporary_outputs(self) -> None:
        with (
            tempfile.TemporaryDirectory() as td,
            tempfile.TemporaryDirectory() as store,
        ):
            root = Path(td)
            source = root / "token.png"
            pending = root / "sync_pending.json"
            Image.new("RGBA", (20, 20), (255, 255, 255, 0)).save(source, format="PNG")
            env = os.environ.copy()
            env.pop("WF_PROFILE", None)
            env["WF_SERVER_DIR"] = str(TOOLS_DIR / "missing-server")
            result = subprocess.run(
                [
                    sys.executable,
                    "-X",
                    "utf8",
                    str(TOOLS_DIR / "install_mode15_token_icon.py"),
                    "--source",
                    str(source),
                    "--target-store",
                    store,
                    "--pending-file",
                    str(pending),
                ],
                cwd=TOOLS_DIR,
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            entries = json.loads(pending.read_text(encoding="utf-8"))
            self.assertEqual(1, len(entries))
            self.assertTrue((Path(store) / entries[0]).is_file())


if __name__ == "__main__":
    unittest.main()
