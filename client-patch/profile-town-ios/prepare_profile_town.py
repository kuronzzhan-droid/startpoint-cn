"""Composable R11 personal-history and town-policy iOS method imports.

Existing native declarations never change. Method IDs resolve by full QName;
new helper IDs are allocated after the caller's current method prefix. The
shared ResponseData constructor is owned by the content-operations recipe.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys
import zipfile

HERE = Path(__file__).resolve().parent
CLIENT = HERE.parent
sys.path[:0] = [str(CLIENT / 'pr43-ios'), str(CLIENT / 'lens0907-0908')]
import prepare_port as common

p = common.p
view = common.view
R11_SWF_SHA256 = '9c672e56e5911679848047daece874e139255b2d128f67ab11e605c5db2bb951'
R11_APK_SHA256 = 'e9b9bbd8a0557a4cfaf6534b0e952caf20d142f5e6702fb2d35a0977f9a871b8'
PROFILE_LABELS = (
    'pinball.common.data.player_history::PlayerHistoryLogic/isWithinPeriod|1',
    'pinball.scene.playerHistory.card::PlayerHistoryCardTopicLogic/getDateValues|1',
    'pinball.scene.playerHistory.card::PlayerHistoryCardTopicView/getDateString|1',
    'pinball.scene.playerProfile::PlayerProfileView/drawPlayerInfoForPlayerHistory|1',
    'pinball.scene.playerHistory.card::PlayerHistoryCardLogic/createShareText|1',
    'pinball.scene.playerHistory.card::PlayerHistoryCardTopicView/complete_mana_board_2|1',
    'pinball.scene.playerHistory.card::PlayerHistoryCardTopicView/defeat_expert_single_boss|1',
)
TOWN_LABELS = ('pinball.common.data.town::TownContentRepository/getTownContentByTime|1',)
RESPONSE_LABEL = 'pinball.remote.common::ResponseData/<ctor>'
POOL_FIELDS = common.POOL_FIELDS
PREFIX_FIELDS = ('methods', 'instances', 'classes', 'scripts', 'metadata', *POOL_FIELDS)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def dump(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + '\n', 'utf8')


def load_r11(path):
    path = Path(path)
    raw = path.read_bytes()
    if path.suffix.lower() == '.apk':
        assert sha(raw) == R11_APK_SHA256, 'R11 APK identity mismatch'
        with zipfile.ZipFile(path) as archive:
            raw = archive.read('assets/worldflipper_android_release.swf')
    assert sha(raw) == R11_SWF_SHA256, 'R11 SWF identity mismatch'
    tags = common.abc_tags(raw)
    main, = [rows[0] for name, rows in tags.items() if name.startswith('boot_') and len(rows) == 1]
    return p.abcfmt.ABC(main), {
        'profile': p.abcfmt.ABC(tags['player_history_permanent'][0]),
        'town': p.abcfmt.ABC(tags['town_theme_login'][0]),
    }, raw


def _constant(v, index, kind):
    fields = {1: 'strings', 3: 'ints', 4: 'uints', 6: 'doubles'}
    if kind in fields:
        return kind, getattr(v.a, fields[kind])[index]
    if kind in (5, 8, 22, 23, 24, 25, 26):
        return kind, v.ns(index)
    return kind, index


def _layout(v, owner):
    ci, = [i for i, row in enumerate(v.a.instances) if v.a.mn_name(row[0]) == owner]
    inst = v.a.instances[ci]
    slots = []
    for trait in inst[6]:
        if trait.data[0] != 'slot':
            continue
        _, slot, typ, default, kind = trait.data
        slots.append((v.mn(trait.name), trait.kind, trait.attr, slot, v.mn(typ),
                      _constant(v, default, kind) if default else None))
    return (v.mn(inst[1]), inst[2], v.ns(inst[3]) if inst[3] is not None else None,
            [v.mn(m) for m in inst[4]], slots)


def _physical_targets(body):
    rows = p.asm.decode(body[5])
    for row in rows:
        targets = ([row.target] if row.target is not None else [])
        targets += ([row.default] + row.cases if row.cases is not None else [])
        for target in targets:
            assert target < len(rows) and rows[target].op == 9, ('target lacks physical label', target)
    return True


def _guard_native(target, donor, label):
    ti, = target.by_label[label]
    si, = donor.by_label[label]
    old, source = target.a.bodies[ti], donor.a.bodies[si]
    assert common.signature(target, old[0]) == common.signature(donor, source[0]), ('signature', label)
    assert p.activation_traits(target, old) == p.activation_traits(donor, source), ('activation', label)
    assert old[3:5] == source[3:5], ('scope', label)
    # These eight R11 methods have no closures or lexical environment access.
    # Future source drift must get a dedicated adapter rather than a silent map.
    assert not any(row.op in (0x40, 0x44, 0x65, 0x67) for row in p.asm.decode(source[5])), ('lexical method', label)
    assert not old[6] and not old[7], ('old native environment', label)
    owner = label.split('/')[0].rstrip('$')
    assert _layout(target, owner) == _layout(donor, owner), ('receiver layout', owner)
    assert old[5] in (b'\x47', b'\x20\x48', b'\x27\x48'), ('unexpected nonstub iOS body', label)
    return ti, si


def _apply(target, donor, helper, *, batch, labels, helper_name, helper_count):
    target = target if hasattr(target, 'a') else view(target)
    donor = donor if hasattr(donor, 'a') else view(donor)
    helper = helper if hasattr(helper, 'a') else view(helper)
    before = copy.deepcopy(target.a)
    before_hash = sha(before.serialize())
    sites = [(label, *_guard_native(target, donor, label)) for label in labels]
    assert len(helper.a.methods) == helper_count == len(helper.a.bodies)
    assert [helper.a.mn_name(row[0]) for row in helper.a.instances] == [helper_name]
    assert helper_name not in {target.a.mn_name(row[0]) for row in target.a.instances}
    first_method = len(target.a.methods)
    merge = common.class_importer()(target, helper)
    merge.merge()
    target = view(target.a)
    # Helper state resides in independent classes. The helper's original
    # method flags, exceptions, own activation traits and CFG are retained.
    helper_records = []
    for label, indices in helper.by_label.items():
        si, = indices
        ti, = target.by_label[label]
        source, body = helper.a.bodies[si], target.a.bodies[ti]
        assert target.normalized(ti) == helper.normalized(si), ('helper body', label)
        assert common.signature(target, body[0]) == common.signature(helper, source[0])
        assert p.activation_traits(target, body) == p.activation_traits(helper, source)
        helper_records.append(dict(label=label, method_id=body[0], source_method=source[0],
                                   validation=common.validate_body(body, target.a)))
    importer = p.Importer(target, donor)
    records = []
    for label, ti, si in sites:
        old = target.a.bodies[ti]
        body = importer.body(si, old[0], scope=old[3])
        assert p.freeze(body[7]) == p.freeze(old[7]), ('activation changed', label)
        assert _physical_targets(body)
        target.a.bodies[ti] = body
        assert target.normalized(ti) == donor.normalized(si), ('body/CFG differs', label)
        records.append(dict(label=label, method_id=old[0], body_index=ti, strategy='replace',
                            before_code_sha256=sha(old[5]), after_code_sha256=sha(body[5]),
                            source_code_sha256=sha(donor.a.bodies[si][5]), source_method=donor.a.bodies[si][0],
                            signature_optional_names_flags_equal=True, activation_equal=True,
                            receiver_layout_equal=True, closure_outer_scope_absent=True,
                            normalized_instructions_cfg_equal=True, physical_targets=True,
                            validation=common.validate_body(body, target.a)))
    changed = {row['method_id'] for row in records}
    for name in PREFIX_FIELDS:
        old = getattr(before, name)
        assert p.freeze(old) == p.freeze(getattr(target.a, name)[:len(old)]), ('prefix changed', name)
    for old, body in zip(before.bodies, target.a.bodies):
        assert old[0] == body[0]
        if old[0] not in changed:
            assert p.freeze(old) == p.freeze(body), ('unrelated body changed', old[0])
    raw = target.a.serialize()
    assert p.abcfmt.ABC(raw).serialize() == raw
    return dict(batch=batch, input_full_abc_sha256=before_hash, full_abc_sha256=sha(raw),
                old_methods=first_method, total_methods=len(target.a.methods), methods=records,
                new_method_ids=list(range(first_method, len(target.a.methods))),
                compiled_helpers=list(range(first_method, len(target.a.methods))),
                helper_records=helper_records, existing_declarations_and_pool_prefix_exact=True,
                unchanged_existing_bodies=len(before.bodies)-len(records),
                device_tested=False, native_executed=False)


def apply_profile(target, donor, helper):
    return _apply(target, donor, helper, batch='personal-history', labels=PROFILE_LABELS,
                  helper_name='cn.profile::PlayerHistoryState', helper_count=7)


def response_capture_contract(target, donor):
    target = target if hasattr(target, 'a') else view(target)
    donor = donor if hasattr(donor, 'a') else view(donor)
    ti, = target.by_label[RESPONSE_LABEL]
    si, = donor.by_label[RESPONSE_LABEL]
    assert target.normalized(ti) == donor.normalized(si), 'operations must import final R11 ResponseData constructor'
    prefix = p.asm.decode(target.a.bodies[ti][5])[:8]
    owners = [target.a.mn_name(row.args[0]) for row in prefix if row.op == 0x60]
    assert owners == ['cn.town::TownThemeState', 'cn.content::ContentOperationsState'], owners
    return dict(label=RESPONSE_LABEL, method_id=target.a.bodies[ti][0],
                normalized_body_exact=True, capture_order=owners)


def insert_town_capture(target, donor):
    """Compose the town capture before operations, retaining its whole parser."""
    target = target if hasattr(target, 'a') else view(target)
    donor = donor if hasattr(donor, 'a') else view(donor)
    ti, = target.by_label[RESPONSE_LABEL]
    si, = donor.by_label[RESPONSE_LABEL]
    before = copy.deepcopy(target.a.bodies[ti])
    source = donor.a.bodies[si]
    assert common.signature(target, before[0]) == common.signature(donor, source[0])
    assert p.activation_traits(target, before) == p.activation_traits(donor, source)
    assert before[3:5] == source[3:5]
    imported = p.Importer(target, donor).body(si, before[0], scope=before[3])
    block = p.asm.decode(imported[5])[2:5]
    assert [row.op for row in block] == [0x60, 0xd1, 0x4f]
    assert target.a.mn_name(block[0].args[0]) == 'cn.town::TownThemeState'
    assert target.a.mn_name(block[2].args[0]) == 'captureResponse' and block[2].args[1] == 1
    body = target.a.bodies[ti]
    body[5], body[6], _ = p.asm.splice(body, 2, block, p.asm.ENTER)
    body[1] = max(before[1], source[1])
    assert p.asm.unsplice(body[5], 2, len(block)) == before[5], 'town capture inverse differs'
    assert target.normalized(ti) == donor.normalized(si), 'prior constructor must be final R11 minus town capture'
    contract = response_capture_contract(target, donor)
    contract.update(strategy='replace', before_code_sha256=sha(before[5]),
                    after_code_sha256=sha(body[5]), inserted_at=2, inserted_instructions=3,
                    inverse_original_code_exact=True, signature_optional_names_flags_equal=True,
                    activation_equal=True, validation=common.validate_body(body, target.a))
    return contract


def apply_town(target, donor, helper, *, require_response=True):
    abc = target.a if hasattr(target, 'a') else target
    input_hash = sha(abc.serialize())
    contract = insert_town_capture(target, donor) if require_response else None
    report = _apply(target, donor, helper, batch='town-theme', labels=TOWN_LABELS,
                    helper_name='cn.town::TownThemeState', helper_count=10)
    report['response_capture'] = contract
    if contract:
        report['input_full_abc_sha256'] = input_hash
        report['methods'].append(contract)
        report['unchanged_existing_bodies'] -= 1
    report['requires_operations_response_hook'] = contract is None
    report['native_player_bgm_getter_changed'] = False
    return report


def run(base, expected_sha256, donor_path, output, *, batch, require_response=True):
    base, output = Path(base), Path(output)
    raw = base.read_bytes()
    assert sha(raw) == expected_sha256, 'explicit base ABC identity mismatch'
    assert not output.exists(), 'fresh stage directory required'
    target = p.abcfmt.ABC(raw)
    donor, helpers, _ = load_r11(donor_path)
    report = (apply_profile(target, donor, helpers['profile']) if batch == 'profile'
              else apply_town(target, donor, helpers['town'], require_response=require_response))
    output.mkdir(parents=True)
    full = target.serialize()
    (output / 'full.abc').write_bytes(full)
    report.update(full_abc_file='full.abc', source_full_abc=str(base.resolve()),
                  donor_swf_sha256=R11_SWF_SHA256, full_abc_sha1=hashlib.sha1(full).hexdigest(),
                  status='prepared_requires_aot_compile_and_link')
    dump(output / 'port.json', report)
    print(json.dumps({k: report[k] for k in ('batch','old_methods','total_methods','full_abc_sha256')}))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--base-sha256', required=True)
    parser.add_argument('--r11', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--batch', choices=('profile','town'), required=True)
    parser.add_argument('--allow-missing-response-for-isolated-compile', action='store_true')
    args = parser.parse_args()
    run(args.base, args.base_sha256, args.r11, args.out, batch=args.batch,
        require_response=not args.allow_missing_response_for_isolated_compile)


if __name__ == '__main__':
    main()
