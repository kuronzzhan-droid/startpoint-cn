"""完整继承前十轮登记；仅追加码33、34、35及能力草稿。"""
import copy
import json
from bootstrap import ROOT, BASE_SHA, output_path
from task_contract import verify as requirement_decisions

# group 可重复：治疗两项共用一组实现，但分别登记能力与归档。
ENTRIES = {
    'direct_count': ('direct-count-target-debuff-v1', '141-direct-count-target-debuff',
                     '按本次命中目标官方弱体数增加原生直接攻击计算次数'),
    'heal_damage_any': ('heal-damage-any-source-v1', '142-heal-damage-any-source',
                        '本队受到任意来源治疗时逐成员量化转伤害，支持持有者独立CT'),
    'heal_fever_any': ('heal-fever-any-source-v1', '143-heal-fever-any-source',
                       '本队受到任意来源治疗时逐成员档位量化后由持有者加Fever'),
}


def implementation_group(key):
    return 'direct_count' if key == 'direct_count' else 'heal_any'


def main():
    old = json.loads((ROOT.parent/'run10/registry-draft.json').read_text(encoding='utf-8'))
    release = json.loads((ROOT/'release-locks.json').read_text(encoding='utf-8'))
    groups = json.loads((ROOT/'build-report.json').read_text(encoding='utf-8'))['groups']
    digest = release['output_swf_sha256']
    data = copy.deepcopy(old)
    data.update(since_layer='v35k-run11', extends='../run10/registry-draft.json', output_swf_sha256=digest)
    data['requirement_decisions'] = requirement_decisions()
    verified = json.loads((ROOT/'verify-report.json').read_text(encoding='utf-8'))
    assert verified['status'] == 'pass' and verified['output_swf_sha256'] == digest
    assert verified['requirement_decisions'] == data['requirement_decisions']
    data['verification_status'] = 'pass'
    data['external_readonly_ack'] = 'task-evidence/known-external-changes.json'
    for key, (capability, archive, summary) in ENTRIES.items():
        group = implementation_group(key)
        data['capabilities'][capability] = {
            'level': 'semantic', 'layer': 'v35k', 'status': 'local_candidate',
            'required_swf_sha256': digest, 'baseline_swf_sha256': BASE_SHA,
            'patch_archive': archive, 'methods': sorted(groups[group]['changed']+groups[group]['added']),
            'summary': summary, 'details': group+'/README.md',
            'unverified': ['完整AIR虚拟机', 'Android真机', '实际画面', '真实联机', '设备性能'],
        }
        if group == 'heal_any':
            data['capabilities'][capability]['decision_evidence'] = 'task-evidence/decision-status.json'
    rows = [
        {'code': 33, 'name': 'direct.count.target_debuff', 'side': 'direct_attacker',
         'arg': 'base，有符号int32；每条状态的首个弱体额外次数',
         'value': 'per，有符号int32；自第2个弱体起的额外次数',
         'flags': 'cap，有符号int32；<=0不封顶；非pin位',
         'formula': 'k=0为0；k>=1为max(0, sum(layers*(base+per*(min(k-1,cap) if cap>0 else k-1))))',
         'native': '先保留原生AdditionalDirectAttack选优，再加到本次directAttackTimes；不新开乘区',
         'example': 'wfx:33:10:1:5:hidden_bel_weak_hits', 'entry': 'direct_count'},
        {'code': 34, 'name': 'heal.damage.any_source', 'side': 'recipient_party_holder',
         'arg': '分类+10*档位百分比+1000*CT秒数；分类0跟随队长concepts，1技能/2强化弹射Lv3/3直击/4能力；档位0至99，CT非负整数秒',
         'value': '有效恢复每档伤害倍率*10000；档位0时每1%连续计算',
         'flags': '溢出恢复每档伤害倍率*10000；非pin位',
         'formula': 'category=arg%10，tier=floor(arg/10)%100，ctSeconds=floor(arg/1000)；逐次逐受治疗成员分别floor(effectivePercent/tier)、floor(overPercent/tier)，零头不累积；tier=0沿连续倍率',
         'timing': '持有者所有码34均arg<1000时完整保持第二版30帧聚合/原冷却/尾量；CT>0时首笔达档治疗开启30逻辑帧聚合窗，发伤害时开始max(30,CT秒数*60)逻辑帧冷却；CT内治疗直接丢弃，无尾量；结束后新达档治疗才开新窗',
         'mixed_ct_implementation_convention': '多条码34当前有效行取最大CT，所有分类及无CT行共用持有者窗口；窗口内已记录CT不缩短。此为明确记录的实现选择，不表示作者另行裁定。',
         'ct_scope': '每个持有者各自一个CT，有效与溢出共用；暂停不推进逻辑帧则CT不消耗；码35不受CT影响',
         'logic_frames_per_second': 60,
         'ct_evidence': 'audit/ct-delta-report.json',
         'network_policy': '联机B：本端受治疗成员实际执行的跨玩家回复计入；仅转发/镜像而未执行本端回复不计；旧码30/31跨statsBattleId排除不变',
         'supersedes': '本队存在码34持有者即跳过本次所有治疗者码30；不影响码31',
         'example': 'wfx:34:5050:100000:150000:hidden_wg_aqua_heal_damage_any', 'entry': 'heal_damage_any'},
        {'code': 35, 'name': 'heal.fever.any_source', 'side': 'recipient_party_holder',
         'arg': '10*档位百分比；例每5%写50；arg<10连续计算',
         'value': '每有效档占最大Fever槽万分比；100=1%，500=5%',
         'flags': '每溢出档占最大Fever槽万分比；1000=10%；非pin位',
         'formula': 'Fever A：每名受治疗成员每次实际applyHeal独立量化，按层数加权后由每个持有者各调用一次addFeverPoint(...,true,101)；不跨成员合批、不加批次标记；tier=0沿码31',
         'timing': '无CT，立即调用原生Fever API，保留原生满槽钳位',
         'network_policy': '联机B：本端受治疗成员实际执行的跨玩家回复计入；仅转发/镜像而未执行本端回复不计；旧码30/31跨statsBattleId排除不变',
         'supersedes': '本队存在码35持有者即跳过本次所有治疗者码31；不影响码30',
         'example': 'wfx:35:50:500:1000:hidden_wg_aqua_heal_fever_any', 'entry': 'heal_fever_any'},
    ]
    for row in rows:
        key = row.pop('entry')
        group = implementation_group(key)
        row.update(capability=ENTRIES[key][0], gate='block', since_layer='v35k-run11',
                   hooks=groups[group]['changed'], required_swf_sha256=digest,
                   stack_scaled=True, hidden_label='第6段hidden_沿run5规则隐藏图标')
        row['arg_schema'] = {'min': -2147483648 if row['code'] == 33 else 0,
                             'max': 2147483647, 'integer': True}
        row['value'] = {'min': -2147483648, 'max': 2147483647,
                        'integer': True, 'meaning': row['value']}
        data['effect_codes'].append(row)
        data['effect_flags_overrides'][str(row['code'])] = {
            'type': 'integer', 'min': -2147483648 if row['code'] == 33 else 0,
            'max': 2147483647, 'meaning': row['flags'], 'pin': False}
    data['integration_notes'].extend([
        '第十一轮完整累计前十轮，旧能力与效果码定义保持原值；只追加33/34/35。',
        '码33的arg和flags允许有符号int32，仅该新码放宽；每条cap独立，贡献合计钳0。',
        '码34和35都逐次逐受治疗成员量化，零头不跨次累积、不跨成员合并；第三版仅码34支持额外CT，码35保持第二版无CT。',
        '码34 arg=分类+10*档位百分比+1000*CT秒数，例5050表示跟随队长、每5%一档、5秒CT；60逻辑帧/秒，5秒=300逻辑帧。',
        'CT从30帧聚合窗发伤害时开始，每持有者独立、有效和溢出共用；CT内治疗丢弃不囤积，暂停不消耗；arg<1000与第二版真实字节码行为对照。',
        '新数据保留全队原码30/31，另仅给杰拉德自身34/35；新客户端按类型互斥，旧客户端不识别新码。',
        '持有者查询含invisibleSlot和原生队伍槽，攻击、分类、增伤和统计归持有者。',
        '2026-10-19裁定已解决两项待澄清口径：联机B，Fever A，详见task-evidence/decision-status.json。',
        '联机B：码34/35允许本端实际收到的跨玩家治疗，仅本端受治疗成员实际执行回复时计入；仅转发/镜像不计。码30/31原有跨statsBattleId排除不变。',
        'Fever A：每名成员实际applyHeal各自量化后由每个持有者各调用一次原生Fever API，不跨成员合批，不新增批次标记。',
        '本地受治疗采样及原生同步代码离线验证；真实双端联机去重与画面/设备性能未核实。',
        '仅离线SWF与注册草稿，未修改实际角色、能力、状态数据或正式注册表。',
    ])
    output_path(ROOT/'registry-draft.json').write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
