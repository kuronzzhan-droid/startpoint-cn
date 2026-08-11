# -*- coding: utf-8 -*-
from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MOD_TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(MOD_TOOLS))

import wf_mod_tool as core  # noqa: E402


class DevCatalogPathCase(unittest.TestCase):
    def setUp(self) -> None:
        self.previous = sys.modules.pop("wf_dev_catalog", None)
        self.addCleanup(self._restore_module)

    def _restore_module(self) -> None:
        sys.modules.pop("wf_dev_catalog", None)
        if self.previous is not None:
            sys.modules["wf_dev_catalog"] = self.previous

    def test_module_roots_use_shared_resolvers(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            cdn = root / "cdn" / "cn"
            server = root / "server"
            with (
                mock.patch.dict(
                    os.environ,
                    {
                        "WF_CDN_DIR": "relative-cdn",
                        "WF_SERVER_DIR": "relative-server",
                    },
                    clear=True,
                ),
                mock.patch.object(
                    core, "resolve_cdn_root_lax", return_value=cdn
                ) as cdn_resolver,
                mock.patch.object(
                    core, "resolve_server_dir", return_value=server
                ) as server_resolver,
            ):
                catalog = importlib.import_module("wf_dev_catalog")

        self.assertEqual(cdn, catalog.CDN_ROOT)
        self.assertEqual(server / "assets" / "asset-patch" / "active", catalog.ASSET_PATCH_ACTIVE)
        cdn_resolver.assert_called_once_with()
        server_resolver.assert_called_once_with()

    def test_invalid_explicit_configuration_fails_closed_during_import(self) -> None:
        with (
            mock.patch.dict(
                os.environ, {"WF_CDN_DIR": "relative-cdn"}, clear=True
            ),
            mock.patch.object(
                core,
                "resolve_cdn_root_lax",
                side_effect=ValueError("shared catalog resolver sentinel"),
            ),
        ):
            with self.assertRaisesRegex(ValueError, "shared catalog resolver sentinel"):
                importlib.import_module("wf_dev_catalog")


if __name__ == "__main__":
    unittest.main()
