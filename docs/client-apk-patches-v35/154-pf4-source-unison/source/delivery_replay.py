"""在归档 source 目录直接运行，证明补丁重放不依赖工作区实现文件。"""
import json
import bootstrap
from bootstrap import INPUTS, sha
from build import construct, release_locks, release_record


if __name__ == '__main__':
    bootstrap.check_baseline()
    reports = {}
    for profile, (path, _, _) in INPUTS.items():
        raw, editor, _ = construct(path)
        assert release_record(raw, editor) == release_locks()[profile]
        reports[profile] = {'sha256': sha(raw), 'source_replay_byte_identical': True}
    print(json.dumps({'status': 'pass', 'profiles': reports}))
