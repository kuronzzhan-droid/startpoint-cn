"""Parameterized Client SWF & APK Merge Pipeline v4 (`merge_client.py`).

Entry point alias for `merge_1008093.py` v4 supporting `--version-code`, `--build-id`,
`--c25`, `--c26`, and `--digits` / `--digits-cwd`.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

from merge_1008093 import *  # noqa: F401,F403,E402
from merge_1008093 import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
