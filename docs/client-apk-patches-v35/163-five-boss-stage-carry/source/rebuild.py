"""One command, no external workspace dependencies: rebuild and verify delivery."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    for script in ('build_swf.py', 'verify_structure.py', 'verify_symbols.py', 'verify.py'):
        subprocess.run([sys.executable, '-B', '-X', 'utf8', str(ROOT / script)], cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
