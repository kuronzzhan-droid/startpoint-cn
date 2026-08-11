# -*- coding: utf-8 -*-
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


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
