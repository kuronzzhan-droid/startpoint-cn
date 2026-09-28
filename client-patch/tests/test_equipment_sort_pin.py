"""equipment-sort-pin：结构 / 方法锁 / 比较矩阵 / 全序模拟 / 负对照 / 变异体 / 交付入口（含叠加打包）/ 数据合同。

行为测试执行 SWF 里的真实字节码（equipment-sort-pin/sort_interp.py = v1 的 look_interp，同一模块对象）：
``EquipmentListScene.compareByEquipmentStatus`` 与 ``EquipmentSelectThumbnailListRepository.sortByRarity``，
每个场景两个方法 × 两个顺序。基线（equipment-awakening-material 的产物 22292c21）在 setUpClass 里由编成槽框
客户端 SWF 现打出来，并核对它等于觉醒补丁的锁定目标。负对照：同一矩阵在基线上必须全部是原生结果、
从不访问 custom_ability_string；9 个变异体必须让断言变红。编成槽框 a 版链上的旧产物（07bc8022 / a6c38cbf）按
superseded 拒绝。
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

PATCH_DIR = Path(__file__).resolve().parents[1] / 'equipment-sort-pin'
REPO = Path(__file__).resolve().parents[2]
MOD_TOOLS = REPO / 'mod-tools'
FIXTURE_DIR = Path('D:/WF/out/PARADOX-20260928/apk/enhanced-look-party-20260928b')
PARTY_SWF = FIXTURE_DIR / 'swf/equipment-enhanced-party-frame.swf'
PARTY_APK = FIXTURE_DIR / 'WorldFlipper-equipment-enhanced-party-frame.apk'
PARTY_SWF_SHA = '5bd476f6effd1452a8d2508bbc721e1bc1636a5eb62b226005511eb698627162'
#: 编成槽框 a 版（APK 14396ce0，「武器图标会消失」）：不是本补丁的基线，只用于方法锁对照与拒绝测试。
PARTY_A_SWF = Path('D:/WF/out/PARADOX-20260928/apk/enhanced-look-party-20260928/swf/equipment-enhanced-party-frame.swf')
BASE_ABC_SHA = '22292c21361fa505bccd563852810e6fb1d696ae03823f05ff694a74fbdf2ec1'
BASE_SWF_SHA = '15c8cba8eb86c8e86be2d9508b810d7a4288b7aa000a4ae7e215e1c2132efa0a'
TARGET_ABC_SHA = 'c39746e01bc14323d06873a698e40b9480f8b1552a70b0861995edb8ef6f509c'
TARGET_SWF_SHA = '52faeeb777f02fc2942080b0f99e0c3b9d346fcb823fc1d8e115b9adf0b30468'
OLDER_SWFS = {
    'equipment-enhanced-party-frame b 2a9583cd': PARTY_SWF,
    'equipment-enhanced-party-frame a 016cd927': PARTY_A_SWF,
    'equipment-enhanced-look e87371b7':
        Path('D:/WF/out/PARADOX-20260928/apk/enhanced-look-20260928/swf/equipment-enhanced-look.swf'),
    '1047 d9559f3f': Path('D:/WF/out/PARADOX-20260928/apk/equipment-rules-20260928/swf/baseline.swf'),
}
#: 作废的 a 版链（编成槽框 a 版「武器图标会消失」）：叠在 a 上的觉醒专属素材旧产物与本补丁旧产物。
OLD_CHAIN = Path('D:/WF/out/weapon-client-patches-20260928/swf')
SUPERSEDED_SWFS = {
    'equipment-awakening-material on a 07bc8022': OLD_CHAIN / 'awakening-material/equipment-awakening-material.swf',
    'equipment-sort-pin on a a6c38cbf': OLD_CHAIN / 'sort-pin/equipment-sort-pin.swf',
}


def _load(name, file):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATCH_DIR / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


overlay = _load('equipment_sort_pin_overlay', 'overlay.py')
rules = overlay.rules
asm, bodies, SwfAbc = overlay.asm, overlay.bodies, overlay.SwfAbc
verify = _load('equipment_sort_pin_verify', 'verify.py')
apply_mod = _load('equipment_sort_pin_apply', 'apply_equipment_sort_pin.py')
package_mod = _load('equipment_sort_pin_package', 'package_apk.py')
awaken_overlay = _load('equipment_awakening_material_overlay', '../equipment-awakening-material/overlay.py')
sort_interp = verify.sort_interp
LIST, SELECT = rules.LIST, rules.SELECT


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
    def test_key_shape_and_design_constants(self):
        self.assertEqual('equipment_sort_pin_5920001', rules.pin_key(5920001))
        self.assertEqual('equipment_sort_pin_8000115', rules.pin_key('8000115'))
        self.assertEqual(('equipment_sort_pin_',), rules.ADDED_STRINGS)
        self.assertEqual({LIST: 0, SELECT: 0}, rules.ANCHORS)
        self.assertEqual(92, rules.INSERTED_COUNT)
        self.assertEqual(list(range(3, 12)), sorted(rules.LOCALS.values()))
        self.assertEqual({LIST: 38, SELECT: 23}, rules.NATIVE_LENGTHS)

    def test_candidate_capabilities_are_the_stack_plus_one(self):
        awaken_rules = _load('equipment_sort_pin_awaken_rules_probe', '../equipment-awakening-material/rules.py')
        self.assertEqual('equipment-sort-pin-v1', rules.CAPABILITY)
        self.assertEqual(sorted(set(awaken_rules.INHERITED_CAPABILITIES) | {awaken_rules.CAPABILITY}),
                         sorted(rules.INHERITED_CAPABILITIES))
        self.assertEqual(13, len(rules.INHERITED_CAPABILITIES))
        caps = package_mod.capabilities()
        self.assertEqual(14, len(caps))
        self.assertIn('equipment-awakening-material-v1', caps)
        self.assertIn('equipment-enhanced-party-frame-v1', caps)
        self.assertEqual((BASE_ABC_SHA, BASE_SWF_SHA), (overlay.BASE_ABC_SHA, overlay.BASE_SWF_SHA))
        self.assertEqual(BASE_ABC_SHA, verify.BASE_ABC_SHA)
        for module in (apply_mod, package_mod):
            self.assertEqual(TARGET_ABC_SHA, module.TARGET_ABC_SHA)
        self.assertEqual(TARGET_SWF_SHA, apply_mod.TARGET_SWF_SHA)
        # 底包 = 觉醒专属素材产物：它的目标哈希就是本补丁的基线；叠加打包认同一个值
        awaken_apply = _load('equipment_sort_pin_awaken_apply_probe',
                             '../equipment-awakening-material/apply_equipment_awakening_material.py')
        self.assertEqual((awaken_apply.TARGET_ABC_SHA, awaken_apply.TARGET_SWF_SHA), (BASE_ABC_SHA, BASE_SWF_SHA))
        self.assertEqual(BASE_ABC_SHA, package_mod.STACK_TARGET_ABC_SHA)
        self.assertEqual(awaken_overlay.PATCH_NAME, package_mod.STACK_PATCH)
        self.assertTrue(package_mod.BASE_APK_SHA.startswith('2f085757'))
        # 觉醒层在 a 版上打出的旧产物，正是本补丁作废的基线
        awaken_old = set(awaken_apply.SUPERSEDED_ABC_SHAS) - {awaken_apply.overlay.BASE_ABC_SHA}
        self.assertEqual({'07bc80224d299fc92959637322b2aa9bc72918fbe9370b7476ed5b79814d5800'},
                         awaken_old & set(apply_mod.SUPERSEDED_ABC_SHAS))
        self.assertNotIn(BASE_ABC_SHA, apply_mod.SUPERSEDED_ABC_SHAS)
        self.assertNotIn(TARGET_ABC_SHA, apply_mod.SUPERSEDED_ABC_SHAS)

    def test_capability_and_key_shape_agree_with_data_side_gate(self):
        legality = _mod_tools_module('equipment_sort_pin_legality_probe', 'wf_client_legality.py')
        self.assertEqual(rules.CAPABILITY, legality.EQUIPMENT_SORT_PIN)
        self.assertEqual(rules.PREFIX, legality.EQUIPMENT_SORT_PIN_KEY_PREFIX)
        key = rules.pin_key(5920001)
        self.assertEqual([rules.CAPABILITY], legality.required_client_capabilities(
            legality.CUSTOM_ABILITY_STRING_KIND, [key]))
        self.assertEqual([], legality.equipment_key_problems(key, '1000'))
        for value in verify.BAD_VALUES:
            if value is None:
                continue
            self.assertTrue(legality.equipment_key_problems(key, value), value)

    def test_data_contract_matches_the_sort_pin_tool(self):
        tool = _mod_tools_module('equipment_sort_pin_tool_probe', 'wf_weapon_sort_pin.py')
        self.assertEqual(rules.PREFIX, tool.PREFIX)
        self.assertEqual(verify.PINS, tool.PINS)
        self.assertEqual({k: [v] for k, v in verify.ROWS.items()}, tool.cas_rows())
        self.assertEqual(46, len(tool.PINS))

    def test_interpreter_is_the_shared_v1_module(self):
        look = sort_interp.look
        self.assertIs(look, sys.modules['equipment_enhanced_look_interp'])
        self.assertIs(sort_interp.SortInterp, look.LookInterp)

    def test_expected_matrix_is_self_consistent(self):
        self.assertEqual(set(verify.MUTANTS), set(verify.MUTANT_TARGETS))
        for targets in verify.MUTANT_TARGETS.values():
            self.assertLessEqual(set(targets), set(verify.SCENARIOS))
        self.assertEqual(31, len(verify.SCENARIOS))
        for name in verify.SCENARIOS:
            want = verify.expected(name)
            for label in rules.TARGETS:
                ab, ba = want[label]
                self.assertTrue(ab and ba and (ab > 0) == (ba < 0), (name, label, want[label]))
        self.assertEqual(verify.PIN_ORDER[0], verify.PARADOX)
        self.assertEqual(verify.PIN_ORDER[-1], verify.DEATHBRINGER)


class _Fixture:
    tmp = None
    base_path = None

    @classmethod
    def base(cls):
        """觉醒专属素材产物（本补丁的基线）：由编成槽框 SWF 现打，核对等于觉醒补丁的锁定目标。"""
        if cls.base_path is None:
            cls.tmp = tempfile.TemporaryDirectory()
            swf = SwfAbc(PARTY_SWF)
            awaken_overlay.patch_editor(swf)
            path = Path(cls.tmp.name) / 'equipment-awakening-material.swf'
            swf.save(path)
            if sha(path.read_bytes()) != BASE_SWF_SHA or sha(SwfAbc(path).abc.serialize()) != BASE_ABC_SHA:
                raise AssertionError('awakening-material fixture is not the locked target')
            cls.base_path = path
        return cls.base_path


def build(mutate=None, path=None):
    swf = SwfAbc(path or _Fixture.base())
    editor, report = overlay.patch_editor(swf, mutate=mutate)
    return swf, editor, report


@unittest.skipUnless(PARTY_SWF.is_file(), 'local equipment-enhanced-party-frame client SWF fixture unavailable')
class EquipmentSortPinTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert sha(PARTY_SWF.read_bytes()) == PARTY_SWF_SHA
        cls.base = _Fixture.base()
        cls.swf, cls.editor, cls.report = build()
        cls.abc = cls.swf.abc
        cls.base_abc = SwfAbc(cls.base).abc
        cls.locks = json.loads((PATCH_DIR / 'baseline.json').read_text(encoding='utf8'))
        cls.results = verify.sort_matrix(cls.abc)
        cls.native_results = verify.sort_matrix(cls.base_abc)

    # ------------------------------------------------------------------ 结构与方法锁
    def test_locks_describe_the_awakening_material_baseline(self):
        self.assertEqual({LIST: 70204, SELECT: 70354}, {k: v['index'] for k, v in self.locks.items()})
        for label, prefix in ((LIST, 'fa76aaec0516b16c'), (SELECT, 'c61505266ecd48a0')):
            lock = self.locks[label]
            body = self.base_abc.bodies[bodies.resolve(self.base_abc, label)]
            self.assertEqual(lock['index'], bodies.resolve(self.base_abc, label))
            self.assertEqual(lock['sha'], sha(body[5]))
            self.assertEqual([2, 3, 1, 1], lock['header'])
            self.assertEqual(lock['header'], list(body[1:5]))
            self.assertTrue(lock['sha'].startswith(prefix))

    def test_locked_bodies_are_byte_identical_in_the_older_abcs(self):
        seen = 0
        for name, path in OLDER_SWFS.items():
            if not path.is_file():
                continue
            seen += 1
            abc = SwfAbc(path).abc
            for label, lock in self.locks.items():
                body = abc.bodies[bodies.resolve(abc, label)]
                self.assertEqual((lock['index'], lock['sha'], lock['header']),
                                 (bodies.resolve(abc, label), sha(body[5]), list(body[1:5])), (name, label))
        if not seen:
            self.skipTest('older client SWFs unavailable')

    def test_a_foreign_method_body_is_refused_without_fallback(self):
        for label in rules.TARGETS:
            with self.subTest(label=label):
                swf = SwfAbc(self.base)
                body = swf.abc.bodies[bodies.resolve(swf.abc, label)]
                body[1] += 1
                with self.assertRaisesRegex(asm.AsmError, 'unknown method baseline: ' + label):
                    overlay.patch_editor(swf)

    def test_anchor_shape_change_is_refused(self):
        swf = SwfAbc(self.base)
        body = swf.abc.bodies[bodies.resolve(swf.abc, SELECT)]
        ins = asm.decode(body[5])
        ins[0] = asm.Instruction(0xD2)          # getlocal_1 -> getlocal_2
        body[5] = asm.encode(ins)[0]
        with self.assertRaisesRegex(asm.AsmError, 'native #0 changed'):
            overlay.patch_editor(swf)
        swf = SwfAbc(self.base)
        body = swf.abc.bodies[bodies.resolve(swf.abc, LIST)]
        ins = asm.decode(body[5])
        ins[34] = asm.Instruction(0x66, [ins[1].args[0]])   # 收尾 p2 的 getproperty id -> 别的名字
        body[5] = asm.encode(ins)[0]
        with self.assertRaisesRegex(asm.AsmError, 'id comparison'):
            overlay.patch_editor(swf)

    def test_only_locked_bodies_change_and_every_insertion_is_reversible(self):
        self.assertEqual(set(self.locks), set(self.report['methods']))
        self.assertEqual(len(self.base_abc.bodies) - 2, self.report['unchanged_method_bodies'])
        self.assertEqual(92566, self.report['unchanged_method_bodies'])
        self.assertEqual(rules.INSERTED_COUNTS, self.report['inserted_counts'])
        self.assertEqual(verify.EXPECTED_HEADERS, self.report['headers'])
        fix = lambda ins: [asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in ins]  # noqa: E731
        for label in rules.TARGETS:
            change = self.report['methods'][label]
            body = self.abc.bodies[bodies.resolve(self.abc, label)]
            self.assertEqual(self.locks[label]['sha'], change['before'])
            self.assertEqual([(0, rules.INSERTED_COUNT, asm.FORBID)], [tuple(x) for x in change['insertions']])
            self.assertEqual(self.locks[label]['sha'], sha(asm.unsplice_many(body[5], change['insertions'])))
            native = asm.decode(self.base_abc.bodies[bodies.resolve(self.base_abc, label)][5])
            before = asm.simulate(fix(native), body[3], self.abc.multinames)
            after = asm.simulate(fix(asm.decode(body[5])), body[3], self.abc.multinames)
            self.assertEqual(before[1], after[1])
            self.assertEqual(before[2], after[2])
            self.assertEqual(3, after[0])            # maxstack 2 -> 3（data, 前缀, id）

    def test_patched_abc_is_the_locked_target_and_reproducible(self):
        self.assertEqual(TARGET_ABC_SHA, sha(self.abc.serialize()))
        again, _, _ = build()
        self.assertEqual(self.abc.serialize(), again.abc.serialize())

    def test_constant_pool_only_appends_the_prefix(self):
        pool = self.report['pool']
        self.assertEqual(['equipment_sort_pin_'], pool['added_strings'])
        self.assertEqual([], pool['added_multinames'])
        self.assertEqual([], pool['added_ints'])

    def test_stacked_patch_bodies_and_tables_preserved(self):
        result = verify.preservation(SwfAbc(self.base), self.swf)
        self.assertTrue(result['ok'], {k: v for k, v in result.items() if k != 'pools'})
        self.assertEqual([70204, 70354], result['changed_bodies'])
        labels = result['stacked_patch_bodies']
        for label in ('OwnedEquipmentLogic/getUseableAwakingCrystal',
                      'PartyItemThumbnailView/updateEnhancedEffectAnimation', 'EquipmentEnhancementLogic/getPixelart',
                      'BattleCharacterLogic/getAvailableAbilities'):
            self.assertEqual('identical', labels[label], label)
        self.assertEqual({'identical'}, set(labels.values()))

    def test_static_proof_blocks_are_isolated_from_the_native_bodies(self):
        proof = verify.static_proof(self.base_abc, self.abc)
        self.assertTrue(proof['ok'], proof)
        for label in rules.TARGETS:
            self.assertNotIn(rules.GET_MASTER, proof[label]['calls'])
            self.assertIn(rules.MAYBE, proof[label]['calls'])
            self.assertEqual(3, proof[label]['returns_in_block'])

    def test_stack_probe_detects_a_non_empty_stack(self):
        for label in rules.TARGETS:
            after = self.abc.bodies[bodies.resolve(self.abc, label)]
            self.assertTrue(verify._stack_empty_at(after, rules.INSERTED_COUNT, self.abc.multinames))
            self.assertFalse(verify._stack_empty_at(after, rules.INSERTED_COUNT + 1, self.abc.multinames))

    def test_patching_twice_is_refused(self):
        with self.assertRaises(asm.AsmError):
            overlay.patch_editor(self.swf)

    # ------------------------------------------------------------------ 比较矩阵
    def test_sort_matrix_on_patched_build(self):
        mismatches = {k: [self.results[k], verify.expected(k)] for k in verify.SCENARIOS
                      if self.results[k] != verify.expected(k)}
        self.assertEqual({}, mismatches)
        self.assertEqual(31, len(self.results))
        self.assertEqual(9, len(verify.HITS))

    def test_pin_beats_stack_and_rarity(self):
        result = self.results['cursed_stack0_before_official_stack7']
        self.assertEqual((-1, 1), result[LIST])
        self.assertEqual((7, -7), self.native_results['cursed_stack0_before_official_stack7'][LIST])   # 原生：stack 压过
        self.assertEqual((-1, 1), self.results['pinned_star4_before_official_star5'][SELECT])
        self.assertEqual((1, -1), self.native_results['pinned_star4_before_official_star5'][SELECT])  # 原生：稀有度压过

    def test_pin_order_inside_the_group(self):
        for name, pair in (('paradox_before_cursed', (-1001, 1001)), ('abyss_last_before_deathbringer', (-85, 85)),
                           ('cursed_last_before_abyss_first', (-972, 972)),
                           ('int32_max_does_not_overflow', (2147483646, -2147483646))):
            for label in rules.TARGETS:
                self.assertEqual(pair, self.results[name][label], (name, label))

    def test_invalid_values_and_missing_tables_fall_back_to_native(self):
        names = ['table_not_loaded', 'no_global_logic', 'no_logic_assets', 'missing_row',
                 'equal_pins_fall_back_to_native', 'official_stack_differs', 'official_rarity_differs',
                 'official_same_tier'] + ['bad_value_' + s for s in verify.BAD_VALUES.values()]
        for name in names:
            for label in rules.TARGETS:
                self.assertEqual(self.native_results[name][label], self.results[name][label], (name, label))

    def test_total_order_simulation(self):
        report = verify.total_order(self.abc, self.base_abc)
        self.assertTrue(report['ok'], report)
        self.assertEqual(5100001, report[SELECT]['first_after_pins'])     # 编成：第 47 位接官方 ★5 最小 id
        items = verify.inventory()
        for label in rules.TARGETS:
            got = verify.sort_with(self.abc, label, items)
            self.assertEqual(verify.PIN_ORDER, [spec[0] for spec in got[:46]], label)

    def test_fallthrough_matches_the_expected_exits(self):
        fall = verify.fallthrough(self.abc)
        for name, value in fall.items():
            self.assertEqual(verify.fallthrough_expected(name), value, name)

    # ------------------------------------------------------------------ 负对照
    def test_negative_control_unpatched_baseline_is_native_everywhere(self):
        for name in verify.SCENARIOS:
            self.assertEqual(verify.native(name), self.native_results[name], name)
        touched = [k for k, v in self.native_results.items() if v['maybe_calls'] or v['lookups']]
        self.assertEqual([], touched)
        base_order = verify.sort_with(self.base_abc, SELECT, verify.inventory())
        self.assertNotEqual(verify.PIN_ORDER, [spec[0] for spec in base_order[:46]])   # 原生：我方沉在 ★5 段末尾

    def test_negative_control_mutants_turn_assertions_red(self):
        for name, mutate in verify.MUTANTS.items():
            with self.subTest(mutant=name):
                swf, _, _ = build(mutate=mutate)
                red = verify.red_assertions(swf.abc)
                self.assertTrue(red, name)
                for target in verify.MUTANT_TARGETS[name]:
                    self.assertIn(target, red, name)

    def test_total_order_detects_a_pin_after_the_first_key(self):
        swf, _, _ = build(mutate=verify.MUTANTS['pin_after_first_key'])
        report = verify.total_order(swf.abc)
        self.assertFalse(report[LIST]['head_is_pin_order'])
        self.assertFalse(report['ok'])

    # ------------------------------------------------------------------ 交付入口
    def test_apply_entry_check_prepare_idempotence_and_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            checked = apply_mod.prepare(self.base, check_only=True)
            self.assertEqual('ready', checked['status'])
            self.assertTrue(checked['swf_container_matches_awakening_material'])
            result = apply_mod.prepare(self.base, root / 'out', mutants=False)
            self.assertEqual('prepared', result['status'])
            self.assertEqual(TARGET_ABC_SHA, result['output_abc_sha256'])
            self.assertEqual(TARGET_SWF_SHA, result['output_swf_sha256'])
            self.assertEqual(sorted(self.locks), result['changed_methods'])
            report = json.loads((root / 'out/patch-report.json').read_text(encoding='utf8'))
            self.assertEqual(BASE_SWF_SHA, report['source_sha256'])
            self.assertEqual(BASE_ABC_SHA, report['source_abc_sha256'])
            self.assertEqual([rules.CAPABILITY], report['capabilities_added'])
            self.assertTrue(json.loads((root / 'out/verify-report.json').read_text(encoding='utf8'))['ok'])
            self.assertEqual('already_patched', apply_mod.prepare(result['output_swf'], root / 'unused')['status'])
            self.assertFalse((root / 'unused').exists())
            # 没打觉醒专属素材的编成槽框客户端：主 ABC 不同，拒绝，不降级
            for path in OLDER_SWFS.values():
                if path.is_file():
                    with self.assertRaisesRegex(ValueError, 'Unknown SWF baseline'):
                        apply_mod.prepare(path, check_only=True)
            # 编成槽框 a 版链上的旧产物：按 superseded 拒绝，提示改用 b 版链
            for name, path in SUPERSEDED_SWFS.items():
                if path.is_file():
                    with self.subTest(superseded=name), \
                            self.assertRaisesRegex(ValueError, 'Superseded SWF baseline.*2f085757'):
                        apply_mod.prepare(path, root / ('superseded-' + name.split()[-1]))
                    self.assertFalse((root / ('superseded-' + name.split()[-1])).exists())

    def _chain(self, root):
        """一套自洽的假叠加链：底包 SWF b'party' → 觉醒 b'awaken' → 置顶 b'candidate'。"""
        swf = root / 'candidate.swf'
        swf.write_bytes(b'candidate')
        apk = root / 'base.apk'
        with zipfile.ZipFile(apk, 'w') as archive:
            archive.writestr(package_mod.SWF_MEMBER, b'party')
        report = {'patch': overlay.PATCH_NAME, 'status': overlay.STATUS, 'output_abc_sha256': TARGET_ABC_SHA,
                  'output_sha256': sha(b'candidate'), 'source_sha256': sha(b'awaken'),
                  'source_abc_sha256': BASE_ABC_SHA, 'methods': {LIST: [3, 12, 1, 1]},
                  'capabilities_added': [rules.CAPABILITY]}
        stack = {'patch': 'equipment-awakening-material', 'status': overlay.STATUS,
                 'output_abc_sha256': BASE_ABC_SHA, 'output_sha256': sha(b'awaken'), 'source_sha256': sha(b'party'),
                 'source_abc_sha256': 'x', 'methods': {'OwnedEquipmentLogic/getUseableAwakingCrystal': [2, 14, 1, 2]},
                 'capabilities_added': ['equipment-awakening-material-v1']}
        return swf, apk, report, stack

    def _args(self, root, swf, apk, report, stack, allow_foreign_base=True, **extra):
        (root / 'report.json').write_text(json.dumps(report), encoding='utf8')
        (root / 'stack.json').write_text(json.dumps(stack), encoding='utf8')
        return argparse.Namespace(base=apk, swf=swf, patch_report=root / 'report.json',
                                  stack_report=root / 'stack.json', allow_foreign_base=allow_foreign_base, **extra)

    def test_package_refuses_a_broken_chain_before_signing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            swf, apk, report, stack = self._chain(root)
            package_mod.check_inputs(self._args(root, swf, apk, report, stack))
            for which, field, value, message in (
                    ('report', 'patch', 'equipment-awakening-material', 'not an equipment-sort-pin'),
                    ('report', 'output_abc_sha256', BASE_ABC_SHA, 'verified target ABC'),
                    ('report', 'output_sha256', sha(b'x'), 'does not match the patch report'),
                    ('stack', 'patch', 'equipment-enhanced-party-frame', 'not an equipment-awakening-material'),
                    ('stack', 'output_abc_sha256', TARGET_ABC_SHA, 'stack report ABC'),
                    ('report', 'source_abc_sha256', 'y', 'stack report ABC'),
                    ('stack', 'output_sha256', sha(b'other'), 'was not applied to the SWF the stack report produced'),
                    ('stack', 'source_sha256', sha(b'other'), 'not the SWF the awakening-material patch')):
                bad_report = dict(report, **{field: value}) if which == 'report' else report
                bad_stack = dict(stack, **{field: value}) if which == 'stack' else stack
                with self.subTest(which=which, field=field), self.assertRaisesRegex(ValueError, message):
                    package_mod.check_inputs(self._args(root, swf, apk, bad_report, bad_stack))
            with self.assertRaisesRegex(ValueError, 'not the equipment-enhanced-party-frame b build 2f085757'):
                package_mod.check_inputs(self._args(root, swf, apk, report, stack, allow_foreign_base=False))

    def _package_with_fake_signer(self, root, certificate, *, allow_foreign_base=True):
        from unittest import mock
        swf, apk, report, stack = self._chain(root)
        output = root / 'out' / 'candidate.apk'
        output.parent.mkdir()
        calls = []

        def fake_run(argv, **kwargs):
            calls.append(argv)
            chain = json.loads(Path(argv[argv.index('--patch-report') + 1]).read_text(encoding='utf8'))
            calls.append(chain)
            with zipfile.ZipFile(output, 'w') as archive:
                archive.writestr(package_mod.SWF_MEMBER, b'candidate')
            output.with_suffix('.build-report.json').write_text(json.dumps({
                'status': 'signed_static_candidate', 'installed': False, 'runtime_verified': False,
                'base_sha256': sha(apk.read_bytes()), 'apk_sha256': sha(output.read_bytes()),
                'swf_sha256': sha(b'candidate'), 'certificate_sha256': certificate,
                'candidate_capabilities': ['gauge-gain-rules-v1', 'damage-type-rules-v1']}), encoding='utf8')
            return package_mod.subprocess.CompletedProcess(argv, 0, '', '')

        a = self._args(root, swf, apk, report, stack, allow_foreign_base, output=output, work=root / 'work',
                       zipalign=root / 'z', apksigner=root / 's', keystore=root / 'k',
                       ks_pass_env='UNUSED_TEST_ENV', key_pass_env=None)
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
            result, _calls, build_report = self._package_with_fake_signer(Path(tmp), ['00' * 32])
            self.assertIsInstance(result, ValueError)
            self.assertIn('certificate', str(result))
            written = json.loads(build_report.read_text(encoding='utf8'))
            self.assertEqual('refused_certificate_mismatch', written['status'])
            self.assertNotIn(rules.CAPABILITY, written['candidate_capabilities'])

    def test_package_positive_control_hands_build_apk_a_one_hop_stack_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, calls, _ = self._package_with_fake_signer(Path(tmp), [package_mod.CERTIFICATE_SHA])
            self.assertIsInstance(result, dict, result)
            self.assertEqual(2, len(calls))
            chain = calls[1]
            # build_apk 核对的两项：状态、底包 SWF → 候选 SWF 一跳
            self.assertEqual(overlay.STATUS, chain['status'])
            self.assertEqual((sha(b'party'), sha(b'candidate')), (chain['source_sha256'], chain['output_sha256']))
            self.assertEqual(['equipment-awakening-material', 'equipment-sort-pin'],
                             [layer['patch'] for layer in chain['layers']])
            self.assertEqual(package_mod.capabilities(), result['candidate_capabilities'])
            self.assertEqual(14, len(result['candidate_capabilities']))
            info = result['equipment_weapon_client_patches']
            self.assertTrue(info['certificate_matches_installed'])
            self.assertEqual(sha(b'awaken'), info['intermediate_swf_sha256'])
            self.assertEqual(sorted([LIST, 'OwnedEquipmentLogic/getUseableAwakingCrystal']), info['changed_methods'])

    @unittest.skipUnless(PARTY_APK.is_file(), 'equipment-enhanced-party-frame b APK unavailable')
    def test_party_frame_b_apk_is_the_stack_base(self):
        with zipfile.ZipFile(PARTY_APK) as archive:
            self.assertEqual(PARTY_SWF_SHA, sha(archive.read(package_mod.SWF_MEMBER)))
        self.assertEqual(package_mod.BASE_APK_SHA, sha(PARTY_APK.read_bytes()))


if __name__ == '__main__':
    unittest.main()
