"""在 1.4.1047 客户端主 SWF（6e7b2db7…）上追加装备规则补丁；只做指令级插入，不回编 AS3。

用法（开发/自定义参数构建；对外交付请用 apply_equipment_rules.py）::

    python -X utf8 client-patch/equipment-rules/overlay.py <base.swf> <out.swf> --report <report.json>
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BATTLE_RULES = HERE.parent / 'battle-rules'
for path in (str(HERE), str(BATTLE_RULES)):
    if path not in sys.path:
        sys.path.insert(0, path)

import core  # noqa: E402  battle-rules/core.py（Editor、asm、bodies、SwfAbc）
import rules  # noqa: E402

_spec = importlib.util.spec_from_file_location('battle_rules_verify', BATTLE_RULES / 'verify.py')
battle_rules_verify = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(battle_rules_verify)

asm, bodies, SwfAbc = core.asm, core.bodies, core.SwfAbc
BASE_SWF_SHA = '6e7b2db7923d2456ce2b6edc9a42aba51f1f87a099ecc4f606c1de7fc302c497'
STATUS = 'static_candidate_runtime_pending'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class EquipmentRulesEditor(core.Editor):
    """battle-rules Editor + 本补丁自己的方法锁（不读、不改 battle-rules/baseline.json 的内容）。"""

    def __init__(self, swf):
        super().__init__(swf)
        self.locks = json.loads((HERE / 'baseline.json').read_text(encoding='utf8'))


def patch_editor(swf, config: rules.Config = rules.DEFAULT):
    e = EquipmentRulesEditor(swf)
    anchors = rules.install(e, asm, bodies, config)
    methods = e.apply()
    if set(methods) != set(e.locks):
        raise asm.AsmError(f'patched methods {sorted(methods)} != locked {sorted(e.locks)}')
    unchanged = battle_rules_verify.verify_editor(e, methods)
    return e, {
        'anchors': anchors,
        'methods': methods,
        'added_methods': e.new_methods,
        'added_traits': [list(t) for t in e.traits],
        'unchanged_method_bodies': unchanged,
        'pool': e.pool.report(),
    }


def apply(source, output, report_path, config: rules.Config = rules.DEFAULT) -> dict:
    source, output, report_path = map(Path, (source, output, report_path))
    if output.exists() or report_path.exists() or source.resolve() == output.resolve():
        raise ValueError('output and report must be new paths')
    original = source.read_bytes()
    if sha(original) != BASE_SWF_SHA:
        raise ValueError('requires the 1.4.1047 client SWF ' + BASE_SWF_SHA)
    swf = SwfAbc(source)
    e, report = patch_editor(swf, config)
    abc_bytes = swf.abc.serialize()
    swf.save(output)
    reread = SwfAbc(output)
    if reread.abc.serialize() != abc_bytes:
        raise AssertionError('saved ABC differs from the patched ABC')
    if swf.body[:swf._offset] != reread.body[:reread._offset] or \
            swf.body[swf._offset + swf._length:] != reread.body[reread._offset + reread._length:]:
        raise AssertionError('non-ABC SWF tags changed')
    if source.read_bytes() != original:
        raise AssertionError('input changed during patching')
    result = {
        'status': STATUS, 'device_installed': False,
        'patch': 'equipment-rules', 'config': config.as_dict(),
        'capabilities_added': [rules.CAPABILITY_RULES, rules.CAPABILITY_GAUGE],
        'source': str(source), 'source_sha256': sha(original),
        'output': str(output), 'output_sha256': sha(output.read_bytes()),
        'output_abc_sha256': sha(abc_bytes),
    }
    result.update(report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str) + '\n', encoding='utf8')
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('source', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--report', type=Path, required=True)
    p.add_argument('--cursed-extra', type=int, nargs='*', default=[],
                   help='额外计为诅咒武器的魂 id（仅开发构建；交付构建必须用默认参数）')
    a = p.parse_args()
    config = rules.Config(cursed_extra=tuple(a.cursed_extra)) if a.cursed_extra else rules.DEFAULT
    result = apply(a.source, a.output, a.report, config)
    print(json.dumps({k: result[k] for k in ('output', 'output_sha256', 'output_abc_sha256',
                                             'unchanged_method_bodies', 'status')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
