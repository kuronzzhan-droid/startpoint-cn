"""构建可配置战斗规则补丁；只生成本地候选，不安装或发布客户端依赖数据。"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from core import Editor, SwfAbc, sha, FMT, asm, bodies
import content
import damage
import gauge
import provenance
from verify import verify_editor

BASE_SHA = '7221942332835732b11e38fc2172482f87069a05e514004f1939d6193dcbf59d'


def patch_swf(swf):
    e = Editor(swf)
    content.install(e)
    damage.install(e)
    gauge.install(e)
    provenance.install(e)
    methods = e.apply()
    unchanged = verify_editor(e, methods)
    return {'methods': methods, 'added_methods': e.new_methods, 'added_traits': e.traits,
            'unchanged_method_bodies': unchanged,
            'status': 'static_candidate_runtime_pending', 'device_installed': False}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--report', type=Path, required=True)
    a = p.parse_args()
    if a.output.exists() or a.report.exists() or a.source.resolve() == a.output.resolve():
        p.error('output and report must be new paths')
    original = a.source.read_bytes()
    if sha(original) != BASE_SHA:
        p.error('unrecognized complete SWF baseline')
    swf = SwfAbc(a.source)
    report = patch_swf(swf)
    swf.save(a.output)
    reread = SwfAbc(a.output)
    assert reread.abc.serialize() == swf.abc.serialize()
    assert swf.body[:swf._offset] == reread.body[:reread._offset]
    assert swf.body[swf._offset+swf._length:] == reread.body[reread._offset+reread._length:]
    assert a.source.read_bytes() == original
    report.update(source=str(a.source), source_sha256=sha(original),
                  output=str(a.output), output_sha256=sha(a.output.read_bytes()))
    a.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps({'output': str(a.output), 'methods': len(report['methods']),
                      'added': len(report['added_methods']), 'status': report['status']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
