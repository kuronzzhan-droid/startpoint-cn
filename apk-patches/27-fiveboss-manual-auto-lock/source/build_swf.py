"""Cumulative Android method graft. Input and donor identities are pinned.

Only named methods/traits are imported, with append-only pools and relocated
branches. Insertion-only methods must retain every original instruction and
control-flow destination after the new instructions are collapsed.
"""
from __future__ import annotations
import argparse
import copy
import difflib
import hashlib
import json
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path[:0] = [str(HERE / 'vendor/abcasm'), str(REPO / 'tools/lens-integration')]
import asm
from swfabc import SwfAbc, abcfmt
from compare_clients import View, MULTINAME_OPS

# AVM2 debug/debugline/debugfile do not consume or produce stack operands.
# The donor assembler only needed gameplay opcodes in its original patches.
asm._POP_PUSH.update({0xef: (0, 0), 0xf0: (0, 0), 0xf1: (0, 0)})


def sha(data): return hashlib.sha256(data).hexdigest()
def freeze(value):
    if isinstance(value, abcfmt.Trait):
        return tuple((key, freeze(getattr(value, key))) for key in value.__slots__)
    if isinstance(value, (list, tuple)): return tuple(map(freeze, value))
    return value


def reachable(rows, exceptions):
    pending = [0] + [e[2] for e in exceptions]
    visited = set()
    while pending:
        i = pending.pop()
        if i in visited or i == len(rows): continue
        assert 0 <= i < len(rows)
        visited.add(i)
        op, _, target, default, cases = rows[i]
        if op in (3, 0x47, 0x48): continue
        if op == 0x10: pending.append(target)
        elif op == 0x1b: pending.extend([default, *cases])
        elif op in asm.CONDITIONAL_BRANCHES: pending.extend([i+1, target])
        else: pending.append(i+1)
    return visited


def insertion_proof(a, b, spans=None):
    """Prove the new body adds nodes without replacing old operations/edges."""
    left, le = a
    right, re = b
    live_left, live_right = reachable(left, le), reachable(right, re)
    token = lambda rows: [freeze(r[:2]) for r in rows]
    if spans is None:
        ops = difflib.SequenceMatcher(None, token(left), token(right), autojunk=False).get_opcodes()
    else:
        ops, ai, bi = [], 0, 0
        for span in spans:
            at, count = span['at'], span['instructions']
            end = bi + at-ai
            assert token(left[ai:at]) == token(right[bi:end])
            ops.extend([('equal', ai, at, bi, end), ('insert', at, at, end, end+count)])
            ai, bi = at, end+count
        assert token(left[ai:]) == token(right[bi:])
        ops.append(('equal', ai, len(left), bi, len(right)))
    assert all(tag in ('equal', 'insert') for tag, *_ in ops), 'non-insertion change'
    collapse, equal = {len(right): len(left)}, []
    edits = []
    for tag, i, j, k, l in ops:
        if tag == 'equal':
            for ai, bi in zip(range(i, j), range(k, l)):
                collapse[bi] = ai
                equal.append((ai, bi))
        else:
            for bi in range(k, l): collapse[bi] = i
            edits.append({'at': i, 'instructions': l-k})
    for ai, bi in equal:
        for field in (2, 3):
            target = right[bi][field]
            if left[ai][field] != (collapse[target] if target is not None else None):
                # Earlier FFDec passes canonicalized jumps after return/throw.
                # Permit only branches unreachable in BOTH complete CFGs.
                assert ai not in live_left and bi not in live_right, ('live branch changed', ai, bi)
        targets = right[bi][4]
        assert left[ai][4] == ([collapse[t] for t in targets] if targets is not None else None), 'old switch changed'
    collapsed_ex = [(collapse[e[0]], collapse[e[1]], collapse[e[2]], e[3], e[4]) for e in re]
    assert le == collapsed_ex, 'exception scope changed'
    return edits


class Importer:
    def __init__(self, target, source):
        self.target, self.source = target, source
        self.a, self.b = target.a, source.a
        self.cache = {}
        target_methods = {label: i for i, label in target.labels.items()}
        self.methods = {i: target_methods.get(label) for i, label in source.labels.items()}
        self.method_changes = []
        self.pool_indices = {}

    def append(self, pool, value):
        rows = getattr(self.a, pool)
        key = lambda x: struct.pack('<d', x) if pool == 'doubles' else freeze(x)
        candidate = key(value)
        if pool not in self.pool_indices:
            index = {}
            # Index zero is a reserved sentinel, not an ordinary constant.
            # In particular the parser's empty string / 0.0 placeholders must
            # never swallow a real empty-string default or numeric zero.
            for i, v in enumerate(rows[1:], 1): index.setdefault(key(v), i)
            self.pool_indices[pool] = index
        index = self.pool_indices[pool]
        if candidate in index: return index[candidate]
        rows.append(value)
        index[candidate] = len(rows)-1
        return len(rows)-1

    def pool(self, pool, index):
        if index == 0: return 0
        key = pool, index
        if key in self.cache: return self.cache[key]
        row = getattr(self.b, pool)[index]
        if pool == 'namespaces':
            row = (row[0], self.pool('strings', row[1]))
            if row[0] == 5:
                matches = [i for i, n in enumerate(self.a.namespaces) if n == row]
                assert len(matches) <= 1, 'ambiguous private namespace'
        elif pool == 'ns_sets': row = tuple(self.pool('namespaces', i) for i in row)
        elif pool == 'multinames':
            k = row[0]
            if k in (7, 13): row = (k, self.pool('namespaces', row[1]), self.pool('strings', row[2]))
            elif k in (9, 14): row = (k, self.pool('strings', row[1]), self.pool('ns_sets', row[2]))
            elif k in (15, 16): row = (k, self.pool('strings', row[1]))
            elif k in (27, 28): row = (k, self.pool('ns_sets', row[1]))
            elif k == 29: row = (k, self.pool('multinames', row[1]), tuple(self.pool('multinames', i) for i in row[2]))
            else: assert k in (17, 18), row
        result = self.append(pool, row)
        self.cache[key] = result
        return result

    def constant(self, index, kind):
        pools = {1: 'strings', 3: 'ints', 4: 'uints', 6: 'doubles',
                 5: 'namespaces', 8: 'namespaces', 22: 'namespaces', 23: 'namespaces',
                 24: 'namespaces', 25: 'namespaces', 26: 'namespaces'}
        return self.pool(pools[kind], index) if kind in pools else index

    def info(self, mid):
        ret, types, name, flags, options, names = self.b.methods[mid]
        return [self.pool('multinames', ret), [self.pool('multinames', i) for i in types],
                self.pool('strings', name), flags,
                [(self.constant(v, k), k) for v, k in options] if options is not None else None,
                [self.pool('strings', i) for i in names] if names is not None else None]

    def body(self, source_body, target_mid, scope=None):
        old = self.b.bodies[source_body]
        instructions = asm.decode(old[5])
        original, old_offsets = asm.encode(instructions)
        assert original == old[5]
        for ins in instructions:
            op, args = ins.op, ins.args
            if op in MULTINAME_OPS: args[0] = self.pool('multinames', args[0])
            elif op in (0x2c, 0x06, 0xf1): args[0] = self.pool('strings', args[0])
            elif op in (0x2d, 0x2e, 0x2f): args[0] = self.pool({0x2d:'ints', 0x2e:'uints', 0x2f:'doubles'}[op], args[0])
            elif op == 0x31: args[0] = self.pool('namespaces', args[0])
            elif op in (0x40, 0x44):
                assert self.methods.get(args[0]) is not None, f'unmapped method {args[0]}'
                args[0] = self.methods[args[0]]
            elif op == 0x58:
                name = self.source.mn(self.b.instances[args[0]][0])
                matches = [i for i, row in enumerate(self.a.instances) if self.target.mn(row[0]) == name]
                assert len(matches) == 1
                args[0] = matches[0]
            elif op == 0xef: args[1] = self.pool('strings', args[1])
            elif op in (0x43, 0x4b, 0x4d): raise ValueError('unaudited dispatch opcode')
            if scope is not None and scope != old[3]:
                assert op not in (0x65, 0x67, 0x40), 'lexical scope index needs a dedicated adapter'
        code, offsets = asm.encode(instructions)
        old_offsets.append(len(old[5])); offsets.append(len(code))
        locations = dict(zip(old_offsets, offsets))
        exceptions = [(locations[a], locations[b], locations[c], self.pool('multinames', d), self.pool('multinames', e))
                      for a, b, c, d, e in old[6]]
        init = old[3] if scope is None else scope
        return [target_mid, old[1], old[2], init, old[4] + init-old[3], code, exceptions,
                [self.trait(t, append=False) for t in old[7]]]

    def trait(self, old, append=True):
        t = copy.deepcopy(old)
        assert not t.metadata, 'unexpected trait metadata'
        t.name = self.pool('multinames', t.name)
        if t.data[0] == 'slot':
            if append: t.data[1] = 0  # preserve activation slot IDs; append class slots
            t.data[2] = self.pool('multinames', t.data[2])
            if t.data[3]: t.data[3] = self.constant(t.data[3], t.data[4])
        else:
            assert t.data[0] == 'method'
            if append: t.data[1] = 0
            t.data[2] = self.methods[t.data[2]]
        return t


def check_body(body, abc):
    instructions = asm.decode(body[5])
    encoded, offsets = asm.encode(instructions)
    assert encoded == body[5]
    at = {offset: i for i, offset in enumerate(offsets)}
    stack, scope, dead = asm.simulate(instructions, body[3], abc.multinames,
                                     exception_targets=[at[e[2]] for e in body[6]])
    assert stack <= body[1], (stack, body[1])
    assert scope <= body[4], (scope, body[4])
    assert asm.block_locals(instructions) <= body[2]
    return {'max_stack': stack, 'max_scope': scope, 'unreachable_instructions': dead}


def activation_traits(view, body):
    result = []
    for t in body[7]:
        # Insertion-only native methods keep their existing closure layout.
        assert t.data[0] == 'slot' and t.data[3] == 0 and not t.metadata
        result.append((view.mn(t.name), t.kind, t.attr, t.data[1], view.mn(t.data[2])))
    return result


def own_lock(target):
    abc = target.a
    def q(name, namespace=''):
        matches = [i for i, n in enumerate(abc.multinames)
                   if n[0] == 7 and abc.s(n[2]) == name and abc.namespaces[n[1]][0] == 22
                   and abc.ns_name(n[1]) == namespace]
        assert matches, (namespace, name)
        # Public package QNames with duplicate pool entries denote the same
        # property; unlike private namespaces they have no distinct identity.
        return matches[0]
    def integer(v):
        if v not in abc.ints: abc.ints.append(v)
        return abc.ints.index(v)
    def string(s):
        if s.encode() not in abc.strings: abc.strings.append(s.encode())
        return abc.strings.index(s.encode())
    lock = q('fiveBossManualAutoLock')
    quest = q('questId')
    tools = q('QuestIdBattleKindTools', 'pinball.common.data.quest.id')
    any_id = q('toAnyQuestId')
    changes = []
    def splice(label, index, source, policy=asm.ENTER):
        bi = target.by_label[label][0]
        body = abc.bodies[bi]
        block = asm.assemble(source)
        before = body[5]
        code, ex, instructions = asm.splice(body, index, block, policy)
        assert asm.unsplice(code, index, len(block)) == before, label
        body[5], body[6] = code, ex
        stack, scope, _ = asm.simulate(instructions, body[3], abc.multinames)
        body[1] = max(body[1], stack); body[4] = max(body[4], scope)
        changes.append({'label': label, 'at': index, 'instructions': len(block), 'reversible': True})
    init = [('getlocal_0',), ('pushfalse',), ('setproperty', lock),
            ('getlocal_0',), ('getproperty', quest), ('getproperty', q('index')), ('pushbyte', 1), ('ifne', 'END')]
    for op, limit in [('iflt', 1099001), ('ifgt', 1099003)]:
        init += [('getlex', tools), ('getlocal_0',), ('getproperty', quest), ('callproperty', any_id, 1),
                 ('pushint', integer(limit)), (op, 'END')]
    init += [('getlocal_0',), ('getlocal_0',), ('getproperty', q('myBattle')),
             ('getproperty', q('autoplayData')), ('getproperty', q('autoButtonMode')), ('not',),
             ('setproperty', lock), ('label', 'END')]
    label = 'pinball.scene.battle::BattleScene/preparation|1'
    original = asm.decode(abc.bodies[target.by_label[label][0]][5])
    locations = [i-3 for i, ins in enumerate(original) if ins.op == 0x66 and ins.args == [q('autoButtonMode')]]
    assert locations == [1257], locations
    splice(label, locations[0], init)
    guard = [('getlocal_1',), ('iffalse', 'END'), ('getlocal_0',), ('getproperty', lock), ('iffalse', 'END'),
             ('getlocal_0',), ('getlocal_0',), ('getproperty', q('logic')), ('getproperty', q('asset')),
             ('pushstring', string('system_lock_auto_play')), ('callproperty', q('getUiString'), 1),
             ('getlex', q('InstantMessagePosition', 'pinball.context.scene.instantMessage')),
             ('getproperty', q('Center')), ('callpropvoid', q('showInstantMessage'), 2), ('returnvoid',), ('label', 'END')]
    splice('pinball.scene.battle::BattleScene/changeAutoplayMode|1', 2, guard)
    label = 'pinball.dialog.battlePauseMenu::BattlePauseMenu/prepare|1'
    original = asm.decode(abc.bodies[target.by_label[label][0]][5])
    locations = [i for i, ins in enumerate(original) if ins.op == 0x68 and ins.args == [q('isLocked')]]
    assert locations == [181, 202], locations
    splice(label, locations[0], [('dup',), ('iftrue', 'END'), ('pop',), ('getlocal_0',),
                                ('getproperty', q('battleScene')), ('getproperty', lock), ('label', 'END')])
    return changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--donor', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    registry = json.loads((REPO / 'client-patch/android-accepted.json').read_text('utf-8-sig'))
    assert sha(args.base.read_bytes()) in {v['swf_sha256'] for v in registry['variants'].values()}
    assert not args.out.exists(), 'output must be new'
    plan = json.loads((HERE / 'method-plan.json').read_text('utf-8'))
    assert sha(args.donor.read_bytes()) == plan['donor_swf_sha256']
    target = View(SwfAbc(args.base), asm); source = View(SwfAbc(args.donor), asm)
    baseline = copy.deepcopy(target.a)
    importer = Importer(target, source)
    report, changed = [], set()
    for row in plan['new_methods']:
        label = row['label']; assert label not in target.by_label
        mid = source.a.bodies[source.by_label[label][0]][0]
        importer.methods[mid] = len(target.a.methods)
        target.a.methods.append(importer.info(mid))
    traits = {
        'pinball.scene.battle::BattleScene': ['fiveBossManualAutoLock'],
        'pinball.scene.battle.battle.squad.ball::BallImpl': ['kyubiPowerFlipInitialCombo'],
        'pinball.scene.battle.battle.ability::BattleAbilityTotalizerImpl': ['duringDashParameters', 'getTotalDashParameter'],
        'pinball.scene.battle.battle::BothBossTool$': [r['label'].split('/')[-1].split('|')[0]
            for r in plan['new_methods'] if 'BothBossTool$/' in r['label']],
    }
    for name, names in traits.items():
        static = name.endswith('$'); owner = name.rstrip('$')
        ai = next(i for i, v in enumerate(target.a.instances) if target.a.mn_name(v[0]) == owner)
        bi = next(i for i, v in enumerate(source.a.instances) if source.a.mn_name(v[0]) == owner)
        left = target.a.classes[ai][1] if static else target.a.instances[ai][6]
        right = source.a.classes[bi][1] if static else source.a.instances[bi][6]
        for trait_name in names:
            assert not any(target.a.mn_name(t.name) == trait_name for t in left)
            matches = [t for t in right if source.a.mn_name(t.name) == trait_name]
            assert len(matches) == 1, (name, trait_name)
            left.append(importer.trait(matches[0]))
    for row in plan['new_methods']:
        bi = source.by_label[row['label']][0]; mid = source.a.bodies[bi][0]
        body = importer.body(bi, importer.methods[mid], scope=1)
        target.a.bodies.append(body); changed.add(body[0])
        report.append({'label': row['label'], 'kind': 'new', 'checks': check_body(body, target.a)})
        print('added', row['label'], flush=True)
    for key in ('insert_only_methods', 'replace_methods'):
        for row in plan[key]:
            label = row['label']; ai = target.by_label[label][0]; bi = source.by_label[label][0]
            a, b = target.a.bodies[ai], source.a.bodies[bi]
            assert sha(a[5]) == row['accepted_code_sha256'], label
            assert sha(b[5]) == row['donor_code_sha256'], label
            try:
                proof = insertion_proof(target.normalized(ai), source.normalized(bi), row['insertions']) if key == 'insert_only_methods' else None
            except AssertionError as error: raise AssertionError((label, str(error))) from error
            body = importer.body(bi, a[0], scope=a[3])
            if key == 'replace_methods':
                # bothBossMap adds one room-number argument; only these three
                # method signatures may be aligned with their imported code.
                target.a.methods[a[0]] = importer.info(b[0])
            else:
                info = importer.info(b[0]); before_info = target.a.methods[a[0]]
                assert target.mn(info[0]) == target.mn(before_info[0]), label
                assert [target.mn(i) for i in info[1]] == [target.mn(i) for i in before_info[1]], label
                assert info[3:] == before_info[3:], (label, info, before_info)
                assert activation_traits(target, a) == activation_traits(target, body), label
            target.a.bodies[ai] = body; changed.add(body[0])
            report.append({'label': label, 'kind': key, 'insertions': proof, 'checks': check_body(body, target.a)})
            print('verified', label, flush=True)
    locks = own_lock(target)
    for row in locks:
        body = target.a.bodies[target.by_label[row['label']][0]]
        changed.add(body[0]); row['checks'] = check_body(body, target.a)
    # All existing pools and all unrelated methods stay byte-identical.
    for pool in ('ints', 'uints', 'doubles', 'strings', 'namespaces', 'ns_sets', 'multinames'):
        old, new = getattr(baseline, pool), getattr(target.a, pool)
        assert new[:len(old)] == old, f'pool prefix changed: {pool}'
    for old, new in zip(baseline.bodies, target.a.bodies):
        if old[0] not in changed: assert freeze(old) == freeze(new), f'unrelated method changed {old[0]}'
    assert baseline.metadata == target.a.metadata
    assert len(baseline.instances) == len(target.a.instances)
    assert freeze(baseline.scripts) == freeze(target.a.scripts)
    for old, new in zip(baseline.instances, target.a.instances):
        assert old[:6] == new[:6]
        assert freeze(old[6]) == freeze(new[6][:len(old[6])])
    for old, new in zip(baseline.classes, target.a.classes):
        assert old[0] == new[0]
        assert freeze(old[1]) == freeze(new[1][:len(old[1])])
    signature_changes = {target.a.bodies[target.by_label[r['label']][0]][0] for r in plan['replace_methods']}
    for i, old in enumerate(baseline.methods):
        if i not in signature_changes: assert old == target.a.methods[i]
    target.swf.save(args.out)
    readback = View(SwfAbc(args.out), asm)
    for row in report:
        label = row['label']; ri = readback.by_label[label][0]; si = source.by_label[label][0]
        assert readback.normalized(ri) == source.normalized(si), f'body readback differs: {label}'
    # Non-main ABC tags, images and SWF metadata must remain identical.
    before = target.swf
    after = readback.swf
    assert before.body[:before._offset] == after.body[:after._offset]
    assert before.body[before._offset+before._length:] == after.body[after._offset+after._length:]
    result = {'status': 'static_candidate_pending_device_and_content_validation',
        'base_swf_sha256': sha(args.base.read_bytes()), 'donor_swf_sha256': plan['donor_swf_sha256'],
        'swf_sha256': sha(args.out.read_bytes()), 'methods': report, 'auto_lock': locks,
        'added_traits': traits, 'changed_existing_bodies': len(changed)-len(plan['new_methods']),
        'added_bodies': len(plan['new_methods']), 'unrelated_body_count': len(baseline.bodies)-len(changed)+len(plan['new_methods']),
        'existing_pools_preserved': True, 'non_main_abc_tags_preserved': True}
    args.out.with_suffix('.report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', 'utf-8')
    print(json.dumps({k:v for k,v in result.items() if k not in ('methods','auto_lock','added_traits')},ensure_ascii=False))


if __name__ == '__main__': main()
