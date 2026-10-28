"""C24: rooms in which no member carries P2 riven context start as plain rooms.

Root cause (C22, carried unchanged through round2/C23): the inline C22 validator in
MultiBattleRoomScene/serverMessage_Mates runs on every Mates packet. With
has_context == false it still fail-closes on per-slot riven rules:
  * a human slot holding a revealed instance (16000001..16000999, not 16000900):
    `getlocal has_context; iffalse fail`;
  * a COM slot holding 16000000 or an instance, or a COM party carrying weapon_rivens.
The fail branch sends `WFR2|N|invalid|invalid_snapshot`, shows 「裂罅快照同步失败，请重新准备。」
and `returnvoid`s before the native refreshMates, so on a server without riven support
(COM parties are cloned from the host / NPC pool, no context fields) the recruited COMs
never join. serverMessage_Start, MultiQuestStartLoadingTask/remoteFinishedHandler and the
two restore checks have the same strictness for instances.

C24 (single-method inserts only, no new methods / traits):
  * Mates / Start: a prefix scans the received roster. If every member party has all five
    P2 context fields == null, the room is a no-context room: weapon_rivens rows are
    nulled on every member (riven effects disabled for everybody, deterministically), the
    real roster is parked in a fresh local, and C22 validates a one-member sentinel roster
    without any riven data, so it takes its own legacy branch (has_context false ->
    original). A block at the native entry restores the real roster before the original
    code runs. No ACK, no NACK, no notice.
  * remoteFinishedHandler: same scan on C22's own roster local; rows nulled on this.mates
    (the objects the native BattleSource constructors read), C22 validates the sentinel,
    so loading only additionally requires that no committed snapshot exists (unchanged).
  * readString / restoreInput: a revealed instance id alone no longer marks a header as
    P2 (context fields and non-None rows still do); such headers keep the native path,
    and the consumer returns None for the instance because there is no row.
  * Catalog: when the first human's enabled catalog differs from the build constant,
    Mates / Start NACK with reason `catalog` instead of `invalid_snapshot`
    (`WFR2|N|<snapshotId>|catalog`, existing NACK grammar).
Everything else (partial context, mismatched snapshot/mode/reason, malformed rows, COM
with context, stale pending/committed) still reaches the unchanged C22 reject paths.
"""
import c24_paths  # noqa: F401
import asm

DYN = 14
OPTION = 'haxe.ds::Option'
CONTEXT_FIELDS = ('weapon_riven_scope', 'weapon_riven_snapshot_id', 'weapon_riven_mode',
                  'weapon_riven_catalog', 'weapon_riven_reason')
SLOT_FIELDS = ('characters', 'unison_characters', 'equipments', 'abilitySoulIds')
MATES = 'MultiBattleRoomScene/serverMessage_Mates'
START = 'MultiBattleRoomScene/serverMessage_Start'
LOAD = 'MultiQuestStartLoadingTask/remoteFinishedHandler'
READ = 'BattleHeaderReadRestore$/readString'
RESTORE = 'SingleBattleRestoreLoadingTask/restoreInput'
NACK_REASON = '|invalid_snapshot'
CATALOG_REASON = '|catalog'
SENTINEL_CONNECTION = 'invalid'      # existing pool string; the sentinel never reaches the wire


def g(n):
    return ('getlocal', n)


def p(n):
    return ('setlocal', n)


class Site:
    def __init__(self, e, label):
        self.e, self.label = e, label
        self.body = e.body(label)
        self.ops = asm.decode(self.body[5])

    def s(self, i):
        op = self.ops[i]
        return self.e.abc.strings[op.args[0]].decode('utf-8', 'replace') if op.name == 'pushstring' else None

    def mn(self, i):
        return str(self.e.abc.mn_name(self.ops[i].args[0]))


def fresh(e, label, count):
    used = e.__dict__.setdefault('_c24_locals', {})
    start = used.get(label, e.body(label)[2])
    used[label] = start + count
    return list(range(start, start + count))


def dyn(e, key):
    return [e.string(key), ('getproperty', DYN)]


def scan(e, roster, i, scratch, tag, legacy):
    """Jump to `legacy` when roster is an Array and no member party has any P2 context
    field; otherwise fall to END (C22 validates the real roster, unchanged)."""
    loop, nxt = tag + '_scan', tag + '_scan_next'
    code = [g(roster), ('istype', e.q('Array')), ('iffalse', 'END'),
            ('pushbyte', 0), p(i), ('label', loop), ('avm_label',),
            g(i), g(roster), *dyn(e, 'length'), ('ifge', legacy),
            g(roster), g(i), ('getproperty', DYN), p(scratch), g(scratch), ('iffalse', nxt),
            g(scratch), *dyn(e, 'party'), p(scratch), g(scratch), ('iffalse', nxt)]
    for field in CONTEXT_FIELDS:
        code += [g(scratch), *dyn(e, field), ('pushnull',), ('ifne', 'END')]
    code += [('label', nxt), ('inclocal_i', i), ('jump', loop)]
    return code


def strip(e, roster, i, scratch, tag):
    """party.weapon_rivens = null on every member that has the field (riven effects off)."""
    loop, nxt, done = tag + '_strip', tag + '_strip_next', tag + '_strip_done'
    return [('pushbyte', 0), p(i), ('label', loop), ('avm_label',),
            g(i), g(roster), *dyn(e, 'length'), ('ifge', done),
            g(roster), g(i), ('getproperty', DYN), p(scratch), g(scratch), ('iffalse', nxt),
            g(scratch), *dyn(e, 'party'), p(scratch), g(scratch), ('iffalse', nxt),
            e.string('weapon_rivens'), g(scratch), ('in',), ('iffalse', nxt),
            g(scratch), e.string('weapon_rivens'), ('pushnull',), ('setproperty', DYN),
            ('label', nxt), ('inclocal_i', i), ('jump', loop), ('label', done)]


def sentinel(e):
    """[{connectionId, viewerId: 1, party: {four 3-slot Option.None arrays}}]: no comId,
    no context, no weapon_rivens -> C22's own legacy (has_context == false) branch."""
    none = [('getlex', e.q(OPTION)), ('getproperty', e.q('None'))]
    code = [e.string('connectionId'), e.string(SENTINEL_CONNECTION),
            e.string('viewerId'), ('pushbyte', 1), e.string('party')]
    for field in SLOT_FIELDS:
        code += [e.string(field), *none, *none, *none, ('newarray', 3)]
    return code + [('newobject', len(SLOT_FIELDS)), ('newobject', 3), ('newarray', 1)]


def native_entry(site):
    """End of the closed C22 prefix: first T > 2 with ops[T-1] == returnvoid, every branch
    before T targeting <= T (at least one == T) and every branch from T on targeting >= T."""
    ops = site.ops
    targets = lambda op: ([op.target] if op.target is not None else []) + (
        [op.default, *op.cases] if op.cases is not None else [])
    for t in range(3, len(ops)):
        if ops[t - 1].name != 'returnvoid':
            continue
        before = [x for op in ops[:t] for x in targets(op)]
        after = [x for op in ops[t:] for x in targets(op)]
        if before and max(before) == t and all(x >= t for x in after):
            return t
    raise asm.AsmError('C22 prefix / native split not found: ' + site.label)


def c22_prefix_start(site):
    ops = site.ops
    assert [x.name for x in ops[:2]] == ['getlocal_0', 'pushscope'], site.label
    assert ops[2].name == 'pushstring' and site.s(2) == 'invalid' and ops[3].name == 'setlocal', site.label
    return 2


def catalog_sites(site, end):
    """[getlocal CAT, pushstring <id>, (pop, pushstring <new id>)?, ifne fail] in C22 code."""
    out = []
    for i in range(end):
        op = site.ops[i]
        if op.name != 'ifne' or not (site.s(i - 1) or '').startswith('riven-multi-v1-'):
            continue
        at = i - 2
        if site.ops[i - 2].name == 'pop':
            assert (site.s(i - 3) or '').startswith('riven-multi-v1-'), site.label
            at = i - 4
        assert site.ops[at].name == 'getlocal', (site.label, i)
        out.append((at, site.ops[at].args[0], site.ops[i - 1].args[0], op.target))
    return out


def nack_sites(site, end):
    out = [i + 1 for i in range(end) if site.s(i) == NACK_REASON]
    for i in out:
        assert site.ops[i].name == 'add' and site.s(i - 4) == 'WFR2|N|', (site.label, i)
    return out


def queue_room(q, label):
    e, site = q.e, Site(q.e, label)
    start = c22_prefix_start(site)
    entry = native_entry(site)
    roster = 1
    saved, catflag, i, scratch = fresh(e, label, 4)
    tag = 'c24_' + label.split('_')[-1].lower()
    legacy = tag + '_legacy'
    code = [('pushnull',), p(saved), ('pushfalse',), p(catflag),
            *scan(e, roster, i, scratch, tag, legacy), ('label', legacy),
            *strip(e, roster, i, scratch, tag), g(roster), p(saved),
            *sentinel(e), ('coerce', e.q('Array')), p(roster)]
    q.add('no_context', label, start, code, asm.FORBID, 'no-context room: strip rows, park roster, sentinel')
    cats = catalog_sites(site, entry)
    assert len(cats) == 1, (label, cats)
    cat_at, cat_local, cat_string, fail = cats[0]
    q.add('catalog_reason', label, cat_at,
          [g(cat_local), ('pushstring', cat_string), ('ifeq', 'END'), ('pushtrue',), p(catflag)],
          asm.FORBID, 'flag a first-human catalog mismatch before the C22 check')
    nacks = nack_sites(site, entry)
    assert len(nacks) == (2 if label == MATES else 1), (label, nacks)
    for at in nacks:
        q.add('catalog_reason', label, at,
              [g(catflag), ('iffalse', 'END'), ('pop',), e.string(CATALOG_REASON)],
              asm.FORBID, 'NACK reason catalog when flagged')
    q.add('no_context', label, entry,
          [g(saved), ('iffalse', 'END'), g(saved), ('coerce', e.q('Array')), p(roster),
           ('pushnull',), p(saved)],
          asm.ENTER, 'native entry: restore the real (row-stripped) roster')
    return {'c22_prefix_start': start, 'native_entry': entry, 'locals': [saved, catflag, i, scratch],
            'catalog_check_at': cat_at, 'catalog_fail_target': fail,
            'nack_reason_sites': nacks}


def queue_load(q):
    e, site = q.e, Site(q.e, LOAD)
    ops = site.ops
    assert [x.name for x in ops[:5]] == ['getlocal_0', 'pushscope', 'getlocal_0', 'getproperty', 'setlocal']
    assert site.mn(3) == 'mates' and site.s(5) == 'invalid', LOAD
    roster = ops[4].args[0]
    i, scratch = fresh(e, LOAD, 2)
    legacy = 'c24_load_legacy'
    code = [*scan(e, roster, i, scratch, 'c24_load', legacy), ('label', legacy),
            *strip(e, roster, i, scratch, 'c24_load'), *sentinel(e), p(roster)]
    q.add('no_context', LOAD, 5, code, asm.FORBID,
          'no-context loading: null rows on this.mates, C22 validates the sentinel')
    return {'at': 5, 'roster_local': roster, 'locals': [i, scratch]}


def queue_restore(q, label):
    site = Site(q.e, label)
    hits = [i for i in range(len(site.ops)) if site.s(i) == '16000900'
            and site.ops[i + 1].name == 'convert_i' and site.ops[i + 2].name == 'ifne']
    assert len(hits) == 1, (label, hits)
    at = hits[0] + 2
    assert site.ops[hits[0] - 1].name == 'getlocal', label
    q.add('no_context', label, at, [('pop',), ('dup',)], asm.FORBID,
          'revealed instance alone no longer marks the header as P2 (context / rows still do)')
    return {'at': at, 'trigger_target': site.ops[at].target}


def queue_all(q):
    return {MATES: queue_room(q, MATES), START: queue_room(q, START), LOAD: queue_load(q),
            READ: queue_restore(q, READ), RESTORE: queue_restore(q, RESTORE)}
