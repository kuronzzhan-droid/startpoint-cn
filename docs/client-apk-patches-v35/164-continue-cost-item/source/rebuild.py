"""Rebuild and verify all task artifacts locally, without deployment."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    for script in ("check_inputs.py", "generate_config.py", "work/server/tools/rebuild_verify.py",
                   "build_swf.py", "verify_client.py", "verify_delivery.py"):
        subprocess.run([sys.executable, "-B", "-X", "utf8", str(ROOT / script)], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
