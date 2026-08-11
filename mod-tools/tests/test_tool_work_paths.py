# -*- coding: utf-8 -*-
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock


MOD_TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(MOD_TOOLS))

import wf_assets  # noqa: F401, E402
import wf_mod_tool  # noqa: F401, E402
import wf_quest_lib  # noqa: F401, E402


def load_copied_module(source_name: str, module_name: str, tool_dir: Path):
    source = MOD_TOOLS / source_name
    target = tool_dir / source_name
    tool_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    spec = importlib.util.spec_from_file_location(module_name, target)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise ImportError(f"cannot load {target}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(module_name, None)
    return module


class ToolWorkPathCase(unittest.TestCase):
    def test_publish_guard_indexes_the_shared_resolver_cdn(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tool_dir = root / "independent-tool"
            cdn = root / "external-cdn" / "cn"
            diff = cdn / "archive-common-diff"
            (cdn / "archive-common-full").mkdir(parents=True)
            diff.mkdir(parents=True)
            archive_path = diff / "pinball-1.4.54-1.4.55-1-test.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("production/upload/aa/bb", b"payload")

            with mock.patch.object(
                wf_mod_tool, "resolve_cdn_root_lax", return_value=cdn
            ) as resolver:
                guard = load_copied_module(
                    "wf_publish_guard.py", "isolated_publish_guard_cdn", tool_dir
                )

            self.assertIn("aa/bb", guard.chain_latest_index())
            resolver.assert_called_once_with()

    def test_publish_guard_reads_pending_from_its_own_tool_directory(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tool_dir = Path(td) / "independent-tool"
            pending = tool_dir / "work" / "sync_pending.json"
            pending.parent.mkdir(parents=True)
            pending.write_text(
                json.dumps(["aa/bb", "medium:ignored"]), encoding="utf-8"
            )
            guard = load_copied_module(
                "wf_publish_guard.py", "isolated_publish_guard", tool_dir
            )
            self.assertEqual(["aa/bb"], guard._pending_relatives())

    def test_rogue_banner_writes_pending_in_its_own_tool_directory(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tool_dir = Path(td) / "independent-tool"
            banner = load_copied_module(
                "wf_rogue_banner.py", "isolated_rogue_banner", tool_dir
            )
            banner.add_pending("aa/bb")
            pending = tool_dir / "work" / "sync_pending.json"
            self.assertEqual(["aa/bb"], json.loads(pending.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
