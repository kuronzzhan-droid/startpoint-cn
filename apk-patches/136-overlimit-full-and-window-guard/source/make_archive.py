"""第136号本地补丁归档：本轮可复现源、锁和最终P-code。"""
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
    # 仅清理本脚本上次记录且未被修改的失效副本，避免旧开发文件残留归档。
    previous = ROOT/'archive-source-manifest.json'
    expected = {target.resolve() for _, target in pairs}
    if previous.exists():
        for row in json.loads(previous.read_text(encoding='utf-8')):
            target = (ROOT/row['path']).resolve()
            assert target.is_relative_to(archive.resolve()), '归档旧清单越界'
            if target not in expected and target.exists():
                assert sha(target.read_bytes()) == row['sha256'], '失效副本已被修改，不自动清理'
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
        'scope': '累计链本地草稿；只读依赖前七轮构造器及v34输入；AIR/真机未核实',
    }, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    output_path(archive/'README.md').write_text(f'''# {ARCHIVE}

能力 `{CAPABILITY}`，产物SHA256 `{release['output_swf_sha256']}`。
新增角色键 `wfx_overlimit_full_<角色id> = 1`，仅星5且最高等级键至少120生效。
材料全程使用10000320和10000302；最高台座以突破8次、Lv120、所有盘节点已学判定。
窗口原循环跳过不存在的格子；当前窗口不增建格子，重新打开正常建两格。

本归档 `source/` 包含本轮完整Python源码、工具链和方法锁，`pcode/` 是最终方法副本。
统一重放使用 [run8构造器](../../build.py)，加 `--from-v34` 从八轮起点串联。
不能在归档副本原位运行构造器：路径边界绑定run8，前七轮仍是只读依赖。
参见 [本轮说明](../../README.md)、[验收报告](../../verify-report.json)。
本地草稿，未写正式补丁库、注册表或游戏数据。完整AIR、真机、实际画面未核实。
''', encoding='utf-8')
    output_path(ROOT/'apk-patches-additions/README.md').write_text(
        '# 第八轮新增补丁归档草稿\n\n'
        f'- [{ARCHIVE}]({ARCHIVE}/README.md)：`{CAPABILITY}`。\n\n'
        '前七轮112–135条目仍保留原轮目录；本轮只追加136号本地草稿。\n', encoding='utf-8')
    output_path(ROOT/'archive-source-manifest.json').write_text(
        json.dumps(copies, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
