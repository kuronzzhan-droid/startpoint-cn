"""item-rarity-frame-override：结构 / 方法锁 / 多底包叠加 / 品质底色行为 / 格子复用 / v1 回归 / 负对照 / 变异体 / 交付入口。

行为测试执行 SWF 里的真实字节码（v1 的 look_interp，同一模块对象）：一格 ItemThumbnailView 按步骤复用
（showItem / showAnyThumbnail Custom / replace / showEquipment / showEmpty / 称号 case 11），贴图回调由测试决定何时到达。
负对照：同一矩阵在底包（编成槽框 a 版 016cd927，本机已装 APK 14396ce0 的主 SWF）上必须全部是原生结果、从不查
本补丁的前缀；v1 自己的强化框矩阵在产物上逐项不变；8 个变异体必须让断言变红。
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

PATCH_DIR = Path(__file__).resolve().parents[1] / 'item-rarity-frame-override'
PATCH_ROOT = PATCH_DIR.parent
REPO = PATCH_ROOT.parent
MOD_TOOLS = REPO / 'mod-tools'
PARADOX_APK = Path('D:/WF/out/PARADOX-20260928/apk')
BASE = PARADOX_APK / 'enhanced-look-party-20260928/swf/equipment-enhanced-party-frame.swf'
BASE_APK = PARADOX_APK / 'enhanced-look-party-20260928/WorldFlipper-equipment-enhanced-party-frame.apk'
STACK = Path('D:/WF/out/weapon-client-patches-20260928b')
#: 登记的 4 个底包（主 ABC 前 8 位 → 本机夹具）。
BASE_SWFS = {
    '016cd927': BASE,
    '2a9583cd': PARADOX_APK / 'enhanced-look-party-20260928b/swf/equipment-enhanced-party-frame.swf',
    '22292c21': STACK / 'swf/awakening-material/equipment-awakening-material.swf',
    'c39746e0': STACK / 'swf/sort-pin/equipment-sort-pin.swf',
}
#: v1 之前的客户端：setRarity 还是原生体，方法锁必须拒绝。
PRE_V1_SWFS = {
    'equipment-description-override 4994e23d':
        PARADOX_APK / 'desc-override-20260928/swf/equipment-description-override.swf',
    'equipment-rules d99246d9': PARADOX_APK / 'equipment-rules-20260928/swf/equipment-rules.swf',
}
V1_SWF = PARADOX_APK / 'enhanced-look-20260928/swf/equipment-enhanced-look.swf'
BASE_SWF_SHA = '9986dea39831608e44a405619cf234c8cccdcdbc476939bb9b5c53d689d67177'
BASE_ABC_SHA = '016cd9270a5b9c0d2d7ae6e701f5d2bcbe6ac10c59a72d1f003ccd04234169dd'
TARGET_ABC_SHA = 'c74ef64fdd46fd8e12d330471c85a7bbffe363b85112f557cc8f05bd9ea10e40'


def _load(name, file):
    """按路径以唯一模块名加载，避免与其他补丁目录的 rules.py / verify.py / overlay.py 互相遮蔽。"""
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATCH_DIR / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


overlay = _load('item_rarity_frame_override_overlay', 'overlay.py')
rules = overlay.rules
asm, bodies, SwfAbc = overlay.asm, overlay.bodies, overlay.SwfAbc
verify = _load('item_rarity_frame_override_verify', 'verify.py')
apply_mod = _load('item_rarity_frame_override_apply', 'apply_item_rarity_frame_override.py')
package_mod = _load('item_rarity_frame_override_package', 'package_apk.py')
STEEL, BLUEGOLD, STONE = verify.STEEL, verify.BLUEGOLD, verify.STONE


def _patch_module(directory, name):
    path = PATCH_ROOT / directory / 'rules.py'
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def build(mutate=None, path=BASE):
    swf = SwfAbc(path)
    editor, report = overlay.patch_editor(swf, mutate=mutate)
    return swf, editor, report


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class DesignConstantsTest(unittest.TestCase):
    """不需要夹具：键形、能力、登记底包与其他补丁的声明一致。"""

    def test_key_shape_and_design_constants(self):
        self.assertEqual('rarity_frame_override_', rules.PREFIX)
        self.assertEqual('rarity_frame_override_item/materials/mod/cursed/forbidden_star_steel', verify.RK)
        self.assertEqual('item-rarity-frame-override-v1', rules.CAPABILITY)
        self.assertEqual((rules.PREFIX,), rules.ADDED_STRINGS)
        self.assertEqual({rules.FRAME: 66, rules.REPLACE: 6}, rules.INSERTED_COUNTS)
        # 与 v1 / 编成槽框的前缀互不为前缀：一个键至多归一个补丁
        look = _patch_module('equipment-enhanced-look', 'equipment_enhanced_look_rules')
        party = _patch_module('equipment-enhanced-party-frame', 'equipment_enhanced_party_frame_rules')
        prefixes = [rules.PREFIX, look.TIER2_PREFIX, look.FRAME_PREFIX, party.PREFIX]
        for a in prefixes:
            for b in prefixes:
                self.assertTrue(a == b or not a.startswith(b), (a, b))
        self.assertEqual(look.FRAME_PREFIX, rules.V1_FRAME_PREFIX)
        # 锁的是 v1 打过补丁的 setRarity：v1 段 66 条 + 原生 30 条
        self.assertEqual(rules.FRAME_LENGTH, 30 + look.INSERTED_COUNTS[look.FRAME])
        self.assertEqual(look.ANCHORS[look.FRAME], rules.ANCHORS[rules.FRAME])

    def test_listed_bases_declare_the_same_capabilities_as_their_patches(self):
        party = _patch_module('equipment-enhanced-party-frame', 'equipment_enhanced_party_frame_rules')
        party_caps = sorted(set(party.INHERITED_CAPABILITIES) | {party.CAPABILITY})
        self.assertEqual(party_caps, sorted(rules.PARTY_FRAME_12))
        expected = {'016cd927': party_caps, '2a9583cd': party_caps}
        for directory, name, prefix in (('equipment-awakening-material', 'equipment_awakening_material_rules',
                                         '22292c21'),
                                        ('equipment-sort-pin', 'equipment_sort_pin_rules', 'c39746e0')):
            if (PATCH_ROOT / directory / 'rules.py').is_file():
                module = _patch_module(directory, name)
                expected[prefix] = sorted(set(module.INHERITED_CAPABILITIES) | {module.CAPABILITY})
        for base, entry in rules.KNOWN_BASES.items():
            self.assertNotIn(rules.CAPABILITY, entry['capabilities'])
            if base[:8] in expected:
                self.assertEqual(expected[base[:8]], sorted(entry['capabilities']), base[:8])
        self.assertEqual({12, 13, 14}, {len(e['capabilities']) for e in rules.KNOWN_BASES.values()})
        self.assertEqual(4, len({e['target_abc_sha256'] for e in rules.KNOWN_BASES.values()}))

    def test_capability_and_key_shape_agree_with_data_side_gate(self):
        sys.path.insert(0, str(MOD_TOOLS))
        try:
            import wf_client_legality as legality
            import wfx_registry
        finally:
            sys.path.remove(str(MOD_TOOLS))
        self.assertEqual(rules.CAPABILITY, legality.ITEM_RARITY_FRAME_OVERRIDE)
        self.assertEqual(rules.PREFIX, legality.ITEM_RARITY_FRAME_OVERRIDE_KEY_PREFIX)
        self.assertEqual(rules.CAPABILITY, legality.enhanced_look_capability(verify.RK))
        self.assertEqual([], legality.enhanced_look_problems(verify.RK, BLUEGOLD))
        catalog = wfx_registry.capabilities()
        self.assertEqual(('cosmetic', 'shipped'), (catalog[rules.CAPABILITY]['level'],
                                                   catalog[rules.CAPABILITY]['status']))
        rule = wfx_registry.load()['string_keys'][rules.PREFIX]
        self.assertEqual((rules.CAPABILITY, 'cosmetic'), (rule['capability'], rule['level']))

    def test_interpreter_and_world_are_the_shared_v1_modules(self):
        self.assertIs(sys.modules['equipment_enhanced_look_verify'], verify.look_verify)
        self.assertIs(sys.modules['equipment_enhanced_look_interp'], verify.look_interp)
        self.assertTrue(issubclass(verify.RarityWorld, verify.look_verify.FrameWorld))

    def test_option_none_has_null_params_like_the_real_client(self):
        """haxe.ds.Option.None = new Option("None",1,null)：本补丁的世界用 params=null，v1 模块的对象不动。"""
        official = REPO / '弹国服/scripts/haxe/ds/Option.as'
        if official.is_file():
            self.assertIn('new Option("None",1,null)', official.read_text(encoding='utf8'))
        self.assertEqual({'index': 1, 'params': None, '_type': 'Option'}, verify.NONE_OPTION)
        self.assertIsNot(verify.look_verify.NONE_OPTION, verify.NONE_OPTION)
        self.assertEqual([], verify.look_verify.NONE_OPTION['params'])
        self.assertIs(verify.NONE_OPTION, verify._opt(None))
        self.assertEqual(['item_image_none', 'empty_cell', 'reuse_hit_then_empty'],
                         [name for _kind, name in verify.MUTANT_TARGETS['some_check_deleted']])

    def test_expected_matrix_is_self_consistent(self):
        self.assertEqual(34, len(verify.SCENARIOS))
        self.assertEqual(15, len(verify.HITS))
        for name in verify.HITS:
            self.assertEqual('background', verify.EXPECTED[name][0], name)
            self.assertEqual('rarity', verify.NATIVE[name][0], name)
        # 强化态与未命中场景：期望等于原生
        for name in ('enhanced_ignores_rarity_key', 'enhanced_v1_key_still_v1', 'missing_key', 'empty_value',
                     'reuse_hit_then_plain_item', 'reuse_hit_then_empty', 'replace_reuse_hit_then_plain'):
            self.assertEqual(verify.EXPECTED[name], verify.NATIVE[name], name)
        self.assertEqual(set(verify.MUTANTS), set(verify.MUTANT_TARGETS))


@unittest.skipUnless(BASE.is_file(), 'local equipment-enhanced-party-frame a client SWF fixture unavailable')
class ItemRarityFrameOverrideTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = SwfAbc(BASE)
        cls.swf, cls.editor, cls.report = build()
        cls.results, cls.probes = verify.matrix(cls.swf.abc)
        cls.native, cls.native_probes = verify.matrix(cls.base.abc)
        cls.locks = json.loads((PATCH_DIR / 'baseline.json').read_text(encoding='utf8'))

    # ------------------------------------------------------------------ 方法锁与底包
    def test_lock_describes_the_installed_baseline(self):
        self.assertEqual(BASE_ABC_SHA, sha(self.base.abc.serialize()))
        self.assertEqual(BASE_SWF_SHA, sha(BASE.read_bytes()))
        for label, lock in self.locks.items():
            index = bodies.resolve(self.base.abc, label)
            body = self.base.abc.bodies[index]
            self.assertEqual((lock['index'], lock['sha'], lock['header']), (index, sha(body[5]), body[1:5]), label)

    def test_locked_bodies_are_byte_identical_in_every_listed_base(self):
        for prefix, path in BASE_SWFS.items():
            if not path.is_file():
                continue
            abc = SwfAbc(path).abc
            with self.subTest(base=prefix):
                self.assertTrue(sha(abc.serialize()).startswith(prefix))
                for label, lock in self.locks.items():
                    index = bodies.resolve(abc, label)
                    self.assertEqual((lock['index'], lock['sha'], lock['header']),
                                     (index, sha(abc.bodies[index][5]), abc.bodies[index][1:5]), label)
        if V1_SWF.is_file():      # v1 本身也同体（但不登记：它没有编成槽框，能力声明会失真）
            abc = SwfAbc(V1_SWF).abc
            for label, lock in self.locks.items():
                self.assertEqual(lock['sha'], sha(abc.bodies[bodies.resolve(abc, label)][5]), label)

    def test_every_listed_base_patches_to_its_pinned_target(self):
        for prefix, path in BASE_SWFS.items():
            if not path.is_file():
                continue
            with self.subTest(base=prefix):
                swf, _, report = build(path=path)
                base_abc = sha(SwfAbc(path).abc.serialize())
                self.assertEqual(rules.KNOWN_BASES[base_abc]['target_abc_sha256'], sha(swf.abc.serialize()))
                self.assertEqual({rules.FRAME: [3, 22, 1, 2], rules.REPLACE: [3, 3, 1, 2]}, report['headers'])

    def test_pre_v1_clients_are_refused_by_the_method_lock(self):
        for name, path in PRE_V1_SWFS.items():
            if not path.is_file():
                continue
            with self.subTest(client=name), self.assertRaisesRegex(asm.AsmError, 'expected 96|unknown method'):
                build(path=path)

    def test_a_foreign_method_body_is_refused_without_fallback(self):
        swf = SwfAbc(BASE)
        body = swf.abc.bodies[bodies.resolve(swf.abc, rules.REPLACE)]
        body[1] = body[1] + 1                       # header 不符
        with self.assertRaisesRegex(asm.AsmError, 'unknown method baseline'):
            overlay.patch_editor(swf)

    def test_anchor_shape_change_is_refused(self):
        swf = SwfAbc(BASE)
        body = swf.abc.bodies[bodies.resolve(swf.abc, rules.FRAME)]
        ins = asm.decode(body[5])
        ins[29] = asm.Instruction(asm.OPCODES['getlocal_1'] if hasattr(asm, 'OPCODES') else 0xD1)
        body[5] = asm.encode(ins)[0]
        with self.assertRaisesRegex(asm.AsmError, 'native #29 changed'):
            overlay.patch_editor(swf)

    # ------------------------------------------------------------------ 结构
    def test_only_the_locked_bodies_change_and_the_insertions_are_reversible(self):
        self.assertEqual(set(rules.TARGETS), set(self.report['methods']))
        self.assertEqual(rules.INSERTED_COUNTS, self.report['inserted_counts'])
        self.assertEqual(rules.ANCHORS, self.report['anchors'])
        for label in rules.TARGETS:
            after = self.swf.abc.bodies[bodies.resolve(self.swf.abc, label)]
            restored = asm.unsplice(after[5], rules.ANCHORS[label], rules.INSERTED_COUNTS[label])
            self.assertEqual(self.locks[label]['sha'], sha(restored), label)
        self.assertEqual(92566, self.report['unchanged_method_bodies'])

    def test_patched_abc_is_the_pinned_target_and_reproducible(self):
        self.assertEqual(TARGET_ABC_SHA, sha(self.swf.abc.serialize()))
        again, _, _ = build()
        self.assertEqual(self.swf.abc.serialize(), again.abc.serialize())

    def test_constant_pool_only_appends_the_prefix(self):
        pool = self.report['pool']
        self.assertEqual([rules.PREFIX], pool['added_strings'])
        self.assertFalse(pool['added_multinames'] or pool['added_ints'])

    def test_preservation_stacked_bodies_and_tables(self):
        report = verify.preservation(self.base, self.swf)
        self.assertTrue(report['ok'], report)
        self.assertEqual(sorted(v['index'] for v in self.locks.values()), report['changed_bodies'])
        self.assertEqual({'identical'}, set(report['stacked_patch_bodies'].values()))
        # v1 第二图标档、编成槽框两体、觉醒专属素材、置顶两体都在叠加链清单里
        for label in ('EquipmentEnhancementLogic/getPixelart', 'PartyItemThumbnailView/updateEnhancedEffectAnimation',
                      'PartyItemThumbnailView/setItemImage'):
            self.assertIn(label, report['stacked_patch_bodies'])

    def test_static_proof(self):
        proof = verify.static_proof(self.base.abc, self.swf.abc)
        self.assertTrue(proof['ok'], proof)
        self.assertTrue(proof[rules.REPLACE]['byte_identical_to_replaceItemImage_2_7'])
        self.assertEqual(['itemImagePath'], proof[rules.REPLACE]['property_writes'])
        self.assertEqual([], proof[rules.FRAME]['property_writes'])
        self.assertTrue(proof[rules.FRAME]['v1_block_follows_intact'])
        self.assertEqual([rules.PREFIX], proof[rules.FRAME]['strings'])

    def test_patching_twice_is_refused(self):
        with self.assertRaisesRegex(asm.AsmError, 'unknown method baseline|already probes|expected'):
            overlay.patch_editor(self.swf)

    # ------------------------------------------------------------------ 行为
    def test_matrix_on_patched_build(self):
        mismatches = {k: (self.results[k], verify.expected_result(k)) for k in verify.SCENARIOS
                      if self.results[k] != verify.expected_result(k)}
        self.assertEqual({}, mismatches)
        lookups = {k: (verify.own_lookups(self.probes[k]), verify.expected_own_lookups(k)) for k in verify.SCENARIOS
                   if verify.own_lookups(self.probes[k]) != verify.expected_own_lookups(k)}
        self.assertEqual({}, lookups)

    def test_forbidden_star_steel_gets_the_bluegold_plate_on_every_entry(self):
        for name in ('item_hit', 'custom_hit_product_list', 'replace_hit_fresh_cell', 'custom_fx_not_enhanced_hit',
                     'reuse_plain_then_hit', 'replace_reuse_plain_then_hit', 'reuse_title_then_hit'):
            self.assertEqual((('background', BLUEGOLD), STEEL), self.results[name], name)

    def test_cell_reuse_restores_the_native_plate(self):
        self.assertEqual((('rarity', 3), STONE), self.results['reuse_hit_then_plain_item'])
        self.assertEqual((('rarity', 3), STONE), self.results['reuse_texture_arrives_after_reuse'])
        self.assertEqual((('rarity', 3), STONE), self.results['replace_reuse_hit_then_plain'])
        self.assertEqual(('rarity', verify.PINK), self.results['reuse_hit_then_enhanced_equipment'][0])
        self.assertEqual(('rarity', verify.EMPTY_FRAME), self.results['reuse_hit_then_empty'][0])

    def test_enhanced_thumbnails_stay_with_v1(self):
        self.assertEqual(('rarity', verify.PINK), self.results['enhanced_ignores_rarity_key'][0])
        self.assertEqual(('background', BLUEGOLD), self.results['enhanced_v1_key_still_v1'][0])
        for name in ('enhanced_ignores_rarity_key', 'enhanced_v1_key_still_v1',
                     'custom_fx_enhanced_ignores_rarity_key'):
            self.assertEqual([], verify.own_lookups(self.probes[name]), name)

    def test_misses_are_native(self):
        for name in ('missing_key', 'empty_value', 'null_value', 'table_not_loaded', 'other_icon_key_only',
                     'v1_key_not_read_when_not_enhanced', 'item_image_none', 'empty_cell', 'view_null_guard'):
            self.assertEqual(verify.native_result(name), self.results[name], name)

    def test_world_uses_the_null_params_none_everywhere(self):
        world = verify.RarityWorld(self.swf.abc, {})
        for holder in (world.cell, world.frame_view):
            for name, value in holder.items():
                self.assertIsNot(verify.look_verify.NONE_OPTION, value, name)
        self.assertIs(verify.NONE_OPTION, world.cell['itemImagePath'])
        self.assertIs(verify.NONE_OPTION, world.lex[verify.rules.OPTION].statics['None'])

    def test_v1_enhanced_frame_matrix_is_unchanged(self):
        regression = verify.v1_regression(self.swf.abc)
        self.assertTrue(regression['ok'], regression)
        self.assertEqual(17, regression['size'])

    def test_fallthrough_reaches_the_v1_block_and_replace_sets_the_path(self):
        fall = verify.fallthrough(self.swf.abc)
        self.assertEqual(13, len(fall))
        for key, value in fall.items():
            self.assertEqual(verify.fallthrough_expected(key), value, key)

    # ------------------------------------------------------------------ 负对照
    def test_negative_control_unpatched_baseline_is_native_everywhere(self):
        for name in verify.SCENARIOS:
            self.assertEqual(verify.native_result(name), self.native[name], name)
            self.assertEqual([], verify.own_lookups(self.native_probes[name]), name)
        for name in verify.HITS:
            self.assertNotEqual(verify.expected_result(name), self.native[name], name)
        self.assertTrue(verify.v1_regression(self.base.abc)['ok'])
        fall = verify.fallthrough(self.base.abc)
        for key, value in fall.items():
            self.assertEqual(verify.fallthrough_expected(key, patched=False), value, key)

    def test_negative_control_mutants_turn_assertions_red(self):
        for name, mutate in verify.MUTANTS.items():
            with self.subTest(mutant=name):
                swf, _, _ = build(mutate=mutate)
                red = verify.red_assertions(swf.abc)
                self.assertTrue(red, name)
                for target in verify.MUTANT_TARGETS[name]:
                    self.assertIn(target, red, name)

    def test_red_assertions_is_green_on_the_real_build(self):
        self.assertEqual([], verify.red_assertions(self.swf.abc))

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
            self.assertTrue(checked['base']['listed'])
            self.assertEqual(TARGET_ABC_SHA, checked['target_abc_sha256'])
            result = apply_mod.prepare(apk, root / 'out', mutants=False)
            self.assertEqual('prepared', result['status'])
            self.assertEqual(before, apk.read_bytes())
            self.assertEqual(TARGET_ABC_SHA, result['output_abc_sha256'])
            self.assertEqual(sorted(self.locks), result['changed_methods'])
            self.assertEqual(13, len(result['candidate_capabilities']))
            report = json.loads((root / 'out/patch-report.json').read_text(encoding='utf8'))
            self.assertEqual(BASE_SWF_SHA, report['source_sha256'])
            self.assertEqual([rules.CAPABILITY], report['capabilities_added'])
            self.assertTrue(json.loads((root / 'out/verify-report.json').read_text(encoding='utf8'))['ok'])
            with self.assertRaises(FileExistsError):
                apply_mod.prepare(apk, root / 'out')
            self.assertEqual('already_patched', apply_mod.prepare(result['output_swf'], root / 'unused')['status'])
            self.assertFalse((root / 'unused').exists())
            # 同一主 ABC、不同容器（重新压成 CWS）：按 ABC 认底包
            raw = SwfAbc(BASE)
            cws = root / 'recompressed.swf'
            cws.write_bytes(b'CWS' + bytes([raw.version]) + struct.pack('<I', len(raw.body) + 8)
                            + zlib.compress(raw.body))
            state = apply_mod.prepare(cws, check_only=True)
            self.assertEqual('ready', state['status'])
            foreign = root / 'foreign.swf'
            foreign.write_bytes(b'not a client')
            with self.assertRaisesRegex(ValueError, 'not parseable'):
                apply_mod.prepare(foreign, root / 'foreign-out')
            self.assertFalse((root / 'foreign-out').exists())
            # v1 之前的客户端：方法锁不符，拒绝，不降级
            for path in PRE_V1_SWFS.values():
                if path.is_file():
                    with self.assertRaisesRegex(ValueError, 'Method locks do not match'):
                        apply_mod.prepare(path, check_only=True)

    @unittest.skipUnless(V1_SWF.is_file(), 'v1 SWF fixture unavailable')
    def test_unlisted_base_needs_a_matching_build_report(self):
        """v1（e87371b7）两把锁都相符但不在登记表里：没有底包构建报告就拒绝；报告的 SWF 哈希不符也拒绝；
        报告相符时按报告声明能力。"""
        v1_sha = sha(V1_SWF.read_bytes())
        with self.assertRaisesRegex(ValueError, 'Unknown SWF baseline'):
            apply_mod.prepare(V1_SWF, check_only=True)
        good = {'swf_sha256': v1_sha, 'apk_sha256': '7056f7dc' + '0' * 56,
                'candidate_capabilities': ['equipment-enhanced-look-v1', 'gauge-gain-rules-v1']}
        with self.assertRaisesRegex(ValueError, 'does not describe this SWF'):
            apply_mod.prepare(V1_SWF, check_only=True, base_report=dict(good, swf_sha256='0' * 64))
        for bad in ([], ['Bad Name'], ['a', 'a'], [rules.CAPABILITY]):
            with self.assertRaises(ValueError):
                apply_mod.prepare(V1_SWF, check_only=True, base_report=dict(good, candidate_capabilities=bad))
        state = apply_mod.prepare(V1_SWF, check_only=True, base_report=good)
        self.assertEqual(('ready', False), (state['status'], state['base']['listed']))
        self.assertIsNone(state['target_abc_sha256'])
        self.assertEqual(sorted(good['candidate_capabilities']), state['base']['capabilities'])

    def _report(self, root, **overrides):
        base = dict(rules.KNOWN_BASES[BASE_ABC_SHA], listed=True)
        report = {'patch': overlay.PATCH_NAME, 'status': overlay.STATUS, 'source_abc_sha256': BASE_ABC_SHA,
                  'output_abc_sha256': TARGET_ABC_SHA, 'output_sha256': sha(b'candidate'),
                  'source_sha256': sha(b'some other swf'), 'methods': {},
                  'base': {'listed': True, 'apk_sha256': base['apk_sha256'],
                           'capabilities': sorted(base['capabilities'])},
                  'candidate_capabilities': sorted(set(base['capabilities']) | {rules.CAPABILITY})}
        report.update(overrides)
        path = root / 'report.json'
        path.write_text(json.dumps(report), encoding='utf8')
        return path

    def test_package_refuses_mismatched_inputs_before_signing(self):
        from unittest import mock
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            swf = root / 'candidate.swf'
            swf.write_bytes(b'candidate')
            apk = root / 'base.apk'
            with zipfile.ZipFile(apk, 'w') as archive:
                archive.writestr(package_mod.SWF_MEMBER, b'some other swf')

            def check(**overrides):
                a = argparse.Namespace(base=apk, swf=swf, patch_report=self._report(root, **overrides))
                with mock.patch.object(package_mod, 'main_abc_sha', return_value=TARGET_ABC_SHA):
                    return package_mod.check_inputs(a)

            # 底包 APK 不是登记的 14396ce0（这里是临时假 APK）：拒绝
            with self.assertRaisesRegex(ValueError, 'not the APK recorded'):
                check()
            for field, value, message in (
                    ('patch', 'equipment-enhanced-party-frame', 'not an item-rarity-frame-override'),
                    ('output_sha256', sha(b'x'), 'does not match the patch report'),
                    ('output_abc_sha256', BASE_ABC_SHA, 'main ABC does not match'),
                    ('candidate_capabilities', ['gauge-gain-rules-v1'], 'not base \\+')):
                with self.subTest(field=field), self.assertRaisesRegex(ValueError, message):
                    check(**{field: value})
            intermediate = '22292c21361fa505bccd563852810e6fb1d696ae03823f05ff694a74fbdf2ec1'
            with mock.patch.object(package_mod, 'main_abc_sha',
                                   return_value=rules.KNOWN_BASES[intermediate]['target_abc_sha256']):
                caps = sorted(rules.KNOWN_BASES[intermediate]['capabilities'])
                path = self._report(root, source_abc_sha256=intermediate,
                                    output_abc_sha256=rules.KNOWN_BASES[intermediate]['target_abc_sha256'],
                                    base={'listed': True, 'apk_sha256': None, 'capabilities': caps},
                                    candidate_capabilities=sorted(set(caps) | {rules.CAPABILITY}))
                with self.assertRaisesRegex(ValueError, 'no APK of its own'):
                    package_mod.check_inputs(argparse.Namespace(base=apk, swf=swf, patch_report=path))

    def _package_with_fake_signer(self, root, certificate):
        """用替身代替 battle-rules/build_apk.py（不签名、不碰口令），只验证 package() 自身的拒绝条件。
        底包 APK 用临时假 APK，并把补丁报告声明成「由底包构建报告声明的未登记底包」，APK 哈希取这个假 APK。"""
        from unittest import mock
        swf_bytes = b'candidate'
        swf = root / 'candidate.swf'
        swf.write_bytes(swf_bytes)
        base = root / 'base.apk'
        with zipfile.ZipFile(base, 'w') as archive:
            archive.writestr(package_mod.SWF_MEMBER, b'some other swf')
        caps = ['damage-type-rules-v1', 'gauge-gain-rules-v1']
        report = self._report(root, source_abc_sha256='ab' * 32, output_abc_sha256='cd' * 32,
                              base={'listed': False, 'apk_sha256': sha(base.read_bytes()), 'capabilities': caps},
                              candidate_capabilities=sorted(caps + [rules.CAPABILITY]))
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
                'candidate_capabilities': ['gauge-gain-rules-v1']}), encoding='utf8')
            return package_mod.subprocess.CompletedProcess(argv, 0, '', '')

        a = argparse.Namespace(base=base, swf=swf, patch_report=report, output=output, work=root / 'work',
                               zipalign=root / 'z', apksigner=root / 's', keystore=root / 'k',
                               ks_pass_env='UNUSED_TEST_ENV', key_pass_env=None)
        with mock.patch.object(package_mod.subprocess, 'run', side_effect=fake_run), \
                mock.patch.object(package_mod, 'main_abc_sha', return_value='cd' * 32):
            try:
                return package_mod.package(a), calls, output.with_suffix('.build-report.json')
            except ValueError as exc:
                return exc, calls, output.with_suffix('.build-report.json')

    def test_package_refuses_a_foreign_certificate_and_marks_the_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, calls, build_report = self._package_with_fake_signer(Path(tmp), ['00' * 32])
            self.assertIsInstance(result, ValueError)
            self.assertIn('certificate', str(result))
            self.assertEqual(1, len(calls))
            written = json.loads(build_report.read_text(encoding='utf8'))
            self.assertEqual('refused_certificate_mismatch', written['status'])
            self.assertNotIn(rules.CAPABILITY, written['candidate_capabilities'])

    def test_package_positive_control_with_the_installed_certificate(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, calls, _ = self._package_with_fake_signer(Path(tmp), [package_mod.CERTIFICATE_SHA])
            self.assertIsInstance(result, dict, result)
            self.assertEqual(1, len(calls))
            self.assertEqual(['damage-type-rules-v1', 'gauge-gain-rules-v1', rules.CAPABILITY],
                             result['candidate_capabilities'])
            self.assertTrue(result['item_rarity_frame_override']['certificate_matches_installed'])

    @unittest.skipUnless(BASE_APK.is_file(), 'installed equipment-enhanced-party-frame a APK unavailable')
    def test_installed_apk_carries_the_baseline_swf(self):
        with zipfile.ZipFile(BASE_APK) as archive:
            self.assertEqual(BASE_SWF_SHA, sha(archive.read(apply_mod.SWF_MEMBER)))
        self.assertEqual(rules.KNOWN_BASES[BASE_ABC_SHA]['apk_sha256'], sha(BASE_APK.read_bytes()))
        self.assertEqual('ready', apply_mod.prepare(BASE_APK, check_only=True)['status'])


if __name__ == '__main__':
    unittest.main()
