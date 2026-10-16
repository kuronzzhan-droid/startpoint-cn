"""Pinned, surgical shop optimization plus this task's existing awake callback fix."""
import copy
import importlib.util
import json
import struct
import sys
import zlib
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


awake = module('shop_awake_patch', HERE.parent / 'awake-page-refresh/patch_swf.py')
s = awake.s
LABELS = {
    25379: 'pinball.common.data.shop::ShopProductRepository/getAllProducts|1',
    25381: 'pinball.common.data.shop::ShopProductRepository/existsEventItemInQuestEvent|1',
    81189: 'pinball.scene.shop.shopTop::ShopTopScene/existsExchangeableEvents|1',
    72196: 'pinball.scene.eventItemExchange.top::EventItemExchangeTopScene/getListSource|1',
}


def replace_span(code, begin, end, block):
    """Replace straight-line instructions, preserving every external branch target."""
    old = s.m.asm.decode(code)
    assert s.m.asm.encode(old)[0] == code
    assert all(x.target is None and x.default is None for x in block)
    delta = len(block) - (end - begin)

    def mapped(at):
        if at is None:
            return None
        assert not begin < at < end, f'branch enters removed instructions: {at}'
        return at + delta if at >= end else at

    new = []
    for i, ins in enumerate(old):
        if i == begin:
            new.extend(copy.deepcopy(block))
        if begin <= i < end:
            continue
        ins = copy.deepcopy(ins)
        ins.target = mapped(ins.target)
        ins.default = mapped(ins.default)
        if ins.cases is not None:
            ins.cases = [mapped(x) for x in ins.cases]
        new.append(ins)
    return s.m.asm.encode(new)[0]


def patch(source: Path, helper: Path, output: Path):
    assert s.sha(source.read_bytes()) in awake.INPUT_HASHES
    assert not output.exists() and '.cdn' not in output.resolve().parts
    awake_output = output.with_name(output.stem + '-awake-input.swf')
    awake_report = awake.patch(source, awake_output)
    version, header, tags = s.parts(awake_output)
    abcs = [t for t in tags if t[0] == 82]
    assert len(abcs) == 291 and sum(len(t[3].bodies) for t in abcs) == 96535
    main = abcs[290]
    a = main[3]
    assert a.serialize() == main[4]
    before = copy.deepcopy(a)
    view = s.m.View(SimpleNamespace(abc=a), s.m.asm)
    pool = s.PoolEditor(a)

    def q(ns, name):
        matches = [i for i in range(1, len(a.multinames)) if view.mn(i) == (7, (22, ns), name)]
        if matches:
            return matches[0]
        spaces = [i for i, n in enumerate(a.namespaces) if i and n[0] == 22 and a.s(n[1]) == ns]
        if spaces:
            space = spaces[0]
        else:
            a.namespaces.append((22, pool.string(ns)))
            space = len(a.namespaces) - 1
        a.multinames.append((7, space, pool.string(name)))
        return len(a.multinames) - 1

    helper_q = q('cn.shop', 'ShopFirstOpen')
    changes = []
    for bi, begin, end, table_local, event_local in [
        (25379, 156, 158, 3, 8), (25381, 125, 127, 7, 6),
    ]:
        assert view.by_label[LABELS[bi]] == [bi]
        body = a.bodies[bi]
        assert not body[6]
        code = s.m.asm.decode(body[5])
        assert code[begin].op == (0xd3 if table_local == 3 else 0x62)
        assert code[begin].args == ([] if table_local == 3 else [7])
        assert code[begin + 1].op == 0x46 and code[begin + 1].args[1] == 0
        assert view.mn(code[begin + 1].args[0]) == (7, (8, 'pinball.master.runtime:MasterMap'), 'keys')
        block = s.m.asm.assemble([
            ('getlex', helper_q), ('getlocal', table_local), ('getlocal', event_local),
            ('callproperty', q('', 'productIds'), 2),
        ])
        body[5] = replace_span(body[5], begin, end, block)
        assert replace_span(body[5], begin, begin + len(block), code[begin:end]) == before.bodies[bi][5]
        changes.append({'body': bi, 'method': LABELS[bi], 'span': [begin, end],
                        'replacement_instructions': len(block), 'reversible_replacement': True})

    bi = 81189
    assert view.by_label[LABELS[bi]] == [bi] and not a.bodies[bi][6]
    a.bodies[bi][5] = s.m.asm.encode(s.m.asm.assemble([
        ('getlocal_0',), ('pushscope',), ('getlex', helper_q),
        ('findproperty', q('', 'globalLogic')), ('getproperty', q('', 'globalLogic')),
        ('callproperty', q('', 'shopTopExists'), 1), ('convert_b',), ('returnvalue',),
    ]))[0]
    changes.append({'body': bi, 'method': LABELS[bi], 'delegates_to': 'ShopFirstOpen.shopTopExists'})

    bi, begin, end = 72196, 430, 444
    assert view.by_label[LABELS[bi]] == [bi] and not a.bodies[bi][6]
    body = a.bodies[bi]
    code = s.m.asm.decode(body[5])
    assert len(code) == 530 and code[begin].op == 0xd3 and code[end - 1].op == 0xaf
    assert view.mn(code[431].args[0]) == (7, (22, ''), 'getSideStoryEventList')
    assert view.mn(code[438].args[0]) == (7, (22, ''), 'getExchangeableEvents')
    block = s.m.asm.assemble([
        ('getlex', helper_q), ('getlocal_3',),
        ('findproperty', q('', 'globalLogic')), ('getproperty', q('', 'globalLogic')),
        ('callproperty', q('', 'getShopProductRepository'), 0), ('getlocal_2',),
        ('callproperty', q('', 'sideStoryExists'), 3),
    ])
    body[5] = replace_span(body[5], begin, end, block)
    assert replace_span(body[5], begin, begin + len(block), code[begin:end]) == before.bodies[bi][5]
    changes.append({'body': bi, 'method': LABELS[bi], 'span': [begin, end],
                    'replacement_instructions': len(block), 'reversible_replacement': True})

    for change in changes:
        change['check'] = s.m.check_body(a.bodies[change['body']], a)
    for i, body in enumerate(a.bodies):
        if i not in LABELS:
            assert s.m.freeze(body) == s.m.freeze(before.bodies[i]), i
    for field in ('methods', 'instances', 'classes', 'scripts', 'metadata'):
        assert s.m.freeze(getattr(a, field)) == s.m.freeze(getattr(before, field)), field
    for field in ('ints', 'uints', 'doubles', 'strings', 'namespaces', 'ns_sets', 'multinames'):
        old = getattr(before, field)
        assert s.m.freeze(getattr(a, field)[:len(old)]) == s.m.freeze(old), field

    extra = s.helper_abc(helper)
    assert len(extra.instances) == 1 and extra.mn_name(extra.instances[0][0]) == 'cn.shop::ShopFirstOpen'
    for body in extra.bodies:
        s.m.check_body(body, extra)
    payload = main[2] + a.serialize()
    main[1] = struct.pack('<HI', (82 << 6) | 63, len(payload)) + payload
    payload = struct.pack('<I', 1) + b'cn.shop.ShopFirstOpen\0' + extra.serialize()
    extra_tag = struct.pack('<HI', (82 << 6) | 63, len(payload)) + payload
    raw = header + b''.join((extra_tag if t is main else b'') + t[1] for t in tags)
    output.write_bytes(b'CWS' + bytes([version]) + struct.pack('<I', len(raw) + 8) + zlib.compress(raw))

    final_tags = s.parts(output)[2]
    restored = [t for t in final_tags if not (t[0] == 82 and t[2][4:-1] == b'cn.shop.ShopFirstOpen')]
    original_tags = s.parts(source)[2]
    assert len(restored) == len(original_tags)
    assert sum(x[1] != y[1] for x, y in zip(restored, original_tags)) == 1
    final = [t for t in final_tags if t[0] == 82]
    assert len(final) == 292 and final[291][3].serialize() == a.serialize()
    original_main = [t for t in original_tags if t[0] == 82][290][3]
    changed = [i for i in range(len(a.bodies)) if s.m.freeze(a.bodies[i]) != s.m.freeze(original_main.bodies[i])]
    assert set(changed) == set(LABELS) | {67327}, changed
    report = {'parent_swf_sha256': s.sha(source.read_bytes()), 'swf_sha256': s.sha(output.read_bytes()),
              'original_bodies': 96535, 'added_bodies': len(extra.bodies), 'main_abc_index': 291,
              'changed_original_bodies': changed, 'changes': changes, 'awake_callback': awake_report,
              'all_other_original_bodies_unchanged': True, 'existing_class_layouts_unchanged': True,
              'original_pools_preserved': True, 'other_tags_byte_identical': True,
              'dynamic_inventory_and_period_logic_preserved': True, 'device_tested': False}
    output.with_suffix('.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    print(json.dumps(patch(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])), ensure_ascii=False))
