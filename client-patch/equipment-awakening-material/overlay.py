"""在编成装备槽强化框客户端主 SWF（主 ABC 2a9583cd…）上追加觉醒专属素材；只做指令级插入，不回编 AS3。

用法（开发构建；对外交付请用 apply_equipment_awakening_material.py）::

    python -X utf8 client-patch/equipment-awakening-material/overlay.py <base.swf> <out.swf> --report <report.json>
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATCH_ROOT = HERE.parent
BATTLE_RULES = PATCH_ROOT / 'battle-rules'
if str(BATTLE_RULES) not in sys.path:
    sys.path.insert(0, str(BATTLE_RULES))

import core  # noqa: E402  battle-rules/core.py（Editor、asm、bodies、SwfAbc）


def _load(name, path):
    """按路径以唯一模块名加载：多个补丁目录都有 rules.py / verify.py，不能靠 sys.path 猜。"""
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


rules = _load('equipment_awakening_material_rules', HERE / 'rules.py')
battle_rules_verify = _load('equipment_awakening_material_battle_rules_verify', BATTLE_RULES / 'verify.py')

asm, bodies, SwfAbc = core.asm, core.bodies, core.SwfAbc
#: 基线 = equipment-enhanced-party-frame b 版产物（APK 2f085757… 里的主 SWF，未压缩 FWS）。a 版（APK 14396ce0，
#: 主 ABC 016cd927）有「武器图标会消失」缺陷，不再接受。
#: 主 ABC 是判定依据；容器哈希仅作参考。
BASE_ABC_SHA = '2a9583cddd47786844b9ce5fe2b99aff4e8b5f727e95e757fded99940688a1ad'
BASE_SWF_SHA = '5bd476f6effd1452a8d2508bbc721e1bc1636a5eb62b226005511eb698627162'
STATUS = 'static_candidate_runtime_pending'
PATCH_NAME = 'equipment-awakening-material'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class EquipmentAwakeningMaterialEditor(core.Editor):
    """battle-rules Editor + 本补丁自己的方法锁（不读、不改其他补丁的 baseline.json）。"""

    def __init__(self, swf):
        super().__init__(swf)
        self.locks = json.loads((HERE / 'baseline.json').read_text(encoding='utf8'))


def patch_editor(swf, mutate=None):
    """登记并应用插入段，随后用 battle-rules 的独立解析器核对只改了锁定的方法体。"""
    e = EquipmentAwakeningMaterialEditor(swf)
    anchors = rules.install(e, asm, bodies, mutate)
    methods = e.apply()
    if set(methods) != set(e.locks):
        raise asm.AsmError(f'patched methods {sorted(methods)} != locked {sorted(e.locks)}')
    if e.new_methods or e.traits:
        raise asm.AsmError('this patch must not add methods or traits')
    pool = e.pool.report()
    if mutate is None and (pool['added_strings'] != list(rules.ADDED_STRINGS)
                           or pool['added_multinames'] or pool['added_ints']):
        raise asm.AsmError(f'unexpected constant pool additions: {pool}')
    unchanged = battle_rules_verify.verify_editor(e, methods)
    headers = {label: list(e.abc.bodies[bodies.resolve(e.abc, label)][1:5]) for label in methods}
    return e, {
        'anchors': anchors,
        'methods': methods,
        'headers': headers,
        'inserted_counts': {label: change['insertions'][0][1] for label, change in methods.items()},
        'unchanged_method_bodies': unchanged,
        'pool': pool,
    }


def apply(source, output, report_path) -> dict:
    source, output, report_path = map(Path, (source, output, report_path))
    if output.exists() or report_path.exists() or source.resolve() == output.resolve():
        raise ValueError('output and report must be new paths')
    original = source.read_bytes()
    swf = SwfAbc(source)
    if sha(swf.abc.serialize()) != BASE_ABC_SHA:
        raise ValueError('requires the equipment-enhanced-party-frame client SWF (main ABC ' + BASE_ABC_SHA + ')')
    e, report = patch_editor(swf)
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
        'status': STATUS, 'device_installed': False, 'patch': PATCH_NAME,
        'capabilities_added': [rules.CAPABILITY],
        'source': str(source), 'source_sha256': sha(original),
        'source_matches_party_frame_container': sha(original) == BASE_SWF_SHA,
        'source_abc_sha256': BASE_ABC_SHA,
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
    a = p.parse_args()
    result = apply(a.source, a.output, a.report)
    print(json.dumps({k: result[k] for k in ('output', 'output_sha256', 'output_abc_sha256',
                                             'unchanged_method_bodies', 'status')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
