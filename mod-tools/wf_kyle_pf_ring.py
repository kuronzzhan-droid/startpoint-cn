"""Kyle-only native 722 sword PF: API thunder border and direct-hit damage."""
from __future__ import annotations

import copy
import hashlib
import zlib

import wf_dsl
import wf_gerald_native_pf_dsl as donor
import wf_kyle_pf_effect as fx
import wf_midautumn_kitlib as kit

KEY = 'kyle_moon_thunder_ring'
STRING = 'override_string_' + KEY
TABLE = 'master/skill/power_flip_action.orderedmap'
PROGRAMS = tuple(f'battle/action/power_flip/action/override/{KEY}${KEY}_lv{n}'
                 for n in (1, 2, 3))
TEXT = '自身的强化弹射变为旋转雷环，使用直击伤害加成，并保留强化弹射独立乘区'


def leader_row(ctx):
    # The official native 722 decoder accepts all three sword levels. Kyle's
    # visual/damage replacement is unconditional while he occupies the leader slot.
    return kit.build_row(ctx, 'leader_ability', '141201#1',
        {0: 'kyle_moon', 4: '0', 7: '0', 8: '0', 9: '',
         45: '722', 80: KEY, 81: '1,2,3', 82: STRING}, element=2,
        label='kyle-native-pf')


def build_tree(raw, level):
    if level not in (1, 2, 3):
        raise ValueError('PF level must be 1, 2 or 3')
    if hashlib.sha256(raw).hexdigest() != donor.SOURCE_HASHES[f'knight_lv{level}']:
        raise ValueError('native sword PF fingerprint drift')
    tree = wf_dsl.parse_dsl(zlib.decompress(raw, -15))['tree']
    original = copy.deepcopy(tree)
    areas = list(wf_dsl.iter_dsl_commands(tree, 'CreateHitArea'))
    shows = list(wf_dsl.iter_dsl_commands(tree, 'ShowEffect'))
    if len(areas) != 1 or len(shows) != 1:
        raise ValueError('native sword PF structure changed')
    # iter_dsl_commands returns command bodies, not Command wrappers.
    # Author accepted the native limitation on 2026-09-23: regular damage bonus
    # becomes DirectAttack, but PF event source/separated terms remain unchanged.
    areas[0][24] = 4
    shows[0][2] = ['SpecifyEffectDirectly', fx.effect(level)]
    # A finite once sequence includes the visual end before the unchanged lifetime.
    shows[0][5] = ['PlayOnlyFirstSequence']
    verify_tree(tree, original, level)
    return tree


def verify_tree(tree, original, level):
    probe = copy.deepcopy(tree)
    area = list(wf_dsl.iter_dsl_commands(probe, 'CreateHitArea'))[0]
    show = list(wf_dsl.iter_dsl_commands(probe, 'ShowEffect'))[0]
    if area[24] != 4 or show[2] != ['SpecifyEffectDirectly', fx.effect(level)]:
        raise ValueError('direct-hit attribution or ring route lost')
    before_show = list(wf_dsl.iter_dsl_commands(original, 'ShowEffect'))[0]
    if show[5] != ['PlayOnlyFirstSequence']:
        raise ValueError('ring must finish its finite animation')
    area[24] = 0
    show[2], show[5] = copy.deepcopy(before_show[2]), copy.deepcopy(before_show[5])
    if probe != original:
        raise ValueError('native motion, lifetime, hit count, multiplier or PF lifecycle changed')
    if wf_dsl.parse_dsl(wf_dsl.encode_amf3(tree))['tree'] != tree:
        raise ValueError('PF DSL does not round-trip')


def install(ctx):
    from wf_seasonal7_kit_zehr import apk_pf_sources
    sources, apk = apk_pf_sources(ctx.root)
    programs = []
    for level in (1, 2, 3):
        tree = build_tree(sources[f'knight_lv{level}'], level)
        ctx.write_dsl(PROGRAMS[level-1], tree)
        programs.append(PROGRAMS[level-1])
    ctx.write_flat(TABLE, {KEY: [list(PROGRAMS)]})
    assets, report = fx.build_assets(ctx.root)
    for logical, raw in assets.items():
        ctx.write_asset('common', logical, raw, owner='kyle-pf-ring')
    report.update(apk=apk, table_key=KEY, programs=programs, buff_target_as=4,
                  regular_damage_bonus='DirectAttack', source_context='PowerFlip',
                  limitation='PF events and PF separated multipliers remain; author accepted no-client-change scope on 2026-09-23',
                  native_ranges=[140, 160, 280], native_hits=[3, 4, 5],
                  native_multipliers=[3.25, 4.75, 6.3])
    ctx.evidence_write('pf-ring-20260923.json', report)
    return report
