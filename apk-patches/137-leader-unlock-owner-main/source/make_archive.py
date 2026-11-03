"""第137号本地补丁归档：可复现源、输入输出锁和最终P-code。"""
import json
from bootstrap import ROOT, output_path
from framework import sha
from make_registry import CAPABILITY, ARCHIVE


def archive_sources():
    excluded = {'work', 'apk-patches-additions', '__pycache__'}
    return [p for p in sorted(ROOT.rglob('*.py'))
            if not excluded.intersection(p.relative_to(ROOT).parts)] + [
                ROOT/'baseline-locks.json', ROOT/'release-locks.json']


def main():
    release = json.loads((ROOT/'release-locks.json').read_text(encoding='utf-8'))
    pcode = json.loads((ROOT/'final-pcode/manifest.json').read_text(encoding='utf-8'))
    archive = ROOT/'apk-patches-additions'/ARCHIVE
    pairs = [(p, archive/'source'/p.relative_to(ROOT)) for p in archive_sources()]
    pairs += [(ROOT/'final-pcode'/r['file'], archive/'pcode'/r['file']) for r in pcode]
    previous = ROOT/'archive-source-manifest.json'
    expected = {target.resolve() for _, target in pairs}
    if previous.exists():
        for row in json.loads(previous.read_text(encoding='utf-8')):
            target = (ROOT/row['path']).resolve()
            assert target.is_relative_to(archive.resolve()), '归档旧清单越界'
            if target not in expected and target.exists():
                assert sha(target.read_bytes()) == row['sha256'], '失效副本已被修改'
                target.unlink()
    copies = []
    for source, target in pairs:
        raw = source.read_bytes()
        output_path(target).write_bytes(raw)
        copies.append({'source': source.relative_to(ROOT).as_posix(),
                       'path': target.relative_to(ROOT).as_posix(), 'sha256': sha(raw)})
    output_path(archive/'manifest.json').write_text(json.dumps({
        'capability': CAPABILITY, 'output_swf_sha256': release['output_swf_sha256'],
        'pcode': pcode, 'source_entrypoint': '../../build.py',
        'scope': '本地草稿；只读依赖前八轮构造器及v34输入；AIR/真机未核实',
    }, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    output_path(archive/'README.md').write_text(f'''# {ARCHIVE}

能力 `{CAPABILITY}`，产物SHA256 `{release['output_swf_sha256']}`。
复用 `wfx_unlock_<slot0队长技编号>` 的bit1/bit8/bit16判据，
只放开合击角色自身能力的202 OwnerIsMain；其余前置保持原生。

本归档 `source/` 包含本轮Python源码、工具链和方法锁，`pcode/` 为最终方法副本。
统一重放使用 [run9构造器](../../build.py)，加 `--from-v34` 从v34串联全部九轮。
不能在归档副本原位运行构造器：路径边界绑定run9，前八轮是只读依赖。
参见 [本轮说明](../../README.md)、[验收报告](../../verify-report.json)。
本地草稿；完整AIR、真机、实际UI未核实。
''', encoding='utf-8')
    output_path(ROOT/'apk-patches-additions/README.md').write_text(
        '# 第九轮新增补丁归档草稿\n\n'
        f'- [{ARCHIVE}]({ARCHIVE}/README.md)：`{CAPABILITY}`。\n\n'
        '前八轮112–136条目保留在原轮目录；本轮追加137号本地草稿。\n', encoding='utf-8')
    output_path(ROOT/'archive-source-manifest.json').write_text(
        json.dumps(copies, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
