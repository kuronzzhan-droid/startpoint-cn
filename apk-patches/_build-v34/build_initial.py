"""Apply unmodified pinned R4 stages to the hash-checked v33 SWF."""
from build_common import ROOT, PATCH, run
import sys

work = ROOT / 'work'
work.mkdir(exist_ok=True)
source = ROOT / 'inputs/v33.swf'
stages = [('liveness', 'party-animation-liveness'),
          ('refresh', 'party-refresh-performance')]
for stage, folder in stages:
    output = work / f'after-{stage}.swf'
    command = [sys.executable, '-B', PATCH / folder / 'patch_swf.py', source, output]
    if stage == 'liveness':
        command += ['--expected-input-sha256',
                    '3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4']
    run(stage, command)
    source = output
