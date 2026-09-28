"""equipment-enhanced-party-frame：结构 / 方法锁 / 编成槽框行为 / 格子复用 / 异步回调 / 负对照 / 变异体 / 交付入口。

行为测试执行 SWF 里的真实字节码（equipment-enhanced-party-frame/party_interp.py = v1 的 look_interp，同一模块对象）：
一格 PartyItemThumbnailView 先经真实 run() 建起来，再按步骤复用；贴图回调由测试决定何时到达。
负对照：同一矩阵在未打补丁的 equipment-enhanced-look 产物（e87371b7）上必须全部是原生结果（粉框）、从不访问
custom_ability_string、从不建图、从不请求框图；11 个变异体必须让断言变红。
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

PATCH_DIR = Path(__file__).resolve().parents[1] / 'equipment-enhanced-party-frame'
REPO = Path(__file__).resolve().parents[2]
MOD_TOOLS = REPO / 'mod-tools'
FIXTURE_DIR = Path('D:/WF/out/PARADOX-20260928/apk/enhanced-look-20260928')
BASE = FIXTURE_DIR / 'swf/equipment-enhanced-look.swf'
BASE_APK = FIXTURE_DIR / 'WorldFlipper-equipment-enhanced-look.apk'
OLDER_SWFS = {
    'equipment-description-override 4994e23d':
        Path('D:/WF/out/PARADOX-20260928/apk/desc-override-20260928/swf/equipment-description-override.swf'),
    'equipment-rules d99246d9': Path('D:/WF/out/PARADOX-20260928/apk/equipment-rules-20260928/swf/equipment-rules.swf'),
    '1047 d9559f3f': Path('D:/WF/out/PARADOX-20260928/apk/equipment-rules-20260928/swf/baseline.swf'),
}
BASE_SWF_SHA = '45ca9985a896b644f35fa3328286ad86dfdcd1146b6d723e499fb79c674be420'
BASE_ABC_SHA = 'e87371b709c41b661a48834a40feb10e7379324470ec98f8e3eaf157c148ecce'
TARGET_ABC_SHA = '016cd9270a5b9c0d2d7ae6e701f5d2bcbe6ac10c59a72d1f003ccd04234169dd'
TARGET_SWF_SHA = '9986dea39831608e44a405619cf234c8cccdcdbc476939bb9b5c53d689d67177'
PARTY_PNG = MOD_TOOLS / 'assets/paradox/paradox_party_frame_bluegold.png'
OFFICIAL_PARTY = Path('D:/WF/out/PARADOX-20260928/lv200-frame/official/party_equipment_rainbow_enhanced.png')


def _load(name, file):
    """按路径以唯一模块名加载，避免与其他补丁目录的 rules.py / verify.py / overlay.py 互相遮蔽。"""
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATCH_DIR / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


overlay = _load('equipment_enhanced_party_frame_overlay', 'overlay.py')
rules = overlay.rules
asm, bodies, SwfAbc = overlay.asm, overlay.bodies, overlay.SwfAbc
verify = _load('equipment_enhanced_party_frame_verify', 'verify.py')
apply_mod = _load('equipment_enhanced_party_frame_apply', 'apply_equipment_enhanced_party_frame.py')
package_mod = _load('equipment_enhanced_party_frame_package', 'package_apk.py')
party_interp = verify.party_interp
LV200, LV120, OTHER, FRAME, PK = verify.LV200, verify.LV120, verify.OTHER, verify.FRAME, verify.PK
PINK = verify.PINK


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
        spec = importlib.util.spec_from_file_location('equipment_enhanced_party_frame_legality_probe',
                                                      MOD_TOOLS / 'wf_client_legality.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if added:
            sys.path.remove(str(MOD_TOOLS))


class DesignConstantsTest(unittest.TestCase):
    """不需要夹具的设计常量、能力声明、数据侧门禁一致性、解释器共享。"""

    def test_key_shape_and_design_constants(self):
        self.assertEqual('enhanced_party_frame_override_item/equipment/mod/paradox/paradox_lv200',
                         rules.party_frame_key(LV200))
        self.assertEqual(('enhanced_party_frame_override_',), rules.ADDED_STRINGS)
        self.assertEqual({rules.LABEL: 2}, rules.ANCHORS)
        self.assertEqual(161, rules.INSERTED_COUNT)
        self.assertEqual(2, min(rules.LOCALS.values()))
        self.assertEqual(list(range(2, 15)), sorted(rules.LOCALS.values()))
        self.assertEqual(72, rules.FRAME_SIZE)
        # 与 v1 的两个前缀互不包含：同一个键不会同时被两个补丁认领
        for prefix in ('enhanced_frame_override_', 'enhanced_pixelart_tier2_'):
            self.assertFalse(rules.PREFIX.startswith(prefix))
            self.assertFalse(prefix.startswith(rules.PREFIX))

    def test_candidate_capabilities_are_enhanced_look_plus_one(self):
        look_rules = _load('equipment_enhanced_party_frame_look_rules_probe', '../equipment-enhanced-look/rules.py')
        self.assertEqual('equipment-enhanced-party-frame-v1', rules.CAPABILITY)
        self.assertEqual(sorted(set(look_rules.INHERITED_CAPABILITIES) | {look_rules.CAPABILITY}),
                         sorted(rules.INHERITED_CAPABILITIES))
        self.assertEqual(11, len(rules.INHERITED_CAPABILITIES))
        self.assertEqual(sorted(rules.INHERITED_CAPABILITIES + (rules.CAPABILITY,)), package_mod.capabilities())
        self.assertEqual(12, len(package_mod.capabilities()))
        for module in (apply_mod, package_mod):
            self.assertEqual(TARGET_ABC_SHA, module.TARGET_ABC_SHA)
        self.assertEqual(TARGET_SWF_SHA, apply_mod.TARGET_SWF_SHA)
        self.assertEqual((BASE_ABC_SHA, BASE_SWF_SHA), (overlay.BASE_ABC_SHA, overlay.BASE_SWF_SHA))
        self.assertEqual(BASE_ABC_SHA, verify.BASE_ABC_SHA)
        # 底包 = v1 产物：v1 的目标哈希就是本补丁的基线
        look_apply = _load('equipment_enhanced_party_frame_look_apply_probe',
                           '../equipment-enhanced-look/apply_equipment_enhanced_look.py')
        self.assertEqual((look_apply.TARGET_ABC_SHA, look_apply.TARGET_SWF_SHA), (BASE_ABC_SHA, BASE_SWF_SHA))

    def test_capability_and_key_shape_agree_with_data_side_gate(self):
        """数据侧门禁（mod-tools/wf_client_legality.py）与补丁同一能力名、同一前缀；新前缀不能归到 v1。"""
        legality = _legality()
        self.assertEqual(rules.CAPABILITY, legality.EQUIPMENT_ENHANCED_PARTY_FRAME)
        self.assertEqual(rules.PREFIX, legality.ENHANCED_PARTY_FRAME_OVERRIDE_KEY_PREFIX)
        key = rules.party_frame_key(LV200)
        self.assertEqual([rules.CAPABILITY], legality.required_client_capabilities(
            legality.CUSTOM_ABILITY_STRING_KIND, [key]))
        self.assertNotEqual(legality.EQUIPMENT_ENHANCED_LOOK, legality.enhanced_look_capability(key))
        self.assertEqual([], legality.enhanced_look_problems(key, FRAME))
        # 客户端会当作未命中的值，门禁也必须拒绝（门禁可以更严，不能更松）
        for value in ('', 'a,b', 'a\nb', FRAME + '.png'):
            self.assertTrue(legality.enhanced_look_problems(key, value), value)

    def test_interpreter_is_the_shared_v1_module(self):
        look = party_interp.look
        self.assertIs(look, sys.modules['equipment_enhanced_look_interp'])
        self.assertEqual((PATCH_DIR.parent / 'equipment-enhanced-look/look_interp.py').resolve(),
                         Path(look.__file__).resolve())
        self.assertIs(party_interp.PartyInterp, look.LookInterp)

    def test_expected_matrix_is_self_consistent(self):
        self.assertEqual(set(verify.SCENARIOS), set(verify.EXPECTED))
        self.assertEqual(set(verify.MUTANTS), set(verify.MUTANT_TARGETS))
        for targets in verify.MUTANT_TARGETS.values():
            self.assertLessEqual(set(targets), set(verify.SCENARIOS))
        self.assertEqual({'hit_then_load', 'hit_preloaded', 'hit_png_144', 'hit_via_run', 'hit_repeat_same_key',
                          'other_then_bluegold', 'round_trip_twice', 'two_keys_switch_before_load',
                          'two_keys_stale_arrives_first'}, set(verify.HITS))
        for name in verify.SCENARIOS:
            native = verify.native(name)
            self.assertEqual(([], [], 0), (native['lookups'], native['frame_requests'], native['frames_created']))
            self.assertNotEqual('frame', native['seen'][0])


@unittest.skipUnless(PARTY_PNG.is_file(), 'party frame PNG not built')
class PartyFrameArtTest(unittest.TestCase):
    def test_png_is_72_rgba_with_transparent_rounded_corners(self):
        from PIL import Image
        image = Image.open(PARTY_PNG)
        self.assertEqual(('RGBA', (72, 72)), (image.mode, image.size))
        alpha = [image.getpixel((x, y))[3] for x, y in ((0, 0), (71, 0), (0, 71), (71, 71))]
        self.assertEqual([0, 0, 0, 0], alpha)
        self.assertEqual(255, image.getpixel((36, 36))[3])
        # 圆角半透明像素不预乘成黑：RGB 仍是金色边框色
        r, g, b, a = image.getpixel((1, 2))
        self.assertTrue(0 < a < 255 and r > 200 and g > 150 and b < 100, (r, g, b, a))

    @unittest.skipUnless(OFFICIAL_PARTY.is_file(), 'official party texture unavailable')
    def test_alpha_is_copied_from_the_official_texture(self):
        from PIL import Image
        ours, official = Image.open(PARTY_PNG), Image.open(OFFICIAL_PARTY).convert('RGBA')
        self.assertEqual(list(official.getchannel('A').getdata()), list(ours.getchannel('A').getdata()))


@unittest.skipUnless(BASE.is_file(), 'local equipment-enhanced-look client SWF fixture unavailable')
class EquipmentEnhancedPartyFrameTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert sha(BASE.read_bytes()) == BASE_SWF_SHA
        cls.swf, cls.editor, cls.report = build()
        cls.abc = cls.swf.abc
        cls.base_abc = SwfAbc(BASE).abc
        assert sha(cls.base_abc.serialize()) == BASE_ABC_SHA
        cls.locks = json.loads((PATCH_DIR / 'baseline.json').read_text(encoding='utf8'))
        cls.results, cls.probes = verify.party_matrix(cls.abc)
        cls.native_results, cls.native_probes = verify.party_matrix(cls.base_abc)

    # ------------------------------------------------------------------ 结构与方法锁
    def test_lock_describes_the_enhanced_look_baseline(self):
        self.assertEqual({rules.LABEL: 85268}, {k: v['index'] for k, v in self.locks.items()})
        lock = self.locks[rules.LABEL]
        body = self.base_abc.bodies[bodies.resolve(self.base_abc, rules.LABEL)]
        self.assertEqual(lock['index'], bodies.resolve(self.base_abc, rules.LABEL))
        self.assertEqual(lock['sha'], sha(body[5]))
        self.assertEqual([2, 2, 1, 2], lock['header'])
        self.assertEqual(lock['header'], list(body[1:5]))
        self.assertTrue(lock['sha'].startswith('f59e0a7ff9748667'))

    def test_locked_body_is_byte_identical_in_the_older_abcs(self):
        seen = 0
        for name, path in OLDER_SWFS.items():
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
        ins[14] = asm.Instruction(0x02)    # convert_b -> nop：形状仍对，sha 不对
        body[5] = asm.encode(ins)[0]
        with self.assertRaisesRegex(asm.AsmError, 'unknown method baseline: ' + rules.LABEL):
            overlay.patch_editor(swf)

    def test_anchor_shape_change_is_refused(self):
        """锚点那条原生指令换了（哪怕方法锁被人改过）也拒绝：find_anchor 先于方法锁检查形状。"""
        swf = SwfAbc(BASE)
        body = swf.abc.bodies[bodies.resolve(swf.abc, rules.LABEL)]
        ins = asm.decode(body[5])
        ins[2] = asm.Instruction(0x5D, [ins[16].args[0]])
        body[5] = asm.encode(ins)[0]       # findproperty isEnableEnhancedEffect -> findproperty showEnhanced…
        with self.assertRaisesRegex(asm.AsmError, 'native #2 changed'):
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
        self.assertEqual([(rules.ANCHOR, rules.INSERTED_COUNT, asm.FORBID)], [tuple(x) for x in change['insertions']])
        self.assertEqual(self.locks[rules.LABEL]['sha'], sha(asm.unsplice_many(body[5], change['insertions'])))
        native = asm.decode(self.base_abc.bodies[bodies.resolve(self.base_abc, rules.LABEL)][5])
        before = asm.simulate(fix(native), body[3], self.abc.multinames)
        after = asm.simulate(fix(asm.decode(body[5])), body[3], self.abc.multinames)
        self.assertEqual(before[1], after[1])          # 作用域深度不变
        self.assertEqual(before[2], after[2])          # 死代码数不变，插入段全部可达
        self.assertEqual(4, after[0])                   # maxstack 2 -> 4（setTexture 四个实参）

    def test_patched_abc_is_the_locked_target_and_reproducible(self):
        self.assertEqual(TARGET_ABC_SHA, sha(self.abc.serialize()))
        again, _, _ = build()
        self.assertEqual(self.abc.serialize(), again.abc.serialize())

    def test_constant_pool_only_appends_the_prefix(self):
        pool = self.report['pool']
        self.assertEqual(['enhanced_party_frame_override_'], pool['added_strings'])
        self.assertEqual([], pool['added_multinames'])
        self.assertEqual([], pool['added_ints'])

    def test_stacked_patch_bodies_and_tables_preserved(self):
        result = verify.preservation(SwfAbc(BASE), self.swf)
        self.assertTrue(result['ok'], {k: v for k, v in result.items() if k != 'pools'})
        self.assertEqual([85268], result['changed_bodies'])
        self.assertEqual(0, result['added_bodies'])
        labels = result['stacked_patch_bodies']
        for label in ('EquipmentEnhancementLogic/getPixelart', 'ItemThumbnailView/setRarity',
                      'AbilitySoulAbilityLogic/getDescriptionsWithoutAdditional',
                      'BattleCharacterLogic/getAvailableAbilities'):
            self.assertEqual('identical', labels[label], label)
        self.assertEqual({'identical'}, set(labels.values()))

    def test_static_proof_block_is_isolated_from_the_native_body(self):
        proof = verify.static_proof(self.base_abc, self.abc)
        self.assertTrue(proof['ok'], proof)
        item = proof[rules.LABEL]
        self.assertNotIn(rules.GET_MASTER, item['calls'])
        self.assertNotIn('getTexture', item['calls'])
        self.assertIn(rules.MAYBE, item['calls'])
        self.assertEqual(sorted(map(list, verify.EXPECTED_WRITES)), [list(x) for x in item['property_writes']])
        self.assertEqual(0, item['returns_in_block'])

    def test_receiver_analysis_detects_a_foreign_write(self):
        """静态证明里的「属性写只落在自建图与 rarity」本身要能变红：把一处写改到 this 上必须被认出。"""
        swf, _, _ = build(mutate=verify._replace(
            lambda e: [('getlocal', rules.LOCALS['rarity']), ('pushfalse',), ('setproperty', e.q('visible'))],
            lambda e: [('getlocal_0',), ('pushfalse',), ('setproperty', e.q('visible'))]))
        proof = verify.static_proof(self.base_abc, swf.abc)
        self.assertFalse(proof[rules.LABEL]['property_writes_only_own_image_and_rarity'])
        self.assertIn(['visible', 'this'], [list(x) for x in proof[rules.LABEL]['property_writes']])
        self.assertFalse(proof['ok'])

    def test_stack_probe_detects_a_non_empty_stack(self):
        after = self.abc.bodies[bodies.resolve(self.abc, rules.LABEL)]
        entry = rules.ANCHOR + rules.INSERTED_COUNT
        self.assertTrue(verify._stack_empty_at(after, entry, self.abc.multinames))
        self.assertFalse(verify._stack_empty_at(after, entry + 1, self.abc.multinames))   # findproperty 之后

    def test_patching_twice_is_refused(self):
        with self.assertRaises(asm.AsmError):
            overlay.patch_editor(self.swf)

    # ------------------------------------------------------------------ 行为矩阵
    def test_party_matrix_on_patched_build(self):
        mismatches = {k: [self.results[k], verify.expected(k)] for k in verify.SCENARIOS
                      if self.results[k] != verify.expected(k)}
        self.assertEqual({}, mismatches)
        self.assertEqual(30, len(self.results))
        self.assertEqual(9, len(verify.HITS))
        self.assertEqual({}, {k: v['seen'] for k, v in self.results.items() if v['seen'][0] in ('error', 'throw')})

    def test_hit_shows_the_bluegold_frame_where_the_pink_one_was(self):
        for name in ('hit_then_load', 'hit_preloaded', 'hit_png_144', 'hit_via_run'):
            self.assertEqual((('frame', FRAME), True), (self.results[name]['seen'], self.results[name]['sweep']), name)
            self.assertEqual(1, self.results[name]['frames_created'], name)
        world = verify.PartyWorld(self.abc, verify.ROWS, preloaded=((FRAME, (144, 144)),))
        world.equip(LV200)
        holder = world.layout.containers['image']
        rarity = world.layout.containers['rarity']
        frame = holder.children[0]
        self.assertEqual(rules.PREFIX, frame.name)
        self.assertIs(world.cell['itemImage'], holder.children[1])         # 图标在框上面
        self.assertEqual((72, 72), frame.size)                              # 144 的图也归一到 72
        self.assertEqual(verify.RARITY_MATRIX, frame.transformationMatrix)  # 146×146，左上角 (-73,-73)
        self.assertIsNot(rarity.transformationMatrix, frame.transformationMatrix)   # setter 复制，不共用对象
        self.assertFalse(rarity.visible)
        self.assertEqual(PINK, rarity.frame)                                # 粉框帧照旧，只是整个容器藏起来
        self.assertEqual([], [p for p in world.requests if p == FRAME])      # 已就绪：不请求

    def test_texture_pending_keeps_pink_and_requests_once(self):
        self.assertEqual((('rarity', PINK), True), (self.results['hit_texture_pending']['seen'],
                                                    self.results['hit_texture_pending']['sweep']))
        self.assertEqual([FRAME], self.results['hit_texture_pending']['frame_requests'])
        self.assertEqual(0, self.results['hit_texture_pending']['frames_created'])

    def test_misses_keep_the_pink_frame_and_never_load(self):
        for name in ('missing_key', 'empty_value', 'null_value', 'table_not_loaded', 'v1_key_only',
                     'lv120_icon_keeps_pink', 'no_image_path'):
            result = self.results[name]
            self.assertEqual((('rarity', PINK), True), (result['seen'], result['sweep']), name)
            self.assertEqual(([], 0), (result['frame_requests'], result['frames_created']), name)
        self.assertEqual([], self.results['no_image_path']['lookups'])
        self.assertEqual([], self.results['table_not_loaded']['lookups'])
        self.assertEqual(1, self.probes['table_not_loaded']['maybe_tables'])

    def test_non_enhanced_empty_and_soul_never_read_the_table(self):
        for name, frame in (('not_enhanced', verify.RAINBOW), ('empty_slot', verify.EMPTY),
                            ('ability_soul', verify.RAINBOW)):
            result = self.results[name]
            self.assertEqual((('rarity', frame), False), (result['seen'], result['sweep']), name)
            self.assertEqual({'lookups': [], 'maybe_tables': 0, 'frame_requests': [], 'frames_created': 0},
                             self.probes[name], name)

    def test_cell_reuse_restores_the_original_frame(self):
        for name, seen in (('reuse_to_other_enhanced', ('rarity', PINK)), ('reuse_to_lv120', ('rarity', PINK)),
                           ('reuse_to_empty', ('rarity', verify.EMPTY)), ('reuse_to_soul', ('rarity', verify.RAINBOW)),
                           ('reuse_to_not_enhanced_same_icon', ('rarity', verify.RAINBOW)),
                           ('switch_back_and_forth_after_load', ('rarity', PINK))):
            self.assertEqual(seen, self.results[name]['seen'], name)
            self.assertEqual(1, self.results[name]['frames_created'], name)     # 图留在格子里、藏起来，只建一次
        for name in ('other_then_bluegold', 'round_trip_twice', 'hit_repeat_same_key'):
            self.assertEqual(('frame', FRAME), self.results[name]['seen'], name)
            self.assertEqual(1, self.results[name]['frames_created'], name)

    def test_late_async_load_after_reuse_keeps_the_pink_frame(self):
        """先显示别的键的框 → 换成 PARADOX（框图在载）→ 再换成别的强化装备 → 框图这时才到：按当时的字段重算，保持粉框。"""
        world = verify.PartyWorld(self.abc, verify.ROWS_TWO)
        world.equip(verify.OTHER2)
        world.flush()
        self.assertEqual((('frame', verify.FRAME2), True), world.state())
        world.equip(LV200)
        self.assertEqual((('rarity', PINK), True), world.state())           # 载图期间先显示粉框
        self.assertEqual([FRAME], [path for path, _ in world.pending if path == FRAME])
        world.equip(OTHER)
        world.flush()                                                        # 旧请求的回调到达
        self.assertEqual((('rarity', PINK), True), world.state())
        image = world.own_images()[0]
        self.assertFalse(image.visible)
        self.assertEqual(verify.FRAME2, image.texture['path'])              # 自建图没被换成过期的框图
        self.assertTrue(world.layout.containers['rarity'].visible)
        for name in ('late_load_after_reuse', 'late_load_after_reuse_to_empty', 'late_load_after_reuse_with_image'):
            self.assertNotEqual('frame', self.results[name]['seen'][0], name)

    def test_stale_key_texture_arriving_first_does_not_show(self):
        result = self.results['two_keys_stale_arrives_first']
        self.assertEqual([(('rarity', PINK), True)], result['marks'])
        self.assertEqual(('frame', verify.FRAME2), result['seen'])
        self.assertEqual(('frame', verify.FRAME2), self.results['two_keys_switch_before_load']['seen'])

    def test_callback_after_dispose_is_ignored(self):
        result = self.results['callback_after_dispose']
        self.assertEqual((('rarity', PINK), False), (result['seen'], result['sweep']))
        self.assertEqual(0, result['frames_created'])

    def test_fallthrough_reaches_native_entry_and_is_idempotent(self):
        fall = verify.fallthrough(self.abc)
        self.assertEqual(len(verify.SCENARIOS), len(fall))
        for key, value in fall.items():
            self.assertEqual(verify.fallthrough_expected(key), value, key)

    # ------------------------------------------------------------------ 负对照
    def test_negative_control_unpatched_baseline_is_native_everywhere(self):
        for name in verify.SCENARIOS:
            self.assertEqual(verify.native(name), self.native_results[name], name)
        self.assertEqual(set(verify.DIFFERS_FROM_NATIVE),
                         {k for k in verify.DIFFERS_FROM_NATIVE if self.native_results[k] != verify.expected(k)})
        touched = [k for k, v in self.native_probes.items()
                   if v['maybe_tables'] or v['lookups'] or v['frame_requests'] or v['frames_created']]
        self.assertEqual([], touched)
        # 原生下 Lv200 的 PARADOX 在编成槽就是粉框：这正是作者真机看到、补丁要改的那一格
        self.assertEqual(('rarity', PINK), self.native_results['hit_then_load']['seen'])
        self.assertEqual(('rarity', PINK), self.native_results['hit_preloaded']['seen'])

    def test_negative_control_mutants_turn_assertions_red(self):
        for name, mutate in verify.MUTANTS.items():
            with self.subTest(mutant=name):
                swf, _, _ = build(mutate=mutate)
                red = verify.red_assertions(swf.abc)
                self.assertTrue(red, name)
                for target in verify.MUTANT_TARGETS[name]:
                    self.assertIn(target, red, name)

    def test_deleting_the_probe_would_overflow_the_stack_on_device(self):
        swf, _, _ = build(mutate=verify.MUTANTS['no_probe'])
        result, _ = verify.run_scenario(swf.abc, 'hit_preloaded')
        self.assertEqual('error', result['seen'][0])
        self.assertIn('re-entered synchronously', result['seen'][2])

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
            self.assertTrue(checked['swf_container_matches_enhanced_look'])
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
            self.assertEqual(('ready', False), (state['status'], state['swf_container_matches_enhanced_look']))
            foreign = root / 'foreign.swf'
            foreign.write_bytes(b'not the enhanced-look client')
            with self.assertRaisesRegex(ValueError, 'Unknown SWF baseline'):
                apply_mod.prepare(foreign, root / 'foreign-out')
            self.assertFalse((root / 'foreign-out').exists())
            # 更老的客户端（说明覆盖 / equipment-rules / 1047）主 ABC 不同：拒绝，不降级
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
            for field, value, message in (('patch', 'equipment-enhanced-look', 'not an equipment-enhanced-party-frame'),
                                          ('output_abc_sha256', BASE_ABC_SHA, 'verified target ABC'),
                                          ('output_sha256', sha(b'x'), 'does not match the patch report'),
                                          ('source_sha256', BASE_SWF_SHA, 'not the SWF this patch was applied to')):
                with self.assertRaisesRegex(ValueError, message):
                    package_mod.check_inputs(args(dict(good, **{field: value})))
            with self.assertRaisesRegex(ValueError, 'not the installed equipment-enhanced-look build'):
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
            self.assertEqual(12, len(result['candidate_capabilities']))
            self.assertIn('equipment-enhanced-look-v1', result['candidate_capabilities'])
            self.assertTrue(result['equipment_enhanced_party_frame']['certificate_matches_installed'])

    @unittest.skipUnless(BASE_APK.is_file(), 'installed equipment-enhanced-look APK unavailable')
    def test_installed_apk_carries_the_baseline_swf(self):
        with zipfile.ZipFile(BASE_APK) as archive:
            self.assertEqual(BASE_SWF_SHA, sha(archive.read(apply_mod.SWF_MEMBER)))
        self.assertEqual(package_mod.INSTALLED_APK_SHA, sha(BASE_APK.read_bytes()))
        self.assertEqual('ready', apply_mod.prepare(BASE_APK, check_only=True)['status'])


if __name__ == '__main__':
    unittest.main()
