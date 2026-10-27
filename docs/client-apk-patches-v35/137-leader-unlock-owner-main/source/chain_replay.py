"""只读调用前八轮构造器；所有串联文件均写入 run9/work。"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
STAGES = (
    ('a', '941c6449688c2446e3671e4a70d301ab6236364fe881b487e676290b6cc547d9'),
    ('b', 'cae0605da80b069800eef83cc252fd16263be72da77cb87c08ba694e73a9959b'),
    ('c', 'd0a8e186203d94ba98d78dcf14a7557fcf4c0a4cea9fcaa340250267ec326682'),
    ('d', '4fe2b1ba6267bdcd69f54be3d464ef9aba9cc07a806038ec21161762e708a212'),
    ('e', '89461f676b57a059bde58fe5897190db9b61013ae63947401fe1bf87106d6bcf'),
    ('f', '383f49b060718055a80080309aed92f150073d321c8a237f748a025c32050ed4'),
    ('g', '960757dbaf599b5d4978b95670b9bbe3e76fac5cfd29045b8c9c0dd1a1ca0870'),
    ('h', 'f1c3260d470f46a4364baddb85af48dc34a5c299bb025d123be085ad6f04e573'),
)


def stage(number, source=None):
    if number not in range(1, len(STAGES) + 1):
        raise ValueError('未知串联轮次')
    old = ROOT.parent / ('run' + str(number))
    sys.path.insert(0, str(old))
    from build import construct, release_record
    frozen = json.loads((old / 'release-locks.json').read_text(encoding='utf-8'))
    raw, editor = construct() if source is None else construct(Path(source))
    if release_record(raw, editor) != frozen:
        raise ValueError('旧轮源码重放不符合其最终锁: ' + str(number))
    suffix, expected = STAGES[number - 1]
    digest = hashlib.sha256(raw).hexdigest()
    if digest != expected:
        raise ValueError('旧轮整包 SHA256 不符合固定结果: ' + str(number))
    dest = (ROOT / 'work' / ('v35' + suffix + '-chained.swf')).resolve()
    if not dest.is_relative_to(ROOT):
        raise ValueError('拒绝写入 run9 以外: ' + str(dest))
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    print(json.dumps({'path': str(dest), 'sha256': digest}))


def main():
    if len(sys.argv) > 1:
        stage(int(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else None)
        return
    previous = None
    for number, (_, expected) in enumerate(STAGES, start=1):
        args = [sys.executable, '-B', __file__, str(number)]
        if previous is not None:
            args.append(previous['path'])
        result = subprocess.run(args, capture_output=True, text=True,
                                encoding='utf-8', check=True)
        previous = json.loads(result.stdout)
        if previous['sha256'] != expected:
            raise ValueError('串联回执 SHA256 不符合固定结果: ' + str(number))
    print(json.dumps(previous))


if __name__ == '__main__':
    main()
