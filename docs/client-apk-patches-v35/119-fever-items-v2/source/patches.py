"""Replayable v34 -> Fever items v2 instruction splices."""
from __future__ import annotations
import copy
import hashlib
from .helpers import add_helpers, old
import asm
import bodies


def recover_original(abc, item):
    """Remove exactly the archived B1/B2/B3/B5 blocks and verify donor SHA."""
    b = copy.deepcopy(abc.bodies[bodies.resolve(abc, item['label'])])
    m = old.names(abc)
    n = len(asm.decode(b[5]))
    if item['id'] in ('B1', 'B2'):
        skip = [('getlocal', 3), ('iffalse', 'DO'),
                *old.frag_fever_panel(m, [('getlocal_2',)], 6 if item['id']=='B1' else 5, 'DO')]
        if item['id'] == 'B2':
            skip += [('getlocal', 5), ('getproperty', m['state']), ('getproperty', m['index']),
                     ('pushbyte', 1), ('ifne', 'DO')]
        # External SKIP label is only needed to count the instruction block.
        skip += [('jump', 'SKIP'), ('label', 'DO'), ('label', 'SKIP'), ('nop',)]
        skip_n = len(asm.assemble(skip)) - 1
        size, at, skip_at, header = ((34, 11, 27, [3,3,1,2]) if item['id']=='B1'
                                    else (28,10,21,[2,3,1,2]))
        b[5] = asm.unsplice(b[5], at, n-size-skip_n)
        b[5] = asm.unsplice(b[5], skip_at, skip_n)
    elif item['id'] == 'B3':
        b[5] = asm.unsplice(b[5], 3, n-4)
        header = [2,2,1,1]
    else:
        code = asm.decode(b[5])
        # Archived U loop final bound followed by the original pushnull.
        candidates = [i+1 for i,x in enumerate(code[:-1]) if x.name == 'iflt'
                      and code[i+1].name == 'pushnull'
                      and x.target == 8]
        assert len(candidates)==1, candidates
        b[5] = asm.unsplice(b[5], 2, candidates[0]-2)
        header = [7,24,1,2]
    b[1:5] = header
    assert hashlib.sha256(b[5]).hexdigest() == item['before'], item['label']
    return b


def build(e):
    originals = {p['id']: recover_original(e.abc, p) for p in old.PATCHES}
    m = add_helpers(e)
    original_marker, original_parse = old.frag_marker, old.frag_parse
    original_preload, original_push = old.frag_preload, old.push_int
    context = {}

    def frag_marker(abc, _m, prefix, M, N, P, D, U, have, done):
        block = original_marker(abc, _m, prefix, M, N, P, D, U, have, done)
        at = block.index(('label', prefix+'FOUND')) + 1
        S = context['spec']
        uid = ([('getlocal', S), ('pushbyte', 0), ('getproperty', m['MNL']), ('convert_i',), ('setlocal', U)]
               if context['id']=='B1' else [])
        return block[:at] + [
            ('getlex', m['YM']), ('getlocal', P), ('getproperty', m['asset']),
            ('getlocal', P), ('getproperty', m['squadManager']), ('callproperty', m['marker'], 2), ('setlocal', S),
            ('getlocal', S), ('iffalse', done),
            *uid,
            ('pushtrue',), ('setlocal', M), ('jump', have),
        ]

    def frag_parse(abc, _m, prefix, asset, U, OUT, *temps):
        S = context['spec']
        level = ([('getlocal', S), ('pushbyte', 2), ('getproperty', m['MNL']), ('convert_i',), ('setlocal', context['lv'])]
                 if context['id']!='B5' else [])
        return [('getlocal', S), ('pushbyte', 1), ('getproperty', m['MNL']), ('setlocal', OUT), *level]

    def frag_preload(abc, _m, asset, per_key, U, KEYS, I, T1, T2, T3, T4, V1, V2):
        LV, ALL, J, S = context['lv'], context['all'], context['j'], context['spec']
        return [
            ('getlocal_0',), ('callproperty', m['catalog'], 0), ('setlocal', ALL),
            *asset, ('getlex', m['DIT']), ('callproperty', m['getMasterTableMaybe'], 1), ('setlocal', T4),
            ('getlocal', T4), ('iffalse', 'DONE'),
            ('pushbyte', 0), ('setlocal', J), ('jump', 'UCOND'),
            ('label', 'ULOOP'), ('avm_label',),
            ('getlocal', ALL), ('getlocal', J), ('getproperty', m['MNL']), ('setlocal', S),
            *frag_parse(abc, _m, '', asset, U, KEYS),
            ('pushbyte', 0), ('setlocal', I), ('jump', 'KCOND'),
            ('label', 'KLOOP'), ('avm_label',), *per_key, ('inclocal_i', I),
            ('label', 'KCOND'), ('getlocal', I), ('getlocal', KEYS), ('getproperty', m['length']), ('iflt', 'KLOOP'),
            ('inclocal_i', J),
            ('label', 'UCOND'), ('getlocal', J), ('getlocal', ALL), ('getproperty', m['length']), ('iflt', 'ULOOP'),
            ('label', 'DONE'),
        ]

    old.frag_marker, old.frag_parse, old.frag_preload = frag_marker, frag_parse, frag_preload
    old.push_int = lambda abc, value: [('getlocal', context['lv'])] if value==100 else original_push(abc, value)
    try:
        for item in old.PATCHES:
            id_ = item['id']
            LV = {'B1':17,'B2':8,'B3':11,'B5':35}[id_]
            context.update(id=id_,lv=LV, all=LV+1, j=LV+2, spec=LV+3)
            bi = bodies.resolve(e.abc, item['label'])
            baseline = e.abc.bodies[bi]
            e.abc.bodies[bi] = copy.deepcopy(originals[id_])
            try:
                item['apply'](e.abc, bi, e.pool)
                result = e.abc.bodies[bi]
                result[2] = max(result[2], LV+4)
            finally:
                e.abc.bodies[bi] = baseline
            e.replace(item['label'], result[5], exceptions=result[6], header=result[1:5])
    finally:
        old.frag_marker, old.frag_parse = original_marker, original_parse
        old.frag_preload, old.push_int = original_preload, original_push
    return {'group':7, 'helpers':['wfxFeverSpecV2','wfxFeverMarkerV2','wfxFeverCatalogV2'],
            'modified':[p['label'] for p in old.PATCHES]}
