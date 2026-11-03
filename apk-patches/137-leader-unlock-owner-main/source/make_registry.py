"""完整继承前八轮登记，只追加第九轮自身能力202解锁说明。"""
import copy
import json
from bootstrap import ROOT, BASE_SHA, output_path

CAPABILITY = 'wfx-owner-main-unlock-v1'
ARCHIVE = '137-leader-unlock-owner-main'


def main():
    old = json.loads((ROOT.parent/'run8/registry-draft.json').read_text(encoding='utf-8'))
    release = json.loads((ROOT/'release-locks.json').read_text(encoding='utf-8'))
    digest = release['output_swf_sha256']
    data = copy.deepcopy(old)
    data.update(since_layer='v35i-run9', extends='../run8/registry-draft.json',
                output_swf_sha256=digest)
    data['capabilities'][CAPABILITY] = {
        'level': 'semantic', 'layer': 'v35i', 'status': 'local_candidate',
        'required_swf_sha256': digest, 'baseline_swf_sha256': BASE_SHA,
        'patch_archive': ARCHIVE, 'methods': sorted(release['methods']),
        'summary': '现有合击解锁bit1同时满足该合击角色自身能力的202 OwnerIsMain前置',
        'data_key': '复用slot0实际队长技编号的wfx_unlock_<编号>；不新增数据键',
        'gates': '沿用wfxPartyMask；bit8限制slot0合击，bit16要求原生共鸣人数至少6',
        'scope': '仅合击角色自身能力的202；其他前置和技能限制保持原生',
        'no_party': '没有队伍、没有slot0队长或不能定位来源时回退原生',
        'unverified': ['完整AIR虚拟机', 'Android真机', '实际UI画面', '真实联机', '设备性能'],
    }
    data['integration_notes'].extend([
        '第九轮完整累计前八轮登记；只追加自身能力202解锁，不修改既有capability及数据键定义。',
        '27及31在六同属性队伍中满足slot0合击自身能力的OwnerIsMain；slot1/2仍走原生。',
        '203、Leader/IsNotLeader、UnisonMyself/UnisonWithMain与技能自身限制保持原生。',
        '第九轮仅本地离线SWF与补丁登记草稿；完整AIR、真机与实际UI未核实。',
    ])
    output_path(ROOT/'registry-draft.json').write_text(
        json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
