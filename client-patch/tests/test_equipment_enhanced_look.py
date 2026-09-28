"""equipment-enhanced-look：结构 / 方法锁 / 图标与强化框行为 / 格子复用 / 负对照 / 变异体 / 交付入口。

行为测试执行 SWF 里的真实字节码（equipment-enhanced-look/look_interp.py：以私有模块名重新执行
equipment-description-override/desc_interp.py，不改它，只在私有副本上换成 AS3 的字符串转数语义）。
负对照：同一矩阵在未打补丁的 equipment-description-override 产物上必须全部是原生结果、从不访问
custom_ability_string；删条件 / 删返回 / 前缀写错的变异体必须让断言变红。
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import io
import json
import math
import struct
import sys
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path

PATCH_DIR = Path(__file__).resolve().parents[1] / 'equipment-enhanced-look'
REPO = Path(__file__).resolve().parents[2]
MOD_TOOLS = REPO / 'mod-tools'
FIXTURE_DIR = Path('D:/WF/out/PARADOX-20260928/apk/desc-override-20260928')
BASE = FIXTURE_DIR / 'swf/equipment-description-override.swf'
BASE_APK = FIXTURE_DIR / 'WorldFlipper-equipment-description-override.apk'
OLDER_SWFS = {
    'equipment-rules d99246d9': Path('D:/WF/out/PARADOX-20260928/apk/equipment-rules-20260928/swf/equipment-rules.swf'),
    '1047 d9559f3f': Path('D:/WF/out/PARADOX-20260928/apk/equipment-rules-20260928/swf/baseline.swf'),
}
BASE_SWF_SHA = 'cdc4c1d1fea3080e2974a1417e5179537c9e460e3ce6c13068676921ab410a44'
BASE_ABC_SHA = '4994e23d612c24a7c13072bf641b9b11ca0aa2e36561cb3d521bda16e325c38b'
TARGET_ABC_SHA = 'e87371b709c41b661a48834a40feb10e7379324470ec98f8e3eaf157c148ecce'
TARGET_SWF_SHA = '45ca9985a896b644f35fa3328286ad86dfdcd1146b6d723e499fb79c674be420'
STORE = REPO / '弹国服/WorldFlipper/dummy/download/production/upload'


def _load(name, file):
    """按路径以唯一模块名加载，避免与其他补丁目录的 rules.py / verify.py / overlay.py 互相遮蔽。"""
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATCH_DIR / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


overlay = _load('equipment_enhanced_look_overlay', 'overlay.py')
rules = overlay.rules
asm, bodies, SwfAbc = overlay.asm, overlay.bodies, overlay.SwfAbc
verify = _load('equipment_enhanced_look_verify', 'verify.py')
apply_mod = _load('equipment_enhanced_look_apply', 'apply_equipment_enhanced_look.py')
package_mod = _load('equipment_enhanced_look_package', 'package_apk.py')
look_interp = verify.look_interp
LV120, LV200, BLUEGOLD = verify.LV120, verify.LV200, verify.BLUEGOLD


def build(mutate=None, path=BASE):
    swf = SwfAbc(path)
    editor, report = overlay.patch_editor(swf, mutate=mutate)
    return swf, editor, report


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _legality():
    added = str(MOD_TOOLS) not in sys.path
    if added:
        sys.path.insert(0, str(MOD_TOOLS))
    try:
        spec = importlib.util.spec_from_file_location('equipment_enhanced_look_legality_probe',
                                                      MOD_TOOLS / 'wf_client_legality.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if added:
            sys.path.remove(str(MOD_TOOLS))


class DesignConstantsTest(unittest.TestCase):
    """不需要夹具的设计常量、值格式、解释器语义与 CSV 往返。"""

    def test_key_and_value_shapes(self):
        self.assertEqual('enhanced_pixelart_tier2_item/equipment/mod/paradox/paradox_lv120', rules.tier2_key(LV120))
        self.assertEqual('enhanced_frame_override_item/equipment/mod/paradox/paradox_lv200', rules.frame_key(LV200))
        self.assertEqual('200,item/equipment/mod/paradox/paradox_lv200', rules.tier2_value(200, LV200))
        self.assertEqual(('enhanced_pixelart_tier2_', 'enhanced_frame_override_'), rules.ADDED_STRINGS)
        self.assertEqual({rules.PIXELART: 27, rules.FRAME: 29}, rules.ANCHORS)

    def test_candidate_capabilities_are_description_override_plus_one(self):
        desc_rules = _load('equipment_enhanced_look_desc_rules_probe',
                           '../equipment-description-override/rules.py')
        self.assertEqual('equipment-enhanced-look-v1', rules.CAPABILITY)
        self.assertEqual(sorted(set(desc_rules.INHERITED_CAPABILITIES) | {desc_rules.CAPABILITY}),
                         sorted(rules.INHERITED_CAPABILITIES))
        self.assertEqual(10, len(rules.INHERITED_CAPABILITIES))
        self.assertEqual(sorted(rules.INHERITED_CAPABILITIES + (rules.CAPABILITY,)), package_mod.capabilities())
        for module in (apply_mod, package_mod):
            self.assertEqual(TARGET_ABC_SHA, module.TARGET_ABC_SHA)
        self.assertEqual(TARGET_SWF_SHA, apply_mod.TARGET_SWF_SHA)
        self.assertEqual((BASE_ABC_SHA, BASE_SWF_SHA), (overlay.BASE_ABC_SHA, overlay.BASE_SWF_SHA))
        self.assertEqual(BASE_ABC_SHA, verify.BASE_ABC_SHA)

    def test_capability_and_key_shape_agree_with_data_side_gate(self):
        """数据侧门禁（mod-tools/wf_client_legality.py）与补丁对同一能力名、同一前缀、同一值格式。"""
        legality = _legality()
        if not hasattr(legality, 'EQUIPMENT_ENHANCED_LOOK'):
            self.skipTest('data-side EQUIPMENT_ENHANCED_LOOK not implemented')
        self.assertEqual(rules.CAPABILITY, legality.EQUIPMENT_ENHANCED_LOOK)
        self.assertEqual(rules.TIER2_PREFIX, legality.ENHANCED_PIXELART_TIER2_KEY_PREFIX)
        self.assertEqual(rules.FRAME_PREFIX, legality.ENHANCED_FRAME_OVERRIDE_KEY_PREFIX)
        for key in (rules.tier2_key(LV120), rules.frame_key(LV200)):
            self.assertEqual([rules.CAPABILITY], legality.required_client_capabilities(
                legality.CUSTOM_ABILITY_STRING_KIND, [key]), key)
        self.assertEqual([], legality.enhanced_look_problems(rules.tier2_key(LV120), rules.tier2_value(200, LV200)))
        self.assertEqual([], legality.enhanced_look_problems(rules.frame_key(LV200), BLUEGOLD))
        # 客户端会拒绝的值，门禁也必须拒绝（门禁可以更严，不能更松）
        for name, (rows, *_rest, tier) in verify.ICON_SCENARIOS.items():
            value = rows.get(rules.tier2_key(LV120))
            if name.startswith('malformed_') and value is not None:
                self.assertTrue(legality.enhanced_look_problems(rules.tier2_key(LV120), value), (name, value))

    def test_private_interpreter_copy_leaves_the_precedent_untouched(self):
        desc = look_interp.desc
        self.assertEqual('equipment_enhanced_look_desc_base', desc.__name__)
        self.assertEqual((PATCH_DIR.parent / 'equipment-description-override/desc_interp.py').resolve(),
                         Path(desc.__file__).resolve())
        self.assertIs(desc._to_int, look_interp.to_int32)
        self.assertIs(desc.base, sys.modules['equipment_desc_override_avm_base'])
        self.assertIsNot(desc.base._to_int, look_interp.to_int32)            # equipment-rules 的原函数不动
        precedent = sys.modules.get('equipment_desc_override_desc_interp')
        if precedent is not None:
            self.assertIsNot(precedent._to_int, look_interp.to_int32)       # 先例的模块对象不动

    def test_as3_string_to_int_semantics(self):
        to_int = look_interp.to_int32
        cases = {'200': 200, ' 200 ': 200, '': 0, 'abc': 0, '200.5': 200, '2e2': 200, '0xC8': 200, '+200': 200,
                 '-5': -5, 'Infinity': 0, '-Infinity': 0, 'inf': 0, 'nan': 0, '1_000': 0, '4294967496': 200,
                 '2147483648': -2147483648}
        for text, want in cases.items():
            self.assertEqual(want, to_int(text), text)
        self.assertTrue(math.isnan(look_interp.string_to_number('1_000')))
        # 规范整数判据 String(int(s)) === s 只放行规范十进制
        canonical = [s for s in cases if str(to_int(s)) == s]
        self.assertEqual(['200', '-5'], canonical)

    def test_client_csv_reader_keeps_a_quoted_comma(self):
        csv_check = verify.csv_roundtrip()
        for key, value in csv_check.items():
            if key not in ('value', 'csv_writer_row'):
                self.assertTrue(value, key)
        self.assertEqual('"200,item/equipment/mod/paradox/paradox_lv200"', csv_check['csv_writer_row'])
        parse = verify.client_parse_csv
        self.assertEqual([['a', 'b']], parse(b'a,b'))
        self.assertEqual([['a,b']], parse(b'"a,b"'))
        self.assertEqual([['say "hi"', 'x']], parse(b'"say ""hi""",x'))
        self.assertEqual([['a'], ['b']], parse(b'a\nb'))
        self.assertEqual([['a'], ['b']], parse(b'a\r\nb'))
        for bad, error in ((b'"a', 'UnclosedQuote'), (b'a"b', 'InvalidOpeningQuote'),
                           (b'"a"b', 'InvalidClosingQuote'), (b'a,b\nc', 'InvalidRowWidth')):
            with self.assertRaisesRegex(verify.CsvReaderError, error):
                parse(bad)

    @unittest.skipUnless(STORE.is_dir(), 'local store unavailable')
    def test_client_csv_port_agrees_with_python_csv_on_the_live_table(self):
        """正向对照：移植的客户端读法与 Python csv 在 live custom_ability_string 全表（含 106 个引号多行格）上一致。"""
        sys.path.insert(0, str(MOD_TOOLS))
        try:
            import wf_mod_tool as core
        finally:
            sys.path.remove(str(MOD_TOOLS))
        logical = 'master/string/custom_ability_string.orderedmap'
        table = core.read_orderedmap_file(core.table_path(STORE, logical), logical)
        quoted = 0
        for key, row in zip(table.keys, table.rows):
            quoted += row.startswith(b'"')
            want = next(csv.reader(io.StringIO(row.decode('utf8'))), [''])
            self.assertEqual(want[0] if want else '', verify.client_get_row_string(row), key)
        self.assertGreater(quoted, 0)


@unittest.skipUnless(BASE.is_file(), 'local equipment-description-override client SWF fixture unavailable')
class EquipmentEnhancedLookTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert sha(BASE.read_bytes()) == BASE_SWF_SHA
        cls.swf, cls.editor, cls.report = build()
        cls.abc = cls.swf.abc
        cls.base_abc = SwfAbc(BASE).abc
        assert sha(cls.base_abc.serialize()) == BASE_ABC_SHA
        cls.locks = json.loads((PATCH_DIR / 'baseline.json').read_text(encoding='utf8'))
        cls.icon, cls.icon_probes = verify.icon_matrix(cls.abc)
        cls.frame, cls.frame_probes, cls.frame_textures = verify.frame_matrix(cls.abc)
        cls.native_icon, cls.native_icon_probes = verify.icon_matrix(cls.base_abc)
        cls.native_frame, cls.native_frame_probes, _ = verify.frame_matrix(cls.base_abc)

    # ------------------------------------------------------------------ 结构与方法锁
    def test_locks_describe_the_description_override_baseline(self):
        self.assertEqual(set(rules.TARGETS), set(self.locks))
        self.assertEqual({rules.PIXELART: 18609, rules.FRAME: 85197}, {k: v['index'] for k, v in self.locks.items()})
        for label, lock in self.locks.items():
            index = bodies.resolve(self.base_abc, label)
            body = self.base_abc.bodies[index]
            self.assertEqual(lock['index'], index, label)
            self.assertEqual(lock['sha'], sha(body[5]), label)
            self.assertEqual(lock['header'], list(body[1:5]), label)
        self.assertTrue(self.locks[rules.FRAME]['sha'].startswith('b28fb2b90c53fabc'))   # 设计稿 6.3 的前缀

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
        swf = SwfAbc(BASE)
        body = swf.abc.bodies[bodies.resolve(swf.abc, rules.FRAME)]
        body[1] += 1                       # 同一指令、不同 header：锁不符
        with self.assertRaisesRegex(asm.AsmError, 'unknown method baseline: ItemThumbnailView/setRarity'):
            overlay.patch_editor(swf)
        swf = SwfAbc(BASE)
        body = swf.abc.bodies[bodies.resolve(swf.abc, rules.PIXELART)]
        ins = asm.decode(body[5])
        ins[23] = asm.Instruction(0x02)    # convert_i -> nop：形状仍对，sha 不对
        body[5] = asm.encode(ins)[0]
        with self.assertRaisesRegex(asm.AsmError, 'unknown method baseline: EquipmentEnhancementLogic/getPixelart'):
            overlay.patch_editor(swf)

    def test_only_locked_bodies_change_and_every_insertion_is_reversible(self):
        self.assertEqual(set(self.locks), set(self.report['methods']))
        self.assertEqual(len(self.base_abc.bodies) - len(self.locks), self.report['unchanged_method_bodies'])
        self.assertEqual(92566, self.report['unchanged_method_bodies'])
        self.assertEqual(rules.INSERTED_COUNTS, self.report['inserted_counts'])
        self.assertEqual(verify.EXPECTED_HEADERS, self.report['headers'])
        fix = lambda ins: [asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in ins]  # noqa: E731
        for label, change in self.report['methods'].items():
            body = self.abc.bodies[bodies.resolve(self.abc, label)]
            self.assertEqual(self.locks[label]['sha'], change['before'])
            self.assertEqual([(rules.ANCHORS[label], rules.INSERTED_COUNTS[label], asm.FORBID)],
                             [tuple(x) for x in change['insertions']])
            self.assertEqual(self.locks[label]['sha'], sha(asm.unsplice_many(body[5], change['insertions'])))
            native = asm.decode(self.base_abc.bodies[bodies.resolve(self.base_abc, label)][5])
            before = asm.simulate(fix(native), body[3], self.abc.multinames)
            after = asm.simulate(fix(asm.decode(body[5])), body[3], self.abc.multinames)
            self.assertEqual(before[1], after[1], label)          # 作用域深度不变
            self.assertEqual(before[2], after[2], label)          # 死代码数不变，插入段全部可达
            self.assertEqual(self.locks[label]['header'][0], body[1], label)   # maxstack 不需抬高

    def test_patched_abc_is_the_locked_target_and_reproducible(self):
        self.assertEqual(TARGET_ABC_SHA, sha(self.abc.serialize()))
        again, _, _ = build()
        self.assertEqual(self.abc.serialize(), again.abc.serialize())

    def test_constant_pool_only_appends_two_strings(self):
        pool = self.report['pool']
        self.assertEqual(list(rules.ADDED_STRINGS), pool['added_strings'])
        self.assertEqual([], pool['added_multinames'])
        self.assertEqual([], pool['added_ints'])

    def test_stacked_patch_bodies_and_tables_preserved(self):
        result = verify.preservation(SwfAbc(BASE), self.swf)
        self.assertTrue(result['ok'], {k: v for k, v in result.items() if k != 'pools'})
        self.assertEqual([18609, 85197], result['changed_bodies'])
        self.assertEqual(0, result['added_bodies'])
        labels = result['stacked_patch_bodies']
        for label in ('AbilitySoulAbilityLogic/getDescriptionsWithoutAdditional',
                      'AbilitySoulAbilityLogic/getDescriptionWithoutAdditional',
                      'EquipmentEnhancementAbilityLogic/getAllDescriptionsToMapForDialog',
                      'BattleCharacterLogic/getAvailableAbilities', 'AbilityLogic/getDescriptions'):
            self.assertEqual('identical', labels[label], label)
        self.assertEqual({'identical'}, set(labels.values()))

    def test_static_proof_block_is_isolated_from_the_native_body(self):
        proof = verify.static_proof(self.base_abc, self.abc)
        self.assertTrue(proof['ok'], proof)
        for label in rules.TARGETS:
            self.assertNotIn(rules.GET_MASTER, proof[label]['calls'])
            self.assertIn(rules.MAYBE, proof[label]['calls'])
        self.assertEqual(['enhanced_pixelart_tier2_', ','], proof[rules.PIXELART]['strings'])
        self.assertEqual(['enhanced_frame_override_'], proof[rules.FRAME]['strings'])

    def test_stack_probe_detects_a_non_empty_stack(self):
        """静态证明里的「原生入口栈为空」探针本身要能变红：换一个栈非空的位置必须判 False。"""
        after = self.abc.bodies[bodies.resolve(self.abc, rules.PIXELART)]
        entry = rules.ANCHORS[rules.PIXELART] + rules.INSERTED_COUNTS[rules.PIXELART]
        self.assertTrue(verify._stack_empty_at(after, entry, self.abc.multinames))
        self.assertFalse(verify._stack_empty_at(after, entry + 1, self.abc.multinames))   # getlex Option 之后

    def test_patching_twice_is_refused(self):
        with self.assertRaises(asm.AsmError):
            overlay.patch_editor(self.swf)

    # ------------------------------------------------------------------ 第二图标档
    def test_icon_matrix_on_patched_build(self):
        mismatches = {k: [self.icon[k], v] for k, v in verify.ICON_EXPECTED.items() if self.icon[k] != v}
        self.assertEqual({}, mismatches)
        self.assertEqual(len(verify.ICON_SCENARIOS) * len(verify.LEVELS) * 2, len(self.icon))
        self.assertEqual(46, len(verify.ICON_HITS))
        self.assertEqual({}, {k: v for k, v in self.icon.items() if v[0] in ('error', 'throw')})

    def test_icon_hit_by_level(self):
        """Lv1–119 基础图标，Lv120–199 lv120 图标，Lv200 起 lv200 图标（getPixelart 与唯一消费方一致）。"""
        r = self.icon
        for level, pixelart, shown in ((0, ('None',), verify.BASE_ICON), (119, ('None',), verify.BASE_ICON),
                                       (120, ('Some', LV120), LV120), (199, ('Some', LV120), LV120),
                                       (200, ('Some', LV200), LV200), (250, ('Some', LV200), LV200)):
            self.assertEqual(pixelart, r[('tier2_hit', level, 'pixelart')], level)
            self.assertEqual(('path', shown), r[('tier2_hit', level, 'chain')], level)

    def test_icon_misses_keep_the_lv120_icon(self):
        misses = [name for name in verify.ICON_SCENARIOS
                  if name in ('missing_key', 'empty_value', 'null_value', 'other_icon_key_only',
                              'frame_key_not_an_icon_key', 'table_not_loaded', 'logic_assets_null')
                  or name.startswith('malformed_')]
        self.assertEqual(23, len(misses))          # 16 种畸形值 + 7 种缺失/不可读
        for name in misses:
            for level in verify.LEVELS:
                want = ('Some', LV120) if level >= 120 else ('None',)
                self.assertEqual(want, self.icon[(name, level, 'pixelart')], (name, level))

    def test_icon_level_below_tier_and_tier_below_pixelart0(self):
        r = self.icon
        self.assertEqual(('Some', LV120), r[('tier2_at_121', 120, 'pixelart')])
        self.assertEqual(('Some', LV200), r[('tier2_at_121', 121, 'pixelart')])
        self.assertEqual(('Some', LV200), r[('tier2_equal_to_pixelart0_level', 120, 'pixelart')])
        # 第二档等级低于 pixelart0 等级：仍然只在原方法给出 Some 之后才生效，119 级以下不出现
        self.assertEqual(('None',), r[('tier2_below_pixelart0_level', 119, 'pixelart')])
        self.assertEqual(('Some', LV200), r[('tier2_below_pixelart0_level', 120, 'pixelart')])
        for level in verify.LEVELS:
            self.assertEqual(('None',), r[('no_enhancement_row', level, 'pixelart')], level)
            self.assertEqual(('path', verify.BASE_ICON), r[('no_enhancement_row', level, 'chain')], level)

    def test_icon_probe_uses_the_maybe_table_and_the_pixelart0_key_only(self):
        for key in verify.ICON_KEYS:
            self.assertEqual(verify.icon_expected_probe(key), self.icon_probes[key], key)

    # ------------------------------------------------------------------ 强化框
    def test_frame_matrix_on_patched_build(self):
        self.assertEqual({}, {k: [self.frame[k], v] for k, v in verify.FRAME_EXPECTED.items() if self.frame[k] != v})
        self.assertEqual({}, {k: [self.frame_probes[k]['lookups'], v] for k, v in verify.FRAME_EXPECTED_LOOKUPS.items()
                              if self.frame_probes[k]['lookups'] != v})
        self.assertEqual({'hit_lv200', 'hit_lv200_texture_pending', 'reuse_other_then_lv200', 'reuse_bluegold_twice'},
                         set(verify.FRAME_HITS))

    def test_frame_hit_shows_bluegold_and_keeps_the_sweep(self):
        self.assertEqual((('background', BLUEGOLD), True), self.frame['hit_lv200'])
        self.assertEqual((('background', None), True), self.frame['hit_lv200_texture_pending'])
        self.assertEqual([BLUEGOLD], [p for p in self.frame_textures['hit_lv200'] if p == BLUEGOLD])

    def test_frame_misses_keep_the_pink_frame(self):
        pink = (('rarity', verify.PINK), True)
        for name in ('missing_key', 'empty_value', 'null_value', 'table_not_loaded', 'lv120_icon_keeps_pink'):
            self.assertEqual(pink, self.frame[name], name)
            self.assertEqual([], [p for p in self.frame_textures[name] if p == BLUEGOLD], name)
        self.assertEqual((('rarity', 5), False), self.frame['not_enhanced'])
        self.assertEqual([], self.frame_probes['not_enhanced']['lookups'])
        self.assertEqual((('rarity', verify.PINK), False), self.frame['item_image_none'])
        self.assertEqual({'maybe_tables': [], 'lookups': []}, self.frame_probes['item_image_none'])
        self.assertEqual((('rarity', verify.PINK), True), self.frame['view_null_guard'])
        self.assertEqual((('rarity', verify.PINK), False), self.frame['pass_reward_stone_enhanced'])

    def test_cell_reuse_restores_the_pink_frame(self):
        pink = (('rarity', verify.PINK), True)
        for name in ('reuse_bluegold_then_other_enhanced', 'reuse_texture_arrives_after_reuse',
                     'reuse_bluegold_then_lv120'):
            self.assertEqual(pink, self.frame[name], name)
        self.assertEqual((('rarity', 3), False), self.frame['reuse_bluegold_then_plain_item'])
        self.assertEqual((('background', BLUEGOLD), True), self.frame['reuse_other_then_lv200'])
        self.assertEqual((('background', BLUEGOLD), True), self.frame['reuse_bluegold_twice'])

    def test_late_texture_after_reuse_does_not_reshow_the_background(self):
        """先显示 Lv200（蓝金贴图尚在加载）→ 同一格换成别的强化装备 → 贴图才到：background 容器保持关闭。"""
        world = verify.FrameWorld(self.abc, verify.ROWS_HIT)
        world.cell['showEquipment'](LV200, 5, True, verify.WEAPON)
        self.assertFalse(world.rarity['renderingEnabled'])
        world.cell['showEquipment'](verify.OTHER, 5, True, verify.WEAPON)
        self.assertTrue(world.rarity['renderingEnabled'])
        world.flush()
        self.assertFalse(world.containers['background']['renderingEnabled'])
        self.assertEqual(BLUEGOLD, world.containers['background']['children'][0]['texture']['path'])
        self.assertEqual((('rarity', verify.PINK), True), world.state())

    def test_fallthrough_reaches_native_entry_on_every_miss(self):
        fall = verify.fallthrough(self.abc)
        self.assertEqual(240, len(fall))
        for key, value in fall.items():
            self.assertEqual(verify.fallthrough_expected(key), value, key)

    # ------------------------------------------------------------------ 负对照
    def test_negative_control_unpatched_baseline_is_native_everywhere(self):
        for key in verify.ICON_KEYS:
            self.assertEqual(verify.icon_native_result(key), self.native_icon[key], key)
        for name in verify.FRAME_SCENARIOS:
            self.assertEqual(verify.FRAME_NATIVE[name], self.native_frame[name], name)
        self.assertEqual(set(verify.ICON_HITS),
                         {k for k in verify.ICON_HITS if self.native_icon[k] != verify.ICON_EXPECTED[k]})
        self.assertEqual(set(verify.FRAME_HITS),
                         {k for k in verify.FRAME_HITS if self.native_frame[k] != verify.FRAME_EXPECTED[k]})
        touched = [k for k, v in {**self.native_icon_probes, **self.native_frame_probes}.items()
                   if v['maybe_tables'] or v['lookups']]
        self.assertEqual([], touched)
        # 原生下 Lv200 的 PARADOX 就是粉框：这正是补丁要改的那一格
        self.assertEqual((('rarity', verify.PINK), True), self.native_frame['hit_lv200'])
        self.assertEqual(('path', LV120), self.native_icon[('tier2_hit', 200, 'chain')])

    def test_negative_control_mutants_turn_assertions_red(self):
        for name, mutate in verify.MUTANTS.items():
            with self.subTest(mutant=name):
                swf, _, _ = build(mutate=mutate)
                red = verify.red_assertions(swf.abc)
                self.assertTrue(red, name)
                for target in verify.MUTANT_TARGETS[name]:
                    self.assertIn(target, red, name)

    def test_deleting_the_enhanced_condition_turns_exactly_the_non_enhanced_case_red(self):
        swf, _, _ = build(mutate=verify.MUTANTS['frame_enhanced_condition_deleted'])
        self.assertEqual([('frame', 'not_enhanced')], verify.red_assertions(swf.abc))
        frame, _, _ = verify.frame_matrix(swf.abc)
        self.assertEqual((('background', BLUEGOLD), False), frame['not_enhanced'])

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
            self.assertTrue(checked['swf_container_matches_description_override'])
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
            self.assertEqual(('ready', False), (state['status'], state['swf_container_matches_description_override']))
            foreign = root / 'foreign.swf'
            foreign.write_bytes(b'not the description-override client')
            with self.assertRaisesRegex(ValueError, 'Unknown SWF baseline'):
                apply_mod.prepare(foreign, root / 'foreign-out')
            self.assertFalse((root / 'foreign-out').exists())
            # 更老的客户端（equipment-rules / 1047）主 ABC 不同：拒绝，不降级
            for path in OLDER_SWFS.values():
                if path.is_file():
                    with self.assertRaisesRegex(ValueError, 'Unknown SWF baseline'):
                        apply_mod.prepare(path, check_only=True)

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
            for field, value, message in (('patch', 'equipment-description-override', 'not an equipment-enhanced-look'),
                                          ('output_abc_sha256', BASE_ABC_SHA, 'verified target ABC'),
                                          ('output_sha256', sha(b'x'), 'does not match the patch report'),
                                          ('source_sha256', BASE_SWF_SHA, 'not the SWF this patch was applied to')):
                with self.assertRaisesRegex(ValueError, message):
                    package_mod.check_inputs(args(dict(good, **{field: value})))
            with self.assertRaisesRegex(ValueError, 'not the installed equipment-description-override build'):
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
            self.assertEqual(11, len(result['candidate_capabilities']))
            self.assertTrue(result['equipment_enhanced_look']['certificate_matches_installed'])

    @unittest.skipUnless(BASE_APK.is_file(), 'installed equipment-description-override APK unavailable')
    def test_installed_apk_carries_the_baseline_swf(self):
        with zipfile.ZipFile(BASE_APK) as archive:
            self.assertEqual(BASE_SWF_SHA, sha(archive.read(apply_mod.SWF_MEMBER)))
        self.assertEqual('ready', apply_mod.prepare(BASE_APK, check_only=True)['status'])


if __name__ == '__main__':
    unittest.main()
