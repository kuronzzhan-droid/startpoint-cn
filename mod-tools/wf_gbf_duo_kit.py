"""Audit incomplete GBF native drafts without replacing installable gameplay.

Only evidence is emitted. The donor-based package remains blocked by its
required client capability until the compatibility decisions and integration land.
Structural validation here is deliberately not gameplay acceptance.
"""
from pathlib import Path

import wf_client_legality as L
import wf_dsl
import wf_seasonal7_common as C
from wf_seasonal7_kit_philia import signature_problems, scope_problems

BLOCKERS = {
    'ghandagoza': [
        '逆境原生计算将普通最小值和最大值限制为50%；技能50%～150%及能力6上限150%尚待兼容方案。',
        '瓦解已改用实际被强化弹射命中的敌人触发器；专属状态表和最大5层尚待整合验证。',
        '水属性强化弹射增益的主体归属、全队生命值分档、复苏触发顺序尚待运行验证。',
        '12秒再生的回复量原稿未指定；草稿暂用每2秒3%，尚未写入安装包。',
    ],
    'soriz': [
        'Fever禁止回复Fever、每次强化弹射削减当前Fever时长20%尚未接入。',
        'Fever专属强化弹射10/20/50倍与12连击判定、每损失10%队伍生命值增加500Fever尚未接入。',
        '汉气按缺失生命获得、全队共用且每次消耗3层的致死保护尚未接入。',
        '欧根与仁援护的真正强化弹射伤害来源、随热浪缩短的冷却及双人援护尚未接入。',
        '强化弹射抗性压到至多－15%与普通－15%减抗不同，等待作者选择兼容方案。',
        '老兵4层逆境与主动技能周围判定已有原生草稿，仍需专属状态表整合和实战验证。',
    ],
}


def draft_subject_problems(tree):
    """Check target slots absent from the legacy generic binding checker."""
    slots = {name:1 for name in ('CreateBarrier', 'CreateCondition', 'DeleteCondition',
             'CreateRatioAttack', 'CreateRatioHeal', 'CreateNormalAttack', 'StopBall',
             'ConditionalsHealthPointRatioOf')}
    slots['ShowEffect'] = 3
    errors = []
    def visit(node, bound):
        if not isinstance(node, list) or not node:
            return
        tag = node[0] if isinstance(node[0], str) else ''
        if tag == 'FindAllSubjects':
            visit(node[-1], bound | {node[1]})
            return
        if tag == 'CreateHitArea' and len(node) == 27:
            visit(node[20], bound | {node[21]})
            visit(node[23], bound | {node[21], node[22]})
            return
        if tag in slots and len(node) > slots[tag]:
            subject = node[slots[tag]]
            if isinstance(subject, int) and subject >= 0 and subject not in bound:
                errors.append(f'{tag}: unbound subject {subject}')
        for child in node:
            visit(child, bound)
    visit(tree, set())
    return errors


def check_draft(leader, abilities, programs):
    errors = []
    for table, groups in [('leader_ability', [leader]), ('ability', abilities.values())]:
        for rows in groups:
            for row in rows:
                errors.extend(L.client_legality_problems(table, row))
                errors.extend(L.declared_block_field_problems(table, row))
                errors.extend(L.ability_element_column_problems(table, row, 1))
    for path, tree in programs.items():
        problems = (signature_problems(tree) + scope_problems(tree) + draft_subject_problems(tree)
                    + L.action_dsl_subject_binding_problems(tree)
                    + L.action_dsl_hit_area_target_problems(tree)
                    + L.action_dsl_element_problems(tree, character_element=1)
                    + wf_dsl.player_side_dsl_problems(tree))
        errors.extend(f'{path}: {p}' for p in problems)
        C.amf_bytes(tree)  # Lossless encode/decode check, including delayed blocks.
    return errors


def build(pack, source):
    code = pack.spec.code
    import wf_gbf_duo_dsl as D
    if code == 'ghandagoza':
        import wf_gbf_ghandagoza as module
        skill = D.ghandagoza_skill()
    else:
        import wf_gbf_soriz as module
        skill = D.soriz_skill(pack)
    leader, abilities, programs = module.build_rows(pack)
    programs = {**programs, f'battle/action/skill/action/rare5/{code}${code}_draft': skill}
    errors = check_draft(leader, abilities, programs)
    draft = {'status': 'incomplete-not-installable', 'code': code, 'element': 'water',
             'leader': leader, 'abilities': abilities, 'programs': programs,
             'blockers': BLOCKERS[code], 'structural_errors': errors,
             'unique_conditions_not_integrated': True, 'runtime_verified': False}
    pack.write_evidence('native-gameplay-draft.json', draft)
    result = {'status': 'blocked-gameplay-incomplete', 'gameplay_complete': False,
              'runtime_verified': False, 'release_ready': False,
              'summary': '资源齐备；机制草稿只写证据，安装包仍为不可发布的模板框架。',
              'blockers': BLOCKERS[code], 'structural_errors': errors,
              'row_counts': {'leader': len(leader), 'abilities': {k:len(v) for k,v in abilities.items()}},
              'program_count': len(programs), 'source_directory': str(Path(source))}
    pack.write_evidence('kit-report.json', result)
    # Refresh manifests to retain the unresolved-capability publication gate.
    import wf_seasonal7_manifest as manifest
    manifest.build(pack)
    if errors:
        raise ValueError(errors)
    return result
