# -*- coding: utf-8 -*-
"""CDN 根四级解析链(core.resolve_cdn_root)回归:T2 两仓独立的接入契约。

层级:WF_CDN_DIR env > profile.cdn_dir > 服务端识别(WF_SERVER_DIR/profile.server_dir
→ 复读服务端 .env 的 CDN_DIR,缺省 <server>/.cdn/cn)> 已验证仓库布局。
显式配置不合法=硬报错;无法验证服务端仓根时 fail closed。
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import wf_mod_tool as core  # noqa: E402


def make_cdn(root: Path) -> Path:
    (root / "archive-common-diff").mkdir(parents=True)
    return root


def make_server(root: Path) -> Path:
    (root / "src").mkdir(parents=True, exist_ok=True)
    (root / "src" / "cn-server.ts").write_text("// fixture\n", encoding="utf-8")
    (root / "package.json").write_text("{}\n", encoding="utf-8")
    return root


class _ResolveBase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # 隔离环境:清空相关 env,profile 默认为空
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)
        for key in ("WF_CDN_DIR", "WF_SERVER_DIR", "WF_PROFILE"):
            os.environ.pop(key, None)
        patcher = mock.patch.object(core, "load_profiles", return_value={})
        patcher.start()
        self.addCleanup(patcher.stop)
        # 嵌套遗留兜底指向不存在的位置,避免测试机真实链干扰
        self.fake_project = make_server(self.root / "fake-project")
        patcher2 = mock.patch.object(
            core, "project_root", return_value=self.fake_project
        )
        patcher2.start()
        self.addCleanup(patcher2.stop)

    def _use_profile(self, entry: dict) -> None:
        patcher = mock.patch.object(
            core, "load_profiles",
            return_value={"active": "cn", "profiles": {"cn": {"store": ".", **entry}}},
        )
        patcher.start()
        self.addCleanup(patcher.stop)


class ResolveCdnRootTest(_ResolveBase):
    def test_env_wins(self) -> None:
        cdn = make_cdn(self.root / "somewhere" / "cn")
        os.environ["WF_CDN_DIR"] = str(cdn)
        self.assertEqual(cdn, core.resolve_cdn_root())

    def test_env_invalid_is_hard_error(self) -> None:
        os.environ["WF_CDN_DIR"] = str(self.root / "not-a-cdn")
        with self.assertRaises(ValueError) as ctx:
            core.resolve_cdn_root()
        self.assertIn("WF_CDN_DIR", str(ctx.exception))

    def test_profile_cdn_dir_used(self) -> None:
        cdn = make_cdn(self.root / "cdn-by-profile" / "cn")
        self._use_profile({"cdn_dir": str(cdn)})
        self.assertEqual(cdn, core.resolve_cdn_root())

    def test_profile_cdn_dir_invalid_is_hard_error(self) -> None:
        self._use_profile({"cdn_dir": str(self.root / "bogus")})
        with self.assertRaises(ValueError) as ctx:
            core.resolve_cdn_root()
        self.assertIn("cdn_dir", str(ctx.exception))

    def test_server_env_cdn_dir_declared(self) -> None:
        server = make_server(self.root / "server")
        declared_parent = self.root / "external-cdn"
        make_cdn(declared_parent / "cn")
        (server / ".env").write_text(
            f'# comment\nCDN_DIR="{declared_parent}"\n', encoding="utf-8"
        )
        os.environ["WF_SERVER_DIR"] = str(server)
        self.assertEqual(declared_parent / "cn", core.resolve_cdn_root())

    def test_server_default_dot_cdn(self) -> None:
        server = make_server(self.root / "server2")
        make_cdn(server / ".cdn" / "cn")
        os.environ["WF_SERVER_DIR"] = str(server)
        self.assertEqual(server / ".cdn" / "cn", core.resolve_cdn_root())

    def test_server_env_relative_cdn_dir(self) -> None:
        server = make_server(self.root / "server3")
        make_cdn(server / "data" / "cdn" / "cn")
        (server / ".env").write_text("CDN_DIR=data/cdn\n", encoding="utf-8")
        os.environ["WF_SERVER_DIR"] = str(server)
        self.assertEqual(server / "data" / "cdn" / "cn", core.resolve_cdn_root())

    def test_profile_server_dir_when_no_env(self) -> None:
        server = make_server(self.root / "server4")
        make_cdn(server / ".cdn" / "cn")
        self._use_profile({"server_dir": str(server)})
        self.assertEqual(server / ".cdn" / "cn", core.resolve_cdn_root())

    def test_wf_profile_selects_non_active_profile_cdn(self) -> None:
        active = make_server(self.root / "active-server")
        selected = make_server(self.root / "selected-server")
        make_cdn(active / ".cdn" / "cn")
        make_cdn(selected / ".cdn" / "cn")
        patcher = mock.patch.object(
            core,
            "load_profiles",
            return_value={
                "active": "active",
                "profiles": {
                    "active": {"store": ".", "server_dir": str(active)},
                    "selected": {"store": ".", "server_dir": str(selected)},
                },
            },
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ["WF_PROFILE"] = "selected"
        self.assertEqual(selected / ".cdn" / "cn", core.resolve_cdn_root())

    def test_legacy_nested_fallback(self) -> None:
        legacy = make_cdn(self.fake_project / ".cdn" / "cn")
        self.assertEqual(legacy, core.resolve_cdn_root())

    def test_all_missing_reports_tried_list(self) -> None:
        os.environ["WF_SERVER_DIR"] = str(self.root / "no-server")
        with self.assertRaises(ValueError) as ctx:
            core.resolve_cdn_root()
        message = str(ctx.exception)
        self.assertIn("WF_SERVER_DIR", message)
        self.assertIn("不是可验证", message)

    def test_lax_falls_back_to_legacy_path(self) -> None:
        resolved = core.resolve_cdn_root_lax()
        self.assertEqual(self.fake_project / ".cdn" / "cn", resolved)


class ResolveServerDirTest(_ResolveBase):
    """resolve_server_dir:显式配置优先，其次仅接受已验证的仓库布局。"""

    def test_env_wins(self) -> None:
        server = make_server(self.root / "srv")
        os.environ["WF_SERVER_DIR"] = str(server)
        self.assertEqual(server, core.resolve_server_dir())

    def test_profile_server_dir(self) -> None:
        server = make_server(self.root / "srv2")
        self._use_profile({"server_dir": str(server)})
        self.assertEqual(server, core.resolve_server_dir())

    def test_verified_layout_fallback(self) -> None:
        self.assertEqual(self.fake_project, core.resolve_server_dir())

    def test_invalid_env_fails_closed_without_profile_fallback(self) -> None:
        os.environ["WF_SERVER_DIR"] = str(self.root / "not-a-server")
        self._use_profile({"server_dir": str(make_server(self.root / "profile"))})
        with self.assertRaisesRegex(ValueError, "WF_SERVER_DIR"):
            core.resolve_server_dir()

    def test_invalid_profile_fails_closed(self) -> None:
        self._use_profile({"server_dir": str(self.root / "not-a-server")})
        with self.assertRaisesRegex(ValueError, "server_dir"):
            core.resolve_server_dir()

    def test_wf_profile_selects_non_active_profile_server(self) -> None:
        active = make_server(self.root / "active-server")
        selected = make_server(self.root / "selected-server")
        patcher = mock.patch.object(
            core,
            "load_profiles",
            return_value={
                "active": "active",
                "profiles": {
                    "active": {"store": ".", "server_dir": str(active)},
                    "selected": {"store": ".", "server_dir": str(selected)},
                },
            },
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ["WF_PROFILE"] = "selected"
        self.assertEqual(selected, core.resolve_server_dir())

    def test_unknown_explicit_wf_profile_fails_closed(self) -> None:
        os.environ["WF_PROFILE"] = "missing"
        with self.assertRaisesRegex(ValueError, "missing"):
            core.resolve_server_dir()

    def test_broken_explicit_wf_profile_fails_closed(self) -> None:
        os.environ["WF_PROFILE"] = "broken"
        patcher = mock.patch.object(core, "load_profiles", side_effect=ValueError("bad json"))
        patcher.start()
        self.addCleanup(patcher.stop)
        with self.assertRaisesRegex(ValueError, "broken"):
            core.resolve_server_dir()

    def test_broken_active_profiles_fail_closed(self) -> None:
        patcher = mock.patch.object(core, "load_profiles", side_effect=ValueError("bad json"))
        patcher.start()
        self.addCleanup(patcher.stop)
        with self.assertRaisesRegex(ValueError, "profile"):
            core.resolve_server_dir()


class ProjectRootLayoutTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)
        for key in ("WF_SERVER_DIR", "WF_PROFILE"):
            os.environ.pop(key, None)
        profiles = mock.patch.object(core, "load_profiles", return_value={})
        profiles.start()
        self.addCleanup(profiles.stop)

    def _module_at(self, path: Path):
        return mock.patch.object(core, "__file__", str(path))

    def test_current_embedded_layout_uses_repository_root(self) -> None:
        repo = make_server(self.root / "embedded")
        module = repo / "tools" / "fantasy-gauntlet-mod-tools" / "wf_mod_tool.py"
        with self._module_at(module):
            self.assertEqual(repo, core.project_root())
            self.assertEqual(repo, core.resolve_server_dir())

    def test_legacy_mod_tools_layout_uses_repository_root(self) -> None:
        repo = make_server(self.root / "legacy")
        module = repo / "mod-tools" / "wf_mod_tool.py"
        with self._module_at(module):
            self.assertEqual(repo, core.project_root())
            self.assertEqual(repo, core.resolve_server_dir())

    def test_flat_standalone_layout_uses_tool_root_and_fails_server_closed(self) -> None:
        tools = self.root / "standalone-tools"
        module = tools / "wf_mod_tool.py"
        with self._module_at(module):
            self.assertEqual(tools, core.project_root())
            with self.assertRaisesRegex(ValueError, "WF_SERVER_DIR"):
                core.resolve_server_dir()

    def test_flat_standalone_named_mod_tools_is_not_mistaken_for_legacy_layout(self) -> None:
        tools = self.root / "unrelated" / "mod-tools"
        module = tools / "wf_mod_tool.py"
        with self._module_at(module):
            self.assertEqual(tools, core.project_root())
            with self.assertRaisesRegex(ValueError, "WF_SERVER_DIR"):
                core.resolve_server_dir()

    def test_flat_standalone_under_tools_is_not_mistaken_for_embedded_layout(self) -> None:
        tools = self.root / "unrelated" / "tools" / "snapshot"
        module = tools / "wf_mod_tool.py"
        with self._module_at(module):
            self.assertEqual(tools, core.project_root())
            with self.assertRaisesRegex(ValueError, "WF_SERVER_DIR"):
                core.resolve_server_dir()


if __name__ == "__main__":
    unittest.main()
