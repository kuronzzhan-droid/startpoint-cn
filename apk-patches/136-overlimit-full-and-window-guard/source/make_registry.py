"""累计保留前七轮登记，仅追加第八轮本地能力和数据键。"""
import copy
import json
from bootstrap import ROOT, BASE_SHA, output_path

CAPABILITY = 'wfx-overlimit-full-v1'
ARCHIVE = '136-overlimit-full-and-window-guard'


def main():
    old = json.loads((ROOT.parent/'run7/registry-draft.json').read_text(encoding='utf-8'))
    release = json.loads((ROOT/'release-locks.json').read_text(encoding='utf-8'))
    digest = release['output_swf_sha256']
    data = copy.deepcopy(old)
    data.update(since_layer='v35h-run8', extends='../run7/registry-draft.json',
                output_swf_sha256=digest)
    data['capabilities'][CAPABILITY] = {
        'level': 'semantic', 'layer': 'v35h', 'status': 'local_candidate',
        'required_swf_sha256': digest, 'baseline_swf_sha256': BASE_SHA,
        'patch_archive': ARCHIVE, 'methods': sorted(release['methods']),
        'summary': '按角色键从第1次突破使用超限结晶与悖论之核；最高台座按全盘已学，窗口跳过缺失格子',
        'eligibility': '星5且character_status最高键>=120；持有角色overLimitStep>=0；键值严格为字符串1',
        'maximum_pedestal': '突破8次、Lv120及角色所有盘全部应有玛纳节点已学；不要求觉醒',
        'level_cap_display': '保持O1原字节码与80到100、之后105到120的显示规则',
        'missing_slot_guard': '所有角色生效；仅跳过不存在的缩略图，重新开窗按新道具列表建格子',
        'unverified': ['完整AIR虚拟机', 'Android真机', '实际UI画面', '服务端联动'],
    }
    data['custom_ability_string_patterns'].append({
        'prefix': 'wfx_overlimit_full_', 'key_suffix': '角色id', 'value': '1',
        'capability': CAPABILITY, 'gate': 'block',
        'example': {'key': 'wfx_overlimit_full_129989', 'value': '1'},
        'required_swf_sha256': digest,
    })
    data['integration_notes'].extend([
        '第八轮只生成离线SWF、登记和补丁归档草稿；没有写实际数据或服务端。',
        '全程超限键仅星5且最高等级键>=120生效；无键保持v35g，格子缺失防崩对所有角色生效。',
        '全盘满强化按持有角色abilities中的节点学习记录；不要求觉醒、不漏尚未开放盘。',
    ])
    output_path(ROOT/'registry-draft.json').write_text(
        json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
