"""Fever v2 helpers: generated AVM2 methods on existing classes only."""
from __future__ import annotations
import sys
from pathlib import Path
sys.dont_write_bytecode = True
SOURCE = Path(__file__).resolve().parent / 'source'
sys.path.insert(0, str(SOURCE))
import feveritems_patches as old

YM = 'pinball.scene.battle.battle.zone.yakumono::YakumonoManagerImpl'
BQ = 'pinball.common.data.quest.battle::BattleQuestBaseImpl'


def add_helpers(e):
    a, q = e.abc, e.q
    m = old.names(a)
    m.update({k: q(k) for k in ('content', 'params', 'primary', 'members')})
    m['mapkeys'] = q('pinball.master.runtime:MasterMap::keys')
    m['getconditions'] = q('getConditionsIncludingOuterEnvironments')
    m['accumulation'] = q('get_currentAccumulation')
    m['substr'] = q('http://adobe.com/AS3/2006/builtin::substr')
    m['charCodeAt'] = q('http://adobe.com/AS3/2006/builtin::charCodeAt')
    m['YM'], m['BQ'] = q(YM), q(BQ)
    m['spec'] = e.newq('wfxFeverSpecV2')
    m['marker'] = e.newq('wfxFeverMarkerV2')
    m['catalog'] = e.newq('wfxFeverCatalogV2')
    m['entries'] = e.add_slot(BQ, 'wfxFeverCatalogByQuestV2', 'Object', static=True)
    m['Dictionary'] = q('flash.utils::Dictionary')
    spec(e, m)
    marker(e, m)
    catalog(e, m)
    return m


def spec(e, m):
    # args asset=1, uid=2; keys=3, temps=4..9, level=10, parts=11, i=12, s=13.
    asset = [('getlocal_1',)]
    table = [('getlocal', 4), ('coerce', m['UCT']), ('callproperty', m['get_data'], 0),
             ('coerce', m['MasterMap'])]
    code = [
        ('getlocal_0',), ('pushscope',),
        *asset, ('getlex', m['UCT']), ('callproperty', m['getMasterTableMaybe'], 1), ('setlocal', 4),
        ('getlocal', 4), ('iffalse', 'NONE'),
        *table, ('getlocal_2',), ('callproperty', m['mm_exists'], 1), ('iffalse', 'NONE'),
        *table, ('getlocal_2',), ('callproperty', m['mm_get'], 1), ('setlocal', 4),
        ('getlocal', 4), ('iffalse', 'NONE'),
        ('getlocal', 4), ('getproperty', m['string_id']), ('dup',), ('iffalse', 'EMPTY'),
        ('pushstring', m['s_colon']), ('callproperty', m['split'], 1), ('setlocal', 11),
        ('getlocal', 11), ('getproperty', m['length']), ('pushbyte', 3), ('iflt', 'NONE'),
        ('getlocal', 11), ('pushbyte', 0), ('getproperty', m['MNL']), ('pushstring', m['s_tag0']), ('ifne', 'NONE'),
        ('getlocal', 11), ('pushbyte', 1), ('getproperty', m['MNL']), ('pushstring', m['s_tag1']), ('ifne', 'NONE'),
        ('pushbyte', 100), ('setlocal', 10),
        ('getlocal', 11), ('getproperty', m['length']), ('pushbyte', 3), ('ifle', 'PARSE'),
        ('getlocal', 11), ('pushbyte', 3), ('getproperty', m['MNL']), ('coerce_s',), ('setlocal', 13),
        ('getlocal', 13), ('pushbyte', 0), ('pushbyte', 2), ('callproperty', m['substr'], 2),
        e.string('lv'), ('ifne', 'PARSE'),
        ('getlocal', 13), ('getproperty', m['length']), ('pushbyte', 2), ('ifle', 'PARSE'),
        ('pushbyte', 2), ('setlocal', 12), ('jump', 'DCOND'),
        ('label', 'DLOOP'), ('avm_label',),
        ('getlocal', 13), ('getlocal', 12), ('callproperty', m['charCodeAt'], 1), ('setlocal', 15),
        ('getlocal', 15), ('pushbyte', 48), ('iflt', 'PARSE'),
        ('getlocal', 15), ('pushbyte', 57), ('ifgt', 'PARSE'),
        ('inclocal_i', 12),
        ('label', 'DCOND'), ('getlocal', 12), ('getlocal', 13), ('getproperty', m['length']), ('iflt', 'DLOOP'),
        ('getlocal', 13), ('pushbyte', 2), ('callproperty', m['substr'], 1), ('convert_d',), ('setlocal', 15),
        ('getlocal', 15), ('convert_i',), ('setlocal', 10),
        ('getlocal', 15), ('getlocal', 10), ('ifeq', 'PARSE'),
        # A syntactically numeric level outside the int domain is unusable;
        # never let convert_i wrap 4294967333 into valid level 37.
        ('getlocal_2',), ('newarray', 0), ('pushbyte', 0), ('newarray', 3), ('returnvalue',),
        ('label', 'PARSE'),
    ]
    block = old.frag_parse(e.abc, m, 'SP_', asset, 2, 3, 4, 5, 6, 7, 8, 9)
    # SID/UID were already safely resolved above for level parsing; retain the
    # archived candidate-chain loop without repeating those same predicates.
    key_at = next(i for i in range(len(block))
                  if block[i:i+3] == [('getlocal',4),('pushbyte',2),('getproperty',m['MNL'])])
    block = [('newarray',0),('setlocal',3),
             *asset,('getlex',m['DIT']),('callproperty',m['getMasterTableMaybe'],1),('setlocal',7),
             ('getlocal',7),('iffalse','SP_END'),('getlocal',11)] + block[key_at+1:]
    # Preserve original complete item dependency validation; also protect the
    # level-dependent curve interpolation that throws 14520 outside its domain.
    target = [('getlocal', 3), ('getlocal', 6), ('callpropvoid', m['push'], 1)]
    at = next(i for i in range(len(block)) if block[i:i+3] == target)
    curve = [
        ('getlocal', 9), ('coerce', m['EIACT']), ('callproperty', m['get_data'], 0), ('coerce', m['MasterMap']),
        ('getlocal', 8), ('callproperty', m['mm_get'], 1), ('setlocal', 14),
        ('getlocal', 14), ('iffalse', 'SP_NEXT'),
        ('getlocal', 14), ('coerce', m['MasterMap']), ('callproperty', m['mapkeys'], 0), ('setlocal', 14),
        ('getlocal', 14), ('getproperty', m['length']), ('iffalse', 'SP_NEXT'),
        ('getlocal', 10), ('getlocal', 14), ('pushbyte', 0), ('getproperty', m['MNL']), ('iflt', 'SP_NEXT'),
        ('getlocal', 10), ('getlocal', 14), ('getlocal', 14), ('getproperty', m['length']), ('pushbyte', 1),
        ('subtract_i',), ('getproperty', m['MNL']), ('ifgt', 'SP_NEXT'),
    ]
    block[at:at] = curve
    code += block + [('getlocal_2',), ('getlocal_3',), ('getlocal', 10), ('newarray', 3), ('returnvalue',),
                     ('label', 'EMPTY'), ('pop',), ('label', 'NONE'), ('pushnull',), ('returnvalue',)]
    e.add_method(YM, 'wfxFeverSpecV2', 'Array', ['Object', 'int'], code, 16, static=True)


def marker(e, m):
    # args asset=1, squadManager=2. primary.members are Options in position order;
    # SquadManagerImpl.getLeader() is exactly primary.getMember(0).
    code = [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_2',), ('getproperty', m['primary']), ('getproperty', m['members']), ('setlocal_3',),
        ('pushbyte', 0), ('setlocal', 4), ('jump', 'MCOND'),
        ('label', 'MLOOP'), ('avm_label',),
        ('getlocal_3',), ('getlocal', 4), ('getproperty', m['MNL']), ('setlocal', 5),
        ('getlocal', 5), ('iffalse', 'MNEXT'),
        ('getlocal', 5), ('getproperty', m['index']), ('pushbyte', 0), ('ifne', 'MNEXT'),
        ('getlocal', 5), ('getproperty', m['params']), ('pushbyte', 0), ('getproperty', m['MNL']),
        ('callproperty', m['getconditions'], 0), ('setlocal', 6),
        ('pushbyte', 0), ('setlocal', 7), ('jump', 'CCOND'),
        ('label', 'CLOOP'), ('avm_label',),
        ('getlocal', 6), ('getlocal', 7), ('getproperty', m['MNL']), ('setlocal', 8),
        ('getlocal', 8), ('getproperty', m['content']), ('setlocal', 9),
        ('getlocal', 9), ('getproperty', m['index']), ('pushbyte', 31), ('ifne', 'CNEXT'),
        ('getlocal', 8), ('callproperty', m['accumulation'], 0), ('pushbyte', 0), ('ifle', 'CNEXT'),
        ('getlex', m['YM']), ('getlocal_1',), ('getlocal', 9), ('getproperty', m['params']),
        ('pushbyte', 0), ('getproperty', m['MNL']), ('convert_i',), ('callproperty', m['spec'], 2), ('setlocal', 10),
        ('getlocal', 10), ('iffalse', 'CNEXT'), ('getlocal', 10), ('returnvalue',),
        ('label', 'CNEXT'), ('inclocal_i', 7),
        ('label', 'CCOND'), ('getlocal', 7), ('getlocal', 6), ('getproperty', m['length']), ('iflt', 'CLOOP'),
        ('label', 'MNEXT'), ('inclocal_i', 4),
        ('label', 'MCOND'), ('getlocal', 4), ('getlocal_3',), ('getproperty', m['length']), ('iflt', 'MLOOP'),
        ('pushnull',), ('returnvalue',),
    ]
    e.add_method(YM, 'wfxFeverMarkerV2', 'Array', ['Object', 'Object'], code, 11, static=True)


def catalog(e, m):
    code = [
        ('getlocal_0',), ('pushscope',),
        ('getlex', m['BQ']), ('getproperty', m['entries']), ('iftrue', 'CACHE_READY'),
        ('getlex', m['BQ']), ('findpropstrict', m['Dictionary']), ('pushtrue',),
        ('constructprop', m['Dictionary'], 1), ('setproperty', m['entries']),
        ('label', 'CACHE_READY'),
        ('getlex', m['BQ']), ('getproperty', m['entries']), ('getlocal_0',), ('getproperty', m['MNL']),
        ('setlocal_1',), ('getlocal_1',), ('iftrue', 'RETURN'),
        ('newarray', 0), ('setlocal_1',),
    ]
    # Do not cache transient unloaded tables. The successful collection is
    # shared by leading DSL and following visual preload for this quest.
    for table in ('UCT', 'DIT', 'EIT', 'EILT', 'EIACT'):
        code += [('getlocal_0',), ('getproperty', m['logicAssets']), ('getlex', m[table]),
                 ('callproperty', m['getMasterTableMaybe'], 1), ('iffalse', 'RETURN')]
    code += [
        ('getlocal_0',), ('getproperty', m['logicAssets']), ('getlex', m['UCT']),
        ('callproperty', m['getMasterTableMaybe'], 1), ('coerce', m['UCT']), ('callproperty', m['get_data'], 0),
        ('coerce', m['MasterMap']), ('callproperty', m['mapkeys'], 0), ('setlocal_2',),
        ('pushbyte', 0), ('setlocal_3',), ('jump', 'COND'),
        ('label', 'LOOP'), ('avm_label',),
        ('getlex', m['YM']), ('getlocal_0',), ('getproperty', m['logicAssets']),
        ('getlocal_2',), ('getlocal_3',), ('getproperty', m['MNL']), ('convert_i',),
        ('callproperty', m['spec'], 2), ('setlocal', 4),
        ('getlocal', 4), ('iffalse', 'NEXT'),
        ('getlocal_1',), ('getlocal', 4), ('callpropvoid', m['push'], 1),
        ('label', 'NEXT'), ('inclocal_i', 3),
        ('label', 'COND'), ('getlocal_3',), ('getlocal_2',), ('getproperty', m['length']), ('iflt', 'LOOP'),
        ('getlex', m['BQ']), ('getproperty', m['entries']), ('getlocal_0',), ('getlocal_1',), ('setproperty', m['MNL']),
        ('label', 'RETURN'), ('getlocal_1',), ('returnvalue',),
    ]
    e.add_method(BQ, 'wfxFeverCatalogV2', 'Array', [], code, 5)
