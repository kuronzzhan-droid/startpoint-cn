"""在已打过装备强化外观 v1 的客户端主 SWF 上追加物品品质底色覆盖；只做指令级插入，不回编 AS3。

底包按**主 ABC** 判定：``rules.KNOWN_BASES`` 里登记的 4 个（编成槽框 a / b、觉醒专属素材、最终合成链），
或者调用方显式给出底包构建报告（``base_report``：报告的 ``swf_sha256`` 必须等于输入 SWF，能力声明取报告的
``candidate_capabilities``）。两种情况都还要过本补丁自己的两把方法锁（``baseline.json``）；锁不符就拒绝，没有兜底。

用法（开发构建；对外交付请用 apply_item_rarity_frame_override.py）::

    python -X utf8 client-patch/item-rarity-frame-override/overlay.py <base.swf> <out.swf> --report <report.json>
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


rules = _load('item_rarity_frame_override_rules', HERE / 'rules.py')
battle_rules_verify = _load('item_rarity_frame_override_battle_rules_verify', BATTLE_RULES / 'verify.py')

asm, bodies, SwfAbc = core.asm, core.bodies, core.SwfAbc
STATUS = 'static_candidate_runtime_pending'
PATCH_NAME = 'item-rarity-frame-override'
#: 底包构建报告里认可的能力名（防止把任意字符串写进候选 APK 的能力声明）。
CAPABILITY_RE_CHARS = set('abcdefghijklmnopqrstuvwxyz0123456789-')


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ItemRarityFrameOverrideEditor(core.Editor):
    """battle-rules Editor + 本补丁自己的两把方法锁（不读、不改其他补丁的 baseline.json）。"""

    def __init__(self, swf):
        super().__init__(swf)
        self.locks = json.loads((HERE / 'baseline.json').read_text(encoding='utf8'))


def patch_editor(swf, mutate=None):
    """登记并应用两段插入，随后用 battle-rules 的独立解析器核对只改了锁定的方法体。"""
    e = ItemRarityFrameOverrideEditor(swf)
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


def declared_base(report: dict | None, swf_sha: str, abc_sha: str) -> dict:
    """底包说明：登记表里的主 ABC 直接取表；否则必须有底包构建报告，且报告描述的正是这份 SWF。"""
    if abc_sha in rules.KNOWN_BASES:
        entry = rules.KNOWN_BASES[abc_sha]
        return {'listed': True, 'label': entry['label'], 'apk_sha256': entry['apk_sha256'],
                'swf_sha256': entry['swf_sha256'], 'capabilities': sorted(entry['capabilities'])}
    if report is None:
        raise ValueError('Unknown SWF baseline: main ABC ' + abc_sha + '. Listed bases: ' +
                         ', '.join(sorted(rules.KNOWN_BASES)) +
                         '. For another stack pass its APK build report (--base-build-report); '
                         'the two method locks must still match.')
    if report.get('swf_sha256') != swf_sha:
        raise ValueError('base build report does not describe this SWF (swf_sha256 differs)')
    caps = report.get('candidate_capabilities')
    if (not isinstance(caps, list) or not caps or len(set(caps)) != len(caps)
            or not all(isinstance(c, str) and c and set(c) <= CAPABILITY_RE_CHARS for c in caps)):
        raise ValueError('base build report lacks a clean candidate_capabilities list')
    if rules.CAPABILITY in caps:
        raise ValueError('base build report already declares ' + rules.CAPABILITY)
    if not report.get('apk_sha256'):
        raise ValueError('base build report lacks apk_sha256')
    return {'listed': False, 'label': 'declared by base build report', 'apk_sha256': report['apk_sha256'],
            'swf_sha256': swf_sha, 'capabilities': sorted(caps)}


def apply(source, output, report_path, base_report=None) -> dict:
    source, output, report_path = map(Path, (source, output, report_path))
    if output.exists() or report_path.exists() or source.resolve() == output.resolve():
        raise ValueError('output and report must be new paths')
    original = source.read_bytes()
    swf = SwfAbc(source)
    source_abc = sha(swf.abc.serialize())
    base = declared_base(base_report, sha(original), source_abc)
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
        'source': str(source), 'source_sha256': sha(original), 'source_abc_sha256': source_abc,
        'base': base,
        'base_capabilities': base['capabilities'],
        'candidate_capabilities': sorted(set(base['capabilities']) | {rules.CAPABILITY}),
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
    p.add_argument('--base-build-report', type=Path)
    a = p.parse_args()
    base_report = json.loads(a.base_build_report.read_text(encoding='utf8')) if a.base_build_report else None
    result = apply(a.source, a.output, a.report, base_report)
    print(json.dumps({k: result[k] for k in ('output', 'output_sha256', 'output_abc_sha256',
                                             'unchanged_method_bodies', 'status')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
