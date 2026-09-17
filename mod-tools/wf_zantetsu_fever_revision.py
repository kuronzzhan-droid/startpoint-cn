"""白梅斩铁 2026-09-17 增量修订；在 kit 重建后应用，保留语音和展示资产。"""
from copy import deepcopy
import hashlib
import zlib

import wf_mod_tool as core
import wf_dsl
from wf_character_revision import RevisionCandidate, encode_tree
from wf_client_legality import client_legality_problems

CID, CODE = '159998', 'samurai_robot_plum'
LEADER = 'master/ability/leader_ability.orderedmap'
ABILITY = 'master/ability/ability.orderedmap'
CAS = 'master/string/custom_ability_string.orderedmap'
FEVER_TEXT = 'change_skill_samurai_robot_plum_fever'
BASE = {
    CID: '49eef55543977a24c9e6cdd21be1375342dd56205ce9936780404f6f6acc252f',
    CID+'3': '7676aec38058a80f987dba696628da4064a41cbcd17bb807ed457625e160d433',
}
TREE_SHA = {
    1: '660f52c583533e6a45d1b23ee82d3380040cffb0b20a4c6db967a333a8fdb8d5',
    2: 'ed8da45f4e8ee8ffa3650b1005dd6c6183597980e34bac79861900d4ef5046e6',
}


def text_sha(rows):
    return hashlib.sha256(core.write_csv_lines(rows).encode()).hexdigest()


def revise_rows(leader, ability):
    if text_sha(leader) != BASE[CID] or text_sha(ability) != BASE[CID+'3']:
        raise ValueError('reviewed Zantetsu source rows changed')
    lead, ab = deepcopy(leader), deepcopy(ability)
    # Remove only the old self-cast piercing row; maxed recharge 10 -> 5%.
    assert lead[3][45] == '26' and lead[4][45] == '211'
    lead[4][49:51] = ['2500', '5000']
    del lead[3]
    for effect, amount in [('211', '5000'), ('226', '2500000')]:
        row = deepcopy(ab[0])
        row[27:32] = ['23', '7', 'White', '100000', '100000']
        row[47], row[48] = effect, '0'
        row[51:53] = [amount, amount]
        ab.append(row)
    # Flag 2 belongs to unlocked ability 3 and six-Light resonance. DSL additionally
    # checks Fever, so normal casts cannot acquire the new penetration or bonus.
    flag = deepcopy(ab[0])
    flag[27:35] = ['0', '', '', '', '', '', '', '(None)']
    flag[47], flag[48] = '704', ''
    flag[51:53] = ['', '']
    flag[70] = FEVER_TEXT
    ab.append(flag)
    for kind, rows in [('leader_ability', lead), ('ability', ab)]:
        for row in rows:
            errors = client_legality_problems(kind, row)
            if errors:
                raise ValueError('; '.join(errors))
    return lead, ab


def nodes(tree, name):
    out = []
    if isinstance(tree, list):
        if tree and tree[0] == name:
            out.append(tree)
        for child in tree:
            out.extend(nodes(child, name))
    return out


def block(*commands):
    return ['Block', list(commands)]


def command(*args):
    return ['Command', list(args)]


def revise_tree(tree):
    result = deepcopy(tree)
    flags = nodes(result, 'ConditionalsChangeSkillFlag')
    if len(flags) != 3 or any(n[1] != 1 for n in flags):
        raise ValueError('expected three existing resonance damage branches')
    for flag in flags:
        if [n[8] for n in nodes(flag[2], 'CreateNormalAttack')] != [True]:
            raise ValueError('old main resonance bonus changed')
        normal = nodes(flag[3], 'CreateNormalAttack')
        if len(normal) != 1 or normal[0][8] is not False:
            raise ValueError('old normal damage branch changed')
        boosted = deepcopy(normal[0]); boosted[8] = True
        # Existing main resonance branch remains intact; its fallback can also
        # enable the very same native bonus in Fever. Never multiply twice.
        def replace(x):
            if isinstance(x, list):
                for i, child in enumerate(x):
                    if child == ['Command', normal[0]]:
                        fallback = deepcopy(child)
                        x[i] = command('ConditionalsChangeSkillFlag', 2,
                            block(command('ConditionalsFeverMode', block(['Command', boosted]),
                                          block(deepcopy(fallback)))), block(fallback))
                    else:
                        replace(child)
        replace(flag[3])
    piercing = command('CreateCondition', -17,
        [['ACPiercing', [{'min': 900, 'max': 900}]]], [{'min': 1, 'max': 1}],
        ['GenericConditionHitEffect'], True, False, '', None, False, 3,
        [{'min': 1, 'max': 1}], False)
    result[11][1].insert(0, command('ConditionalsChangeSkillFlag', 2,
        block(command('ConditionalsFeverMode', block(piercing), block())), block()))
    return result


def apply_candidate(repo, workspace, *, apply=False):
    candidate = RevisionCandidate(repo, workspace, character_id=CID, code_name=CODE,
        package_version='1.0.1', snapshot_key='fever_revision_20260917',
        evidence_name='fever-revision-20260917.json')
    old = {lg: core.read_orderedmap_file_from_bytes(candidate.read('common', lg))
           for lg in (LEADER, ABILITY)}
    lead, ab = revise_rows(core.read_csv_lines(old[LEADER][CID]),
                          core.read_csv_lines(old[ABILITY][CID+'3']))
    candidate.splice(LEADER, {CID: lead})
    candidate.splice(ABILITY, {CID+'3': ab})
    candidate.splice(CAS, {FEVER_TEXT: [[
        'Fever模式中，强化『超振动斩铁剑·寒梅一闪』，追加随连击数提升的威力，并赋予贯穿效果']]})
    checks = []
    import wf_seasonal7_kit_zantetsu as kit
    import wf_client_legality as legality
    for level in (1, 2):
        logical = f'battle/action/skill/action/rare5/{CODE}${CODE}_{level}.action.dsl.amf3.deflate'
        raw = candidate.read('common', logical)
        if hashlib.sha256(raw).hexdigest() != TREE_SHA[level]:
            raise ValueError('reviewed Zantetsu DSL changed')
        source = wf_dsl.parse_dsl(zlib.decompress(raw, -15))['tree']
        tree = revise_tree(source)
        errors = (wf_dsl.player_side_dsl_problems(tree) + kit.sig_problems(tree)
            + kit.lookup_scope_problems(tree) + legality.action_dsl_subject_binding_problems(tree)
            + legality.action_dsl_hit_area_target_problems(tree)
            + legality.action_dsl_element_problems(tree, 4))
        if errors:
            raise ValueError(str(errors))
        candidate.emit('common', logical, encode_tree(tree))
        checks.append(dict(level=level, roundtrip=True, dsl_errors=errors,
                           penetration_frames=900, native_combo_bonus='1 + combo * 0.005'))
    return candidate.finish(dict(checks=checks, light_resonance=True,
        leader_recharge_max=5, ability3_recharge=5, ability3_combo=25,
        existing_ability3_preserved=True, fever_penetration_seconds=15), apply=apply)


if __name__ == '__main__':
    import argparse,json
    from pathlib import Path
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args=parser.parse_args()
    print(json.dumps(apply_candidate(Path(__file__).resolve().parents[1], args.workspace,
                                    apply=args.apply), ensure_ascii=False))
