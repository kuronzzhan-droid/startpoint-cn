"""Patch the exact public 8001 APK SWF with independent Rush party sets."""
import copy, json, struct, sys, zlib
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from set_edit_common import JAVA, SDK, dump, run, sha, s  # noqa: E402

INPUT = Path(r'F:\codex\work\independent-formations-20260923\input-direct8001.swf')
INPUT_SHA = '1ed8b35a3776912d69d28a17dc87aab36bb11028a97e990a656fed6e5a95cde1'
OLD_BUILD_ID = 'android-181-abyss-ex-20260917'
BUILD_ID = 'android-181-independent-party-20260923'
ADMISSION_KEYS = Path(r'F:\codex\.codex\secrets\starpoint-client-admission\config\client-admission.keys.json')
WORK = Path(r'F:\codex\work\independent-formations-20260923')
# When this patch is applied after another helper patch in a cumulative build,
# those already-changed method bodies are allowed to remain unchanged by this
# stage's own scope check. Standalone builds keep the default empty set.
PRECHANGED_BODY_IDS = set()


def helper_abc(swc: Path):
    path = swc.with_suffix('.swf')
    import zipfile
    with zipfile.ZipFile(swc) as z:
        path.write_bytes(z.read('library.swf'))
    values = [row[3] for row in s.parts(path)[2] if row[0] == 82]
    assert len(values) == 1
    return values[0]


def serialize(abc, original):
    # Keep empty numeric-pool counts byte-identical to the source ABC.
    def counts(data):
        r = s.m.abcfmt.R(data)
        r.p = 4
        rows = []
        for reader in [r.s32, r.u32, r.d64]:
            at = r.p
            n = r.u30()
            rows.append((at, n))
            for _ in range(max(0, n - 1)):
                reader()
        return rows

    out = bytearray(abc.serialize())
    for (_, old), (at, new) in zip(counts(original), counts(out)):
        if old == 0 and new == 1:
            out[at] = 0
    return bytes(out)


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    source_bytes = INPUT.read_bytes()
    assert sha(source_bytes) == INPUT_SHA
    version, header, tags = s.parts(INPUT)
    main = next(t for t in tags if t[0] == 82 and t[2][4:-1] == b'boot_ffc6')
    a = main[3]
    before = copy.deepcopy(a)
    v = s.m.View(SimpleNamespace(abc=a), s.m.asm)
    pool = s.PoolEditor(a)

    def q(ns, name):
        wanted = (7, (22, ns), name)
        for i in range(1, len(a.multinames)):
            if v.mn(i) == wanted:
                return i
        spaces = [i for i, n in enumerate(a.namespaces)
                  if i and n[0] == 22 and n[1] and a.s(n[1]) == ns]
        if spaces:
            namespace = spaces[0]
        else:
            a.namespaces.append((22, pool.string(ns)))
            namespace = len(a.namespaces) - 1
        a.multinames.append((7, namespace, pool.string(name)))
        return len(a.multinames) - 1

    helper_name = q('cn.mod', 'IndependentRushParty')
    changes = []

    def patch_body(label, rows, expected_old=None, maxstack=4):
        bi, = v.by_label[label]
        body = a.bodies[bi]
        old = bytes(body[5])
        if expected_old is not None:
            assert sha(old) == expected_old, (label, sha(old))
        body[5], _ = s.m.asm.encode(s.m.asm.assemble(rows))
        body[1] = max(body[1], maxstack)
        body[4] = max(body[4], 1)
        s.m.check_body(body, a)
        changes.append({
            'label': label,
            'body': bi,
            'original_sha256': sha(old),
            'patched_sha256': sha(body[5]),
        })

    # The loading task has already parsed the selected event id into local 0.
    # Store it before the party request is created.
    loading = 'pinball.loading.rush::RushEventLoadingTask/summaryRemoteInput|1'
    bi, = v.by_label[loading]
    body = a.bodies[bi]
    rows = v.normalized(bi)[0]
    # The call to eventRushParty is the first interface call with this name.
    call_at = next(i for i, row in enumerate(rows)
                   if row[0] == 79 and row[1][0][-1] == 'eventRushParty')
    block = s.m.asm.assemble([
        ('getlex', helper_name),
        ('getlocal_0',),
        ('getproperty', q('', 'eventId')),
        ('callpropvoid', q('', 'setEventId'), 1),
    ])
    body[5], body[6], _, placed = s.m.asm.splice_many(
        body, [(call_at, block, s.m.asm.ENTER)])
    assert s.m.asm.unsplice_many(body[5], placed) == before.bodies[bi][5]
    body[1] = max(body[1], 3)
    body[4] = max(body[4], 1)
    s.m.check_body(body, a)
    changes.append({'label': loading, 'body': bi, 'insertion_at': call_at,
                    'kind': 'store_event_id', 'reversible': True})

    # Send {event_id: ...} to /event/rush/party while preserving the endpoint.
    patch_body(
        'pinball.remote.event.rush.party::EventRushPartyRealRemote/<ctor>',
        [
            ('getlocal_0',), ('pushscope',),
            ('getlex', q('flash', 'Boot')), ('getproperty', q('', 'skip_constructor')),
            ('iffalse', 'body'), ('returnvoid',),
            ('label', 'body'),
            ('getlocal_0',), ('getlocal_1',), ('constructsuper', 1),
            ('findproperty', q('', 'dispatcher')), ('getlocal_2',),
            ('initproperty', q('', 'dispatcher')),
            ('findproperty', q('', 'startUserRequest')),
            ('pushstring', pool.string('event/rush/party')),
            ('pushstring', pool.string('event_id')),
            ('getlex', helper_name), ('callproperty', q('', 'getEventId'), 0),
            ('newobject', 1),
            ('findproperty', q('', 'successHandler')), ('getproperty', q('', 'successHandler')),
            ('coerce', q('', 'Function')),
            ('callpropvoid', q('', 'startUserRequest'), 3),
            ('returnvoid',),
        ],
        maxstack=5,
    )

    patch_body(
        'pinball.common.data.party.event.rush::RushEventPartyGroupHolder/getPartyCategory|1',
        [('getlex', helper_name), ('callproperty', q('', 'category'), 0), ('returnvalue',)],
        maxstack=2,
    )

    # The party-set editor only has title branches for the original
    # categories 1..4.  Independent Abyss/Fantasy data can arrive as 5..7,
    # and older data can expose a null or another out-of-range value.  The
    # title lookup must never receive that value: keep transport/save
    # categories untouched and use the existing rush-event title only in this
    # UI-only switch.
    edit_label = 'pinball.scene.partyGroupEdit::PartyGroupEditSceneView/refreshPartyCategory|1'
    edit_bi, = v.by_label[edit_label]
    edit_body = a.bodies[edit_bi]
    edit_old = bytes(edit_body[5])
    assert sha(edit_old) == '54859e428a47a505b2ed6b48d65ec8f9a07c0edb2257572d942ced4957aff2fe'
    edit_rows = v.normalized(edit_bi)[0]
    switch_at = next(i for i, row in enumerate(edit_rows) if row[0] == 0x1b)
    map_special_categories = s.m.asm.assemble([
        ('getlocal_1',), ('pushnull',), ('ifstricteq', 'special'),
        ('getlocal_1',), ('pushbyte', 1), ('iflt', 'special'),
        ('getlocal_1',), ('pushbyte', 4), ('ifgt', 'special'),
        ('jump', 'done'),
        ('label', 'special'),
        ('pushbyte', 4), ('setlocal_1',),
        ('label', 'done'),
    ])
    edit_body[5], edit_body[6], _, edit_placed = s.m.asm.splice_many(
        edit_body, [(switch_at, map_special_categories, s.m.asm.ENTER)])
    s.m.check_body(edit_body, a)

    # The default lookup branch used to jump directly to getUiString with
    # local2 still null.  Populate it with the existing rush title as a
    # second guard so a legacy or malformed category cannot reach that call.
    edit_rows_after = v.normalized(edit_bi)[0]
    switch_after = next(i for i, row in enumerate(edit_rows_after) if row[0] == 0x1b)
    default_at = edit_rows_after[switch_after][3]
    assert edit_rows_after[default_at][0] == 0x10
    string_type = q('', 'String')
    fallback_title = s.m.asm.assemble([
        ('pushstring', pool.string('party_group_edit_title_rush_event')),
        ('astype', string_type),
        ('setlocal_2',),
    ])
    edit_body[5], edit_body[6], _, edit_default_placed = s.m.asm.splice_many(
        edit_body, [(default_at, fallback_title, s.m.asm.ENTER)])
    s.m.check_body(edit_body, a)
    changes.append({
        'label': edit_label,
        'body': edit_bi,
        'original_sha256': sha(edit_old),
        'patched_sha256': sha(edit_body[5]),
        'insertion_at': switch_at,
        'kind': 'map_invalid_title_categories_to_rush_event',
        'mapped_categories': ['null', 'out_of_range'],
        'preserved_categories': [1, 2, 3, 4],
        'ui_category': 4,
        'default_title_key': 'party_group_edit_title_rush_event',
        'default_insertion_at': default_at,
        'default_placed': edit_default_placed,
        'reversible': True,
    })

    changed = {item['body'] for item in changes} | set(PRECHANGED_BODY_IDS)
    for i, body in enumerate(a.bodies):
        if i not in changed:
            assert s.m.freeze(body) == s.m.freeze(before.bodies[i]), i
    for field in ('methods', 'instances', 'classes', 'scripts', 'metadata'):
        assert s.m.freeze(getattr(a, field)) == s.m.freeze(getattr(before, field)), field
    for field in ('ints', 'uints', 'doubles', 'strings', 'namespaces', 'ns_sets', 'multinames'):
        prefix = getattr(before, field)
        assert s.m.freeze(getattr(a, field)[:len(prefix)]) == s.m.freeze(prefix), field

    payload = main[2] + serialize(a, main[4])
    main[1] = struct.pack('<HI', (82 << 6) | 63, len(payload)) + payload

    helper_swc = WORK / 'helper.swc'
    compiler = [JAVA, '-Dflexlib=' + str(SDK / 'frameworks'), '-Xmx512m', '-jar', SDK / 'lib/compc-cli.jar',
                '+configname=air', '-swf-version=44', '-target-player=32.0', '-debug=false']
    run([*compiler, '-compiler.source-path=' + str(HERE / 'src'),
         '-include-classes=cn.mod.IndependentRushParty', '-output=' + str(helper_swc)],
        'compile-independent-helper')
    extra = helper_abc(helper_swc)
    assert len(extra.instances) == 1
    assert extra.mn_name(extra.instances[0][0]) == 'cn.mod::IndependentRushParty'
    for body in extra.bodies:
        s.m.check_body(body, extra)
    helper_payload = struct.pack('<I', 1) + b'cn.mod.IndependentRushParty\0' + extra.serialize()
    helper_tag = struct.pack('<HI', (82 << 6) | 63, len(helper_payload)) + helper_payload

    # The admission client signs a compiler-folded proof prefix. Replace both
    # the folded prefix and the standalone BuildConfig id. The key is compiled
    # into the SWF as well, so rotate it together with the new build id; using
    # the old EX key here makes the server reject an otherwise valid candidate.
    old_id = OLD_BUILD_ID.encode()
    new_id = BUILD_ID.encode()
    keys = json.loads(ADMISSION_KEYS.read_text(encoding='utf8'))
    old_key = keys[OLD_BUILD_ID].encode()
    new_key = keys[BUILD_ID].encode()
    assert len(old_key) == len(new_key) == 64
    old_prefix = ('SP-ADMISSION-1\n' + OLD_BUILD_ID + '\n').encode()
    new_prefix = ('SP-ADMISSION-1\n' + BUILD_ID + '\n').encode()
    admission_changes = []
    for tag_index, tag in enumerate(tags):
        if tag[0] != 82 or tag[2][4:-1] not in (b'cn/admission/ClientAdmission', b'cn/admission/BuildConfig'):
            continue
        abc = tag[3]
        replaced = []
        for index, value in enumerate(abc.strings):
            new_value = (
                new_prefix if value == old_prefix
                else new_id if value == old_id
                else new_key if tag[2][4:-1] in (b'cn/admission/ClientAdmission', b'cn/admission/BuildConfig') and value == old_key
                else None
            )
            if new_value is not None:
                abc.strings[index] = new_value
                if value == old_key:
                    replaced.append({'string_index': index, 'kind': 'signing_key_rotated'})
                else:
                    replaced.append({'string_index': index, 'old': value.decode(), 'new': new_value.decode()})
        assert replaced, tag[2][4:-1]
        updated = tag[2] + serialize(abc, tag[4])
        tag[1] = struct.pack('<HI', (82 << 6) | 63, len(updated)) + updated
        admission_changes.append({
            'tag': tag_index,
            'abc': tag[2][4:-1].decode(),
            'changes': replaced,
        })
    assert len(admission_changes) == 2
    assert sum(change.get('kind') == 'signing_key_rotated'
               for item in admission_changes for change in item['changes']) == 2

    raw = header + b''.join((helper_tag if t is main else b'') + t[1] for t in tags)
    output = WORK / 'independent-formations.swf'
    output.write_bytes(b'CWS' + bytes([version]) + struct.pack('<I', len(raw) + 8) + zlib.compress(raw))
    final = s.parts(output)[2]
    assert len([t for t in final if t[0] == 82]) == len([t for t in tags if t[0] == 82]) + 1
    source_main_abc_index = [t for t in tags if t[0] == 82].index(main)
    final_main_abc_index = [t for t in final if t[0] == 82].index(
        next(t for t in final if t[0] == 82 and t[2][4:-1] == b'boot_ffc6'))
    dump(WORK / 'swf-report.json', {
        'input_swf_sha256': INPUT_SHA,
        'output_swf_sha256': sha(output.read_bytes()),
        'source_main_abc_index': source_main_abc_index,
        'final_main_abc_index': final_main_abc_index,
        'source_main_method_bodies': len(before.bodies),
        'helper_methods': len(extra.bodies),
        'admission_build_id': BUILD_ID,
        'previous_admission_build_id': OLD_BUILD_ID,
        'admission_changes': admission_changes,
        'changes': changes,
        'all_other_original_methods_unchanged': True,
        'scope': 'Android independent Rush party-set candidate; no device test',
    })
    print(json.dumps({'swf': str(output), 'sha256': sha(output.read_bytes()), 'changes': changes}, ensure_ascii=False))


if __name__ == '__main__':
    main()
