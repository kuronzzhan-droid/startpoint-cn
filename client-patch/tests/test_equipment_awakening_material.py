"""equipment-awakening-material：结构 / 方法锁 / 觉醒道具行为 / 负对照 / 变异体 / 交付入口 / 数据合同。

行为测试执行 SWF 里的真实字节码 ``OwnedEquipmentLogic.getUseableAwakingCrystal``
（equipment-awakening-material/awaken_interp.py = v1 的 look_interp，同一模块对象）。
负对照：同一矩阵在未打补丁的 equipment-enhanced-party-frame b 版产物（2a9583cd）上必须全部是原生结果（按稀有度提供
星铁钢）、从不访问 custom_ability_string / 道具表、从不调用 repo.get；10 个变异体必须让断言变红。
编成槽框 a 版（016cd927，「武器图标会消失」）及在它上面打出的旧产物（07bc8022）一律按 superseded 拒绝。
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import struct
import sys
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path

PATCH_DIR = Path(__file__).resolve().parents[1] / 'equipment-awakening-material'
REPO = Path(__file__).resolve().parents[2]
MOD_TOOLS = REPO / 'mod-tools'
FIXTURE_DIR = Path('D:/WF/out/PARADOX-20260928/apk/enhanced-look-party-20260928b')
BASE = FIXTURE_DIR / 'swf/equipment-enhanced-party-frame.swf'
BASE_APK = FIXTURE_DIR / 'WorldFlipper-equipment-enhanced-party-frame.apk'
OLDER_SWFS = {
    'equipment-enhanced-look e87371b7':
        Path('D:/WF/out/PARADOX-20260928/apk/enhanced-look-20260928/swf/equipment-enhanced-look.swf'),
    'equipment-description-override 4994e23d':
        Path('D:/WF/out/PARADOX-20260928/apk/desc-override-20260928/swf/equipment-description-override.swf'),
    'equipment-rules d99246d9': Path('D:/WF/out/PARADOX-20260928/apk/equipment-rules-20260928/swf/equipment-rules.swf'),
    '1047 d9559f3f': Path('D:/WF/out/PARADOX-20260928/apk/equipment-rules-20260928/swf/baseline.swf'),
}
#: 作废的 a 版链：编成槽框 a 版（锁定方法体与 b 版逐字节相同，但整体哈希不再接受）与在它上面打出的本补丁旧产物。
PARTY_A_SWF = Path('D:/WF/out/PARADOX-20260928/apk/enhanced-look-party-20260928/swf/equipment-enhanced-party-frame.swf')
OLD_CHAIN = Path('D:/WF/out/weapon-client-patches-20260928/swf')
SUPERSEDED_SWFS = {
    'equipment-enhanced-party-frame a 016cd927': PARTY_A_SWF,
    'equipment-awakening-material on a 07bc8022': OLD_CHAIN / 'awakening-material/equipment-awakening-material.swf',
}
BASE_SWF_SHA = '5bd476f6effd1452a8d2508bbc721e1bc1636a5eb62b226005511eb698627162'
BASE_ABC_SHA = '2a9583cddd47786844b9ce5fe2b99aff4e8b5f727e95e757fded99940688a1ad'
TARGET_ABC_SHA = '22292c21361fa505bccd563852810e6fb1d696ae03823f05ff694a74fbdf2ec1'
TARGET_SWF_SHA = '15c8cba8eb86c8e86be2d9508b810d7a4288b7aa000a4ae7e215e1c2132efa0a'


def _load(name, file):
    """按路径以唯一模块名加载，避免与其他补丁目录的 rules.py / verify.py / overlay.py 互相遮蔽。"""
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATCH_DIR / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


overlay = _load('equipment_awakening_material_overlay', 'overlay.py')
rules = overlay.rules
asm, bodies, SwfAbc = overlay.asm, overlay.bodies, overlay.SwfAbc
verify = _load('equipment_awakening_material_verify', 'verify.py')
apply_mod = _load('equipment_awakening_material_apply', 'apply_equipment_awakening_material.py')
package_mod = _load('equipment_awakening_material_package', 'package_apk.py')
awaken_interp = verify.awaken_interp
STEEL, CRYSTAL4, CRYSTAL5 = verify.STEEL, verify.CRYSTAL4, verify.CRYSTAL5


def build(mutate=None, path=BASE):
    swf = SwfAbc(path)
    editor, report = overlay.patch_editor(swf, mutate=mutate)
    return swf, editor, report


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _mod_tools_module(name, file):
    """以私有模块名加载 mod-tools 下的模块（dataclass 需要模块先登记在 sys.modules）。"""
    if name in sys.modules:
        return sys.modules[name]
    added = str(MOD_TOOLS) not in sys.path
    if added:
        sys.path.insert(0, str(MOD_TOOLS))
    try:
        spec = importlib.util.spec_from_file_location(name, MOD_TOOLS / file)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        try:
            spec.loader.exec_module(module)
        except BaseException:
            sys.modules.pop(name, None)
            raise
        return module
    finally:
        if added:
            sys.path.remove(str(MOD_TOOLS))


class DesignConstantsTest(unittest.TestCase):
    """不需要夹具的设计常量、能力声明、数据侧门禁与构建器合同、解释器共享。"""

    def test_key_shape_and_design_constants(self):
        self.assertEqual('awakening_material_5910101', rules.material_key(5910101))
        self.assertEqual('awakening_material_5920001', rules.material_key('5920001'))
        self.assertEqual(('awakening_material_',), rules.ADDED_STRINGS)
        self.assertEqual({rules.LABEL: 12}, rules.ANCHORS)
        self.assertEqual((8,), rules.INCOMING)
        self.assertEqual(76, rules.INSERTED_COUNT)
        self.assertEqual(list(range(5, 14)), sorted(rules.LOCALS.values()))
        self.assertEqual(frozenset({0, 1, 2}), rules.READS)

    def test_candidate_capabilities_are_party_frame_plus_one(self):
        party_rules = _load('equipment_awakening_material_party_rules_probe', '../equipment-enhanced-party-frame/rules.py')
        self.assertEqual('equipment-awakening-material-v1', rules.CAPABILITY)
        self.assertEqual(sorted(set(party_rules.INHERITED_CAPABILITIES) | {party_rules.CAPABILITY}),
                         sorted(rules.INHERITED_CAPABILITIES))
        self.assertEqual(12, len(rules.INHERITED_CAPABILITIES))
        self.assertEqual(sorted(rules.INHERITED_CAPABILITIES + (rules.CAPABILITY,)), package_mod.capabilities())
        self.assertEqual(13, len(package_mod.capabilities()))
        for module in (apply_mod, package_mod):
            self.assertEqual(TARGET_ABC_SHA, module.TARGET_ABC_SHA)
        self.assertEqual(TARGET_SWF_SHA, apply_mod.TARGET_SWF_SHA)
        self.assertEqual((BASE_ABC_SHA, BASE_SWF_SHA), (overlay.BASE_ABC_SHA, overlay.BASE_SWF_SHA))
        self.assertEqual(BASE_ABC_SHA, verify.BASE_ABC_SHA)
        # 底包 = 编成槽框补丁产物：它的目标哈希就是本补丁的基线
        party_apply = _load('equipment_awakening_material_party_apply_probe',
                            '../equipment-enhanced-party-frame/apply_equipment_enhanced_party_frame.py')
        self.assertEqual((party_apply.TARGET_ABC_SHA, party_apply.TARGET_SWF_SHA), (BASE_ABC_SHA, BASE_SWF_SHA))
        self.assertTrue(package_mod.BASE_APK_SHA.startswith('2f085757'))
        # 编成槽框 a 版在它自己的 apply 里就是 superseded；这里同样拒绝
        self.assertEqual('equipment-enhanced-party-frame a (APK 14396ce0)',
                         apply_mod.SUPERSEDED_ABC_SHAS.get(party_apply.SUPERSEDED_ABC_SHA))
        self.assertNotIn(BASE_ABC_SHA, apply_mod.SUPERSEDED_ABC_SHAS)
        self.assertNotIn(TARGET_ABC_SHA, apply_mod.SUPERSEDED_ABC_SHAS)

    def test_capability_and_key_shape_agree_with_data_side_gate(self):
        """数据侧门禁（wf_client_legality）与补丁同一能力名、同一前缀；门禁可以比客户端更严，不能更松。"""
        legality = _mod_tools_module('equipment_awakening_material_legality_probe', 'wf_client_legality.py')
        self.assertEqual(rules.CAPABILITY, legality.EQUIPMENT_AWAKENING_MATERIAL)
        self.assertEqual(rules.PREFIX, legality.AWAKENING_MATERIAL_KEY_PREFIX)
        key = rules.material_key(5910101)
        self.assertEqual([rules.CAPABILITY], legality.required_client_capabilities(
            legality.CUSTOM_ABILITY_STRING_KIND, [key]))
        self.assertEqual([], legality.equipment_key_problems(key, str(STEEL)))
        # 客户端判「受限但值坏」的值，门禁全部拒绝
        for value in verify.BAD_VALUES:
            if value is None or value == '10000999':
                # None：CSV 一格写不出 null（空格 = 空串，下一项已覆盖）；10000999 形状合法、道具不存在，
                # 由构建器对照 live 道具表拦（wf_weapon_awaken：CAS 值必须指向存在且 c6≠6 的行）
                continue
            self.assertTrue(legality.equipment_key_problems(key, value), value)

    def test_data_contract_matches_the_weapon_awaken_builder(self):
        """构建器 wf_weapon_awaken 写的 30 行就是补丁读的键：同一前缀、同一组装备、值都是禁忌星铁。"""
        awaken = _mod_tools_module('equipment_awakening_material_builder_probe', 'wf_weapon_awaken.py')
        self.assertEqual(rules.PREFIX, awaken.CAS_PREFIX)
        self.assertEqual(STEEL, awaken.STAR_STEEL_ID)
        self.assertEqual(set(verify.RESTRICTED), set(awaken.RESTRICTED_EQUIPMENT))
        self.assertEqual(30, len(awaken.RESTRICTED_EQUIPMENT))
        self.assertEqual({rules.material_key(eid): [str(STEEL)] for eid in verify.RESTRICTED}, awaken.cas_rows())
        self.assertEqual({k: [v] for k, v in verify.ROWS.items()}, awaken.cas_rows())

    def test_interpreter_is_the_shared_v1_module(self):
        look = awaken_interp.look
        self.assertIs(look, sys.modules['equipment_enhanced_look_interp'])
        self.assertEqual((PATCH_DIR.parent / 'equipment-enhanced-look/look_interp.py').resolve(),
                         Path(look.__file__).resolve())
        self.assertIs(awaken_interp.AwakenInterp, look.LookInterp)

    def test_expected_matrix_is_self_consistent(self):
        self.assertEqual(set(verify.SCENARIOS), set(verify.EXPECTED))
        self.assertEqual(set(verify.MUTANTS), set(verify.MUTANT_TARGETS))
        for targets in verify.MUTANT_TARGETS.values():
            self.assertLessEqual(set(targets), set(verify.SCENARIOS))
        self.assertEqual(32, len(verify.SCENARIOS))
        self.assertEqual(21, len(verify.HITS))
        for name in verify.SCENARIOS:
            native = verify.native(name)
            self.assertEqual(([], [], [], []), (native['maybe_tables'], native['lookups'], native['item_lookups'],
                                                native['gets']))
            # 原生绝不会提供禁忌星铁（它不是 c6=6 的觉醒晶）
            self.assertNotEqual(('Some', STEEL), native['result'], name)
        # 受限装备在补丁下从不拿到星铁钢，除非数据自己把值写成星铁钢
        for name, spec in verify.SCENARIOS.items():
            if spec['equipment'][0] in verify.RESTRICTED and name != 'value_names_official_crystal' \
                    and spec.get('cas_loaded', True):
                self.assertNotIn(verify.EXPECTED[name]['result'], (('Some', CRYSTAL4), ('Some', CRYSTAL5)), name)


@unittest.skipUnless(BASE.is_file(), 'local equipment-enhanced-party-frame client SWF fixture unavailable')
class EquipmentAwakeningMaterialTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert sha(BASE.read_bytes()) == BASE_SWF_SHA
        cls.swf, cls.editor, cls.report = build()
        cls.abc = cls.swf.abc
        cls.base_abc = SwfAbc(BASE).abc
        assert sha(cls.base_abc.serialize()) == BASE_ABC_SHA
        cls.locks = json.loads((PATCH_DIR / 'baseline.json').read_text(encoding='utf8'))
        cls.results = verify.awaken_matrix(cls.abc)
        cls.native_results = verify.awaken_matrix(cls.base_abc)

    # ------------------------------------------------------------------ 结构与方法锁
    def test_lock_describes_the_party_frame_baseline(self):
        self.assertEqual({rules.LABEL: 19792}, {k: v['index'] for k, v in self.locks.items()})
        lock = self.locks[rules.LABEL]
        body = self.base_abc.bodies[bodies.resolve(self.base_abc, rules.LABEL)]
        self.assertEqual(lock['index'], bodies.resolve(self.base_abc, rules.LABEL))
        self.assertEqual(lock['sha'], sha(body[5]))
        self.assertEqual([2, 5, 1, 2], lock['header'])
        self.assertEqual(lock['header'], list(body[1:5]))
        self.assertTrue(lock['sha'].startswith('4a0f7a7fdb0c5ffe'))
        self.assertEqual(127, len(body[5]))

    def test_locked_body_is_byte_identical_in_the_older_abcs(self):
        seen = 0
        for name, path in {**OLDER_SWFS, 'equipment-enhanced-party-frame a 016cd927': PARTY_A_SWF}.items():
            if not path.is_file():
                continue
            seen += 1
            abc = SwfAbc(path).abc
            lock = self.locks[rules.LABEL]
            body = abc.bodies[bodies.resolve(abc, rules.LABEL)]
            self.assertEqual((lock['index'], lock['sha'], lock['header']),
                             (bodies.resolve(abc, rules.LABEL), sha(body[5]), list(body[1:5])), name)
        if not seen:
            self.skipTest('older client SWFs unavailable')

    def test_a_foreign_method_body_is_refused_without_fallback(self):
        swf = SwfAbc(BASE)
        body = swf.abc.bodies[bodies.resolve(swf.abc, rules.LABEL)]
        body[1] += 1                       # 同一指令、不同 header：锁不符
        with self.assertRaisesRegex(asm.AsmError, 'unknown method baseline: ' + rules.LABEL):
            overlay.patch_editor(swf)
        swf = SwfAbc(BASE)
        body = swf.abc.bodies[bodies.resolve(swf.abc, rules.LABEL)]
        ins = asm.decode(body[5])
        ins[34] = asm.Instruction(0x02)    # isAvailable 之后的 convert_b -> nop：形状仍对，sha 不对
        body[5] = asm.encode(ins)[0]
        with self.assertRaisesRegex(asm.AsmError, 'unknown method baseline: ' + rules.LABEL):
            overlay.patch_editor(swf)

    def test_anchor_shape_change_is_refused(self):
        """锚点附近的原生指令换了（哪怕方法锁被人改过）也拒绝：find_anchor 先于方法锁检查形状。"""
        swf = SwfAbc(BASE)
        body = swf.abc.bodies[bodies.resolve(swf.abc, rules.LABEL)]
        ins = asm.decode(body[5])
        ins[13] = asm.Instruction(0x5E, [ins[5].args[0]])     # findproperty get_rarity -> findproperty hasStack
        body[5] = asm.encode(ins)[0]
        with self.assertRaisesRegex(asm.AsmError, 'native #13 changed'):
            overlay.patch_editor(swf)
        swf = SwfAbc(BASE)
        body = swf.abc.bodies[bodies.resolve(swf.abc, rules.LABEL)]
        ins = asm.decode(body[5])
        ins[8].target = 9                  # hasStack 的 iffalse 不再落到 #12
        body[5] = asm.encode(ins)[0]
        with self.assertRaisesRegex(asm.AsmError, 'incoming branches'):
            overlay.patch_editor(swf)

    def test_only_the_locked_body_changes_and_the_insertion_is_reversible(self):
        self.assertEqual(set(self.locks), set(self.report['methods']))
        self.assertEqual(len(self.base_abc.bodies) - 1, self.report['unchanged_method_bodies'])
        self.assertEqual(92567, self.report['unchanged_method_bodies'])
        self.assertEqual(rules.INSERTED_COUNTS, self.report['inserted_counts'])
        self.assertEqual(verify.EXPECTED_HEADERS, self.report['headers'])
        fix = lambda ins: [asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in ins]  # noqa: E731
        change = self.report['methods'][rules.LABEL]
        body = self.abc.bodies[bodies.resolve(self.abc, rules.LABEL)]
        self.assertEqual(self.locks[rules.LABEL]['sha'], change['before'])
        self.assertEqual([(rules.ANCHOR, rules.INSERTED_COUNT, asm.ENTER)], [tuple(x) for x in change['insertions']])
        self.assertEqual(self.locks[rules.LABEL]['sha'], sha(asm.unsplice_many(body[5], change['insertions'])))
        native = asm.decode(self.base_abc.bodies[bodies.resolve(self.base_abc, rules.LABEL)][5])
        before = asm.simulate(fix(native), body[3], self.abc.multinames)
        after = asm.simulate(fix(asm.decode(body[5])), body[3], self.abc.multinames)
        self.assertEqual(before[1], after[1])          # 作用域深度不变
        self.assertEqual(before[2], after[2])          # 死代码数不变，插入段全部可达
        self.assertEqual(2, after[0])                   # maxstack 不变
        # ENTER：hasStack 为假的 iffalse 落到插入段开头，原生按稀有度查询挪到段后
        patched = asm.decode(body[5])
        self.assertEqual(rules.ANCHOR, patched[8].target)
        self.assertEqual('getlocal_1', patched[rules.ANCHOR + rules.INSERTED_COUNT].name)

    def test_patched_abc_is_the_locked_target_and_reproducible(self):
        self.assertEqual(TARGET_ABC_SHA, sha(self.abc.serialize()))
        again, _, _ = build()
        self.assertEqual(self.abc.serialize(), again.abc.serialize())

    def test_constant_pool_only_appends_the_prefix(self):
        pool = self.report['pool']
        self.assertEqual(['awakening_material_'], pool['added_strings'])
        self.assertEqual([], pool['added_multinames'])
        self.assertEqual([], pool['added_ints'])

    def test_stacked_patch_bodies_and_tables_preserved(self):
        result = verify.preservation(SwfAbc(BASE), self.swf)
        self.assertTrue(result['ok'], {k: v for k, v in result.items() if k != 'pools'})
        self.assertEqual([19792], result['changed_bodies'])
        self.assertEqual(0, result['added_bodies'])
        labels = result['stacked_patch_bodies']
        for label in ('PartyItemThumbnailView/updateEnhancedEffectAnimation', 'EquipmentEnhancementLogic/getPixelart',
                      'ItemThumbnailView/setRarity', 'AbilitySoulAbilityLogic/getDescriptionsWithoutAdditional',
                      'BattleCharacterLogic/getAvailableAbilities'):
            self.assertEqual('identical', labels[label], label)
        self.assertEqual({'identical'}, set(labels.values()))

    def test_static_proof_block_is_isolated_from_the_native_body(self):
        proof = verify.static_proof(self.base_abc, self.abc)
        self.assertTrue(proof['ok'], proof)
        item = proof[rules.LABEL]
        self.assertNotIn(rules.GET_MASTER, item['calls'])
        self.assertNotIn(rules.NATIVE_PICK, item['calls'])
        self.assertIn(rules.MAYBE, item['calls'])
        self.assertEqual(2, item['returns_in_block'])
        self.assertTrue(item['hasstack_guard_enters_block'])

    def test_static_proof_detects_a_call_to_the_native_pick(self):
        """「绝不调用按稀有度挑道具」本身要能变红：插入一次 getEquipmentAwakingCrystal 必须被认出。"""
        swf, _, _ = build(mutate=verify._replace(
            lambda e: [('label', 'NONE')],
            lambda e: [('label', 'NONE'), ('getlocal_1',), ('pushbyte', 5),
                       ('callproperty', e.q(rules.NATIVE_PICK), 1), ('pop',)]))
        proof = verify.static_proof(self.base_abc, swf.abc)
        self.assertFalse(proof[rules.LABEL]['never_calls_throwing_getter_or_native_pick'])
        self.assertFalse(proof['ok'])

    def test_stack_probe_detects_a_non_empty_stack(self):
        after = self.abc.bodies[bodies.resolve(self.abc, rules.LABEL)]
        entry = rules.ANCHOR + rules.INSERTED_COUNT
        self.assertTrue(verify._stack_empty_at(after, entry, self.abc.multinames))
        self.assertFalse(verify._stack_empty_at(after, entry + 1, self.abc.multinames))   # getlocal_1 之后

    def test_patching_twice_is_refused(self):
        with self.assertRaises(asm.AsmError):
            overlay.patch_editor(self.swf)

    # ------------------------------------------------------------------ 行为矩阵
    def test_awaken_matrix_on_patched_build(self):
        mismatches = {k: [self.results[k], verify.expected(k)] for k in verify.SCENARIOS
                      if self.results[k] != verify.expected(k)}
        self.assertEqual({}, mismatches)
        self.assertEqual(32, len(self.results))
        self.assertEqual({}, {k: v['result'] for k, v in self.results.items() if v['result'][0] in ('error', 'throw')})

    def test_restricted_equipment_offers_only_the_forbidden_steel(self):
        for name in ('cursed_offers_forbidden_steel', 'cursed_last_offers_forbidden_steel',
                     'paradox_offers_forbidden_steel'):
            self.assertEqual(('Some', STEEL), self.results[name]['result'], name)
            self.assertEqual(0, self.results[name]['native_picks'], name)
            self.assertEqual(('Some', CRYSTAL5), self.native_results[name]['result'], name)   # 原生：星铁钢

    def test_restricted_without_material_is_none_even_holding_star_steel(self):
        for name in ('cursed_steel_zero_never_star_steel', 'cursed_nothing_held', 'expired_material_is_none',
                     'item_table_not_loaded_is_none'):
            self.assertEqual(('None',), self.results[name]['result'], name)
            self.assertEqual(0, self.results[name]['native_picks'], name)
        self.assertEqual(('Some', CRYSTAL5), self.native_results['cursed_steel_zero_never_star_steel']['result'])

    def test_bad_values_fail_closed(self):
        for value, suffix in verify.BAD_VALUES.items():
            result = self.results['bad_value_' + suffix]
            self.assertEqual(('None',), result['result'], value)
            self.assertEqual([], result['gets'], value)
            self.assertEqual(0, result['native_picks'], value)

    def test_official_equipment_is_unchanged(self):
        for name in ('official5_offers_star_steel', 'official4_offers_4star_steel', 'official3_offers_4star_steel',
                     'official5_no_crystal', 'official_with_all_keys_is_native', 'cas_table_not_loaded_is_native'):
            self.assertEqual(self.native_results[name]['result'], self.results[name]['result'], name)
            self.assertEqual(1, self.results[name]['native_picks'], name)
            self.assertEqual([], self.results[name]['gets'], name)

    def test_stack_path_never_enters_the_block(self):
        for name in ('official5_has_stack', 'cursed_has_stack_uses_stack', 'paradox_has_stack_uses_stack'):
            self.assertEqual(verify._untouched(('None',)), self.results[name], name)

    def test_data_driven_value_is_honoured(self):
        """值写成星铁钢时补丁照给（补丁只执行数据；「值必须指向 c6≠6 的道具」由构建器门禁保证）。"""
        self.assertEqual(('Some', CRYSTAL5), self.results['value_names_official_crystal']['result'])

    def test_fallthrough_reaches_native_entry_only_when_unrestricted(self):
        fall = verify.fallthrough(self.abc)
        self.assertEqual(len(verify.FALLTHROUGH_SCENARIOS), len(fall))
        for key, value in fall.items():
            self.assertEqual(verify.fallthrough_expected(key), value, key)
        self.assertIn(('native_entry',), fall.values())
        self.assertIn(('Some', STEEL), fall.values())

    # ------------------------------------------------------------------ 负对照
    def test_negative_control_unpatched_baseline_is_native_everywhere(self):
        for name in verify.SCENARIOS:
            self.assertEqual(verify.native(name), self.native_results[name], name)
        self.assertEqual(set(verify.DIFFERS_FROM_NATIVE),
                         {k for k in verify.DIFFERS_FROM_NATIVE if self.native_results[k] != verify.expected(k)})
        touched = [k for k, v in self.native_results.items()
                   if v['maybe_tables'] or v['lookups'] or v['item_lookups'] or v['gets']]
        self.assertEqual([], touched)

    def test_negative_control_mutants_turn_assertions_red(self):
        for name, mutate in verify.MUTANTS.items():
            with self.subTest(mutant=name):
                swf, _, _ = build(mutate=mutate)
                red = verify.red_assertions(swf.abc)
                self.assertTrue(red, name)
                for target in verify.MUTANT_TARGETS[name]:
                    self.assertIn(target, red, name)

    def test_deleting_the_item_row_check_crashes_on_a_missing_item(self):
        swf, _, _ = build(mutate=verify.MUTANTS['drop_item_row_check'])
        result = verify.run_scenario(swf.abc, 'bad_value_missing_item')
        self.assertEqual(('throw', 'TypeError'), result['result'])

    # ------------------------------------------------------------------ 交付入口
    def test_apply_entry_check_prepare_idempotence_and_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            apk = root / 'receiver.apk'
            with zipfile.ZipFile(apk, 'w') as archive:
                archive.write(BASE, apply_mod.SWF_MEMBER)
                archive.writestr('assets/receiver.txt', b'receiver-only resource')
            before = apk.read_bytes()
            checked = apply_mod.prepare(apk, check_only=True)
            self.assertEqual('ready', checked['status'])
            self.assertTrue(checked['swf_container_matches_party_frame'])
            result = apply_mod.prepare(apk, root / 'out', mutants=False)
            self.assertEqual('prepared', result['status'])
            self.assertEqual(before, apk.read_bytes())
            self.assertEqual(TARGET_ABC_SHA, result['output_abc_sha256'])
            self.assertEqual(TARGET_SWF_SHA, result['output_swf_sha256'])
            self.assertEqual(sorted(self.locks), result['changed_methods'])
            report = json.loads((root / 'out/patch-report.json').read_text(encoding='utf8'))
            self.assertEqual(BASE_SWF_SHA, report['source_sha256'])
            self.assertEqual([rules.CAPABILITY], report['capabilities_added'])
            self.assertTrue(json.loads((root / 'out/verify-report.json').read_text(encoding='utf8'))['ok'])
            with self.assertRaises(FileExistsError):
                apply_mod.prepare(apk, root / 'out')
            self.assertEqual('already_patched', apply_mod.prepare(result['output_swf'], root / 'unused')['status'])
            self.assertFalse((root / 'unused').exists())
            # 同一主 ABC、不同容器（重新压成 CWS）：按 ABC 认基线，容器只作参考
            raw = SwfAbc(BASE)
            self.assertEqual(b'FWS', raw.signature)
            cws = root / 'recompressed.swf'
            cws.write_bytes(b'CWS' + bytes([raw.version]) + struct.pack('<I', len(raw.body) + 8)
                            + zlib.compress(raw.body))
            state = apply_mod.prepare(cws, check_only=True)
            self.assertEqual(('ready', False), (state['status'], state['swf_container_matches_party_frame']))
            foreign = root / 'foreign.swf'
            foreign.write_bytes(b'not the party-frame client')
            with self.assertRaisesRegex(ValueError, 'Unknown SWF baseline'):
                apply_mod.prepare(foreign, root / 'foreign-out')
            self.assertFalse((root / 'foreign-out').exists())
            # 更老的客户端（v1 / 说明覆盖 / equipment-rules / 1047）主 ABC 不同：拒绝，不降级
            for path in OLDER_SWFS.values():
                if path.is_file():
                    with self.assertRaisesRegex(ValueError, 'Unknown SWF baseline'):
                        apply_mod.prepare(path, check_only=True)
            # 编成槽框 a 版（图标会消失）与叠在 a 上的旧产物：按 superseded 拒绝，提示改用 b 版底包
            for name, path in SUPERSEDED_SWFS.items():
                if path.is_file():
                    with self.subTest(superseded=name), \
                            self.assertRaisesRegex(ValueError, 'Superseded SWF baseline.*2f085757'):
                        apply_mod.prepare(path, root / ('superseded-' + name.split()[-1]))
                    self.assertFalse((root / ('superseded-' + name.split()[-1])).exists())

    def test_package_refuses_mismatched_inputs_before_signing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            swf = root / 'candidate.swf'
            swf.write_bytes(b'candidate')
            apk = root / 'base.apk'
            with zipfile.ZipFile(apk, 'w') as archive:
                archive.writestr(package_mod.SWF_MEMBER, b'some other swf')
            good = {'patch': overlay.PATCH_NAME, 'status': overlay.STATUS, 'output_abc_sha256': TARGET_ABC_SHA,
                    'output_sha256': sha(b'candidate'), 'source_sha256': sha(b'some other swf'), 'methods': {}}

            def args(report, allow_foreign_base=True):
                path = root / 'report.json'
                path.write_text(json.dumps(report), encoding='utf8')
                return argparse.Namespace(base=apk, swf=swf, patch_report=path,
                                          allow_foreign_base=allow_foreign_base)

            package_mod.check_inputs(args(good))
            for field, value, message in (('patch', 'equipment-enhanced-party-frame',
                                           'not an equipment-awakening-material'),
                                          ('output_abc_sha256', BASE_ABC_SHA, 'verified target ABC'),
                                          ('output_sha256', sha(b'x'), 'does not match the patch report'),
                                          ('source_sha256', BASE_SWF_SHA, 'not the SWF this patch was applied to')):
                with self.assertRaisesRegex(ValueError, message):
                    package_mod.check_inputs(args(dict(good, **{field: value})))
            with self.assertRaisesRegex(ValueError, 'not the equipment-enhanced-party-frame b build 2f085757'):
                package_mod.check_inputs(args(good, allow_foreign_base=False))

    def _package_with_fake_signer(self, root, certificate, *, allow_foreign_base=True):
        """用替身代替 battle-rules/build_apk.py（不签名、不碰口令），只验证 package() 自身的拒绝条件。"""
        from unittest import mock
        swf_bytes = b'candidate'
        swf = root / 'candidate.swf'
        swf.write_bytes(swf_bytes)
        base = root / 'base.apk'
        with zipfile.ZipFile(base, 'w') as archive:
            archive.writestr(package_mod.SWF_MEMBER, b'some other swf')
        report = root / 'report.json'
        report.write_text(json.dumps({
            'patch': overlay.PATCH_NAME, 'status': overlay.STATUS, 'output_abc_sha256': TARGET_ABC_SHA,
            'output_sha256': sha(swf_bytes), 'source_sha256': sha(b'some other swf'),
            'methods': {'m': [1, 1, 1, 1]}}), encoding='utf8')
        output = root / 'out' / 'candidate.apk'
        output.parent.mkdir()
        calls = []

        def fake_run(argv, **kwargs):
            calls.append(argv)
            with zipfile.ZipFile(output, 'w') as archive:
                archive.writestr(package_mod.SWF_MEMBER, swf_bytes)
            output.with_suffix('.build-report.json').write_text(json.dumps({
                'status': 'signed_static_candidate', 'installed': False, 'runtime_verified': False,
                'base_sha256': sha(base.read_bytes()), 'apk_sha256': sha(output.read_bytes()),
                'swf_sha256': sha(swf_bytes), 'certificate_sha256': certificate,
                'candidate_capabilities': ['gauge-gain-rules-v1', 'damage-type-rules-v1']}), encoding='utf8')
            return package_mod.subprocess.CompletedProcess(argv, 0, '', '')

        a = argparse.Namespace(base=base, swf=swf, patch_report=report, output=output, work=root / 'work',
                               zipalign=root / 'z', apksigner=root / 's', keystore=root / 'k',
                               ks_pass_env='UNUSED_TEST_ENV', key_pass_env=None,
                               allow_foreign_base=allow_foreign_base)
        with mock.patch.object(package_mod.subprocess, 'run', side_effect=fake_run), \
                mock.patch.object(package_mod, 'main_abc_sha', return_value=TARGET_ABC_SHA):
            try:
                return package_mod.package(a), calls, output.with_suffix('.build-report.json')
            except ValueError as exc:
                return exc, calls, output.with_suffix('.build-report.json')

    def test_package_refuses_a_foreign_base_before_signing(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, calls, _ = self._package_with_fake_signer(Path(tmp), [package_mod.CERTIFICATE_SHA],
                                                              allow_foreign_base=False)
            self.assertIsInstance(result, ValueError)
            self.assertEqual([], calls, 'build_apk.py must not run for a refused base')

    def test_package_refuses_a_foreign_certificate_and_marks_the_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, calls, build_report = self._package_with_fake_signer(Path(tmp), ['00' * 32])
            self.assertIsInstance(result, ValueError)
            self.assertIn('certificate', str(result))
            written = json.loads(build_report.read_text(encoding='utf8'))
            self.assertEqual('refused_certificate_mismatch', written['status'])
            self.assertNotIn(rules.CAPABILITY, written['candidate_capabilities'])

    def test_package_positive_control_with_the_installed_certificate(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, calls, _ = self._package_with_fake_signer(Path(tmp), [package_mod.CERTIFICATE_SHA])
            self.assertIsInstance(result, dict, result)
            self.assertEqual(1, len(calls))
            self.assertEqual(package_mod.capabilities(), result['candidate_capabilities'])
            self.assertEqual(13, len(result['candidate_capabilities']))
            self.assertIn('equipment-enhanced-party-frame-v1', result['candidate_capabilities'])
            self.assertTrue(result['equipment_awakening_material']['certificate_matches_installed'])

    @unittest.skipUnless(BASE_APK.is_file(), 'equipment-enhanced-party-frame b APK unavailable')
    def test_base_apk_carries_the_baseline_swf(self):
        with zipfile.ZipFile(BASE_APK) as archive:
            self.assertEqual(BASE_SWF_SHA, sha(archive.read(apply_mod.SWF_MEMBER)))
        self.assertEqual(package_mod.BASE_APK_SHA, sha(BASE_APK.read_bytes()))
        self.assertEqual('ready', apply_mod.prepare(BASE_APK, check_only=True)['status'])


if __name__ == '__main__':
    unittest.main()
