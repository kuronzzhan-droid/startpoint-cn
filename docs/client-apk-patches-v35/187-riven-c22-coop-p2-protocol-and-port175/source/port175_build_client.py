"""Replay the explicit source stages; each subprocess uses only this output root."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', type=int, default=0)
    parser.add_argument('--end', type=int, default=22)
    args = parser.parse_args()
    assert 0 <= args.start <= args.end <= 22
    assert __debug__
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    for stage in range(args.start, args.end + 1):
        result = subprocess.run([sys.executable, '-B', '-X', 'utf8',
                                 str(ROOT / 'source/port_replay.py'), str(stage)],
                                cwd=ROOT, env=env, text=True, encoding='utf-8',
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        logs = ROOT / 'audit/replay'
        logs.mkdir(parents=True, exist_ok=True)
        (logs / f'c{stage:02d}.log').write_text(result.stdout, 'utf-8')
        print(result.stdout, end='', flush=True)
        if result.returncode:
            raise SystemExit(result.returncode)
    if args.end == 22:
        # Stage 23: separate admission build ID (literal only; key untouched).
        result = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(ROOT / 'source/port_admission.py')],
                                cwd=ROOT, env=env, text=True, encoding='utf-8',
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (ROOT / 'audit/replay/c23-admission.log').write_text(result.stdout, 'utf-8')
        print(result.stdout, end='', flush=True)
        if result.returncode:
            raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
