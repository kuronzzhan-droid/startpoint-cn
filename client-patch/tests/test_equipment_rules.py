"""equipment-rules：结构 / 行为矩阵 / 负对照 / 交付入口。

行为测试执行 SWF 里的真实字节码（equipment-rules/avm_interp.py）。负对照：同一矩阵在未打补丁的
1.4.1047 基线上必须不满足规则，删掉门控里「置失效」两条指令的变异体也必须不满足。
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

PATCH_DIR = Path(__file__).resolve().parents[1] / 'equipment-rules'
BASE = Path('D:/WF/out/月兔回槽性能与狮子PF点火-20260925/gauge-performance.swf')
BASE_SHA = '6e7b2db7923d2456ce2b6edc9a42aba51f1f87a099ecc4f606c1de7fc302c497'


def _load(name, file):
    """按路径以唯一模块名加载，避免与其他补丁目录的 verify.py 等同名模块互相遮蔽。"""
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATCH_DIR / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


overlay = _load('overlay', 'overlay.py')
rules = overlay.rules
asm, bodies, SwfAbc = overlay.asm, overlay.bodies, overlay.SwfAbc
verify = _load('equipment_rules_verify', 'verify.py')
apply_mod = _load('equipment_rules_apply', 'apply_equipment_rules.py')
interp_mod = _load('avm_interp', 'avm_interp.py')


def build(config=rules.DEFAULT, mutate=None):
    swf = SwfAbc(BASE)
    original = rules.gate_insertion
    if mutate is not None:
        rules.gate_insertion = mutate
    try:
        editor, report = overlay.patch_editor(swf, config)
    finally:
        rules.gate_insertion = original
    return swf, editor, report


@unittest.skipUnless(BASE.is_file(), 'local 1.4.1047 client SWF fixture unavailable')
class EquipmentRulesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert hashlib.sha256(BASE.read_bytes()).hexdigest() == BASE_SHA
        cls.swf, cls.editor, cls.report = build()
        cls.abc = cls.swf.abc
        cls.base_abc = SwfAbc(BASE).abc
        cls.locks = json.loads((PATCH_DIR / 'baseline.json').read_text(encoding='utf8'))

    # ------------------------------------------------------------------ 结构
    def test_only_locked_bodies_change_and_every_insertion_is_reversible(self):
        self.assertEqual(set(self.locks), set(self.report['methods']))
        self.assertEqual(len(self.base_abc.bodies) - len(self.locks), self.report['unchanged_method_bodies'])
        for label, change in self.report['methods'].items():
            body = self.abc.bodies[bodies.resolve(self.abc, label)]
            self.assertEqual(self.locks[label]['sha'], change['before'])
            self.assertEqual(self.locks[label]['sha'],
                             hashlib.sha256(asm.unsplice_many(body[5], change['insertions'])).hexdigest())
            native = asm.decode(self.base_abc.bodies[bodies.resolve(self.base_abc, label)][5])
            patched = asm.decode(body[5])
            fix = lambda ins: [asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in ins]  # noqa: E731
            before = asm.simulate(fix(native), body[3], self.abc.multinames)
            after = asm.simulate(fix(patched), body[3], self.abc.multinames)
            self.assertEqual(before[1], after[1], label)          # 作用域深度不变
            self.assertEqual(before[2], after[2], label)          # 原有死代码数不变，插入段全部可达
            self.assertLessEqual(after[0], body[1], label)        # maxstack 足够

    def test_new_methods_have_no_backward_branch_or_dead_code(self):
        names = [m['name'] for m in self.report['added_methods']]
        self.assertEqual([m[0] for m in rules.METHODS], names)
        for method in self.report['added_methods']:
            ins = asm.decode(self.abc.bodies[method['body']][5])
            self.assertFalse([i for i, x in enumerate(ins) if x.target is not None and x.target <= i], method['name'])
            self.assertEqual(0, method['metrics'][2], method['name'])

    def test_constant_pool_only_appends_method_names_and_range_ints(self):
        pool = self.report['pool']
        self.assertEqual([m[0] for m in rules.METHODS], pool['added_strings'])
        self.assertEqual([m[0] for m in rules.METHODS], pool['added_multinames'])
        self.assertEqual([5910101, 5910199, 5920001, 5920999], pool['added_ints'])

    def test_battle_rules_and_gauge_perf_bodies_preserved(self):
        base = SwfAbc(BASE)
        result = verify.preservation(base, self.swf)
        self.assertTrue(result['ok'], result)
        self.assertEqual(sorted(v['index'] for v in self.locks.values()), result['changed_bodies'])
        self.assertIn('MemberImpl/applyInstantAbility', result['battle_rules_and_gauge_perf_bodies'])
        self.assertEqual({'identical'}, set(result['battle_rules_and_gauge_perf_bodies'].values()))

    def test_patching_twice_is_refused(self):
        with self.assertRaises(asm.AsmError):
            overlay.patch_editor(self.swf)

    def test_gauge_spec_matches_battle_rules_content(self):
        spec = importlib.util.spec_from_file_location('battle_rules_content', PATCH_DIR.parent / 'battle-rules/content.py')
        content = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(content)
        self.assertEqual((rules.GAUGE_KIND, rules.GAUGE_CHARACTER_INDEX, rules.GAUGE_TAG), content.SPECS[0][:3])

    # ------------------------------------------------------------------ 行为（R1 / R2）
    def test_gate_matrix_on_patched_build(self):
        got = verify.gate_matrix(self.abc)
        self.assertEqual(verify.EXPECTED_GATE, got)

    def test_negative_control_unpatched_baseline_fails_every_rule_scenario(self):
        native = verify.gate_matrix(self.base_abc)
        failing = {k for k in verify.RULE_SCENARIOS if native[k] != verify.EXPECTED_GATE[k]}
        self.assertEqual(set(verify.RULE_SCENARIOS), failing)
        controls = {k for k in verify.EXPECTED_GATE if k not in verify.RULE_SCENARIOS}
        self.assertEqual({k: verify.EXPECTED_GATE[k] for k in controls}, {k: native[k] for k in controls})
        self.assertEqual(('keep',), native['r2_two_cursed_first'])
        self.assertEqual(('keep',), native['r1_n2'])

    def test_negative_control_mutant_without_disable_store_fails_r2(self):
        original = rules.gate_insertion

        def mutant(e):
            return [x for x in original(e) if x not in (('pushfalse',), ('setlocal', 14))]

        swf, _, _ = build(mutate=mutant)
        got = verify.gate_matrix(swf.abc)
        self.assertNotEqual(('off',), got['r2_two_cursed_first'])
        self.assertNotEqual(('off',), got['r1_n4'])
        self.assertEqual(verify.EXPECTED_GATE['r1_n2'], got['r1_n2'])

    def test_full_decay_key_variant_uses_tier_four_only_when_present(self):
        swf, _, _ = build(rules.Config(full_decay_key=True))
        tiers = verify.TIER_KEYS | {verify.PARADOX + 4000}
        with_key = verify._gate_case(swf.abc, peek_kind='weapon', sid=verify.PARADOX,
                                     weapons=(verify.PARADOX, verify.OTHER_A, verify.OTHER_B),
                                     orbs=(verify.ORB_A, verify.ORB_B, None), soul_keys=tiers, enh_keys=tiers)
        self.assertEqual(('tier', 5924001, 41, verify.LV, 5924001, 120, 120), with_key)
        self.assertEqual(('off',), verify.gate_matrix(swf.abc)['r1_n4'])

    def test_cursed_extra_list_can_include_paradox(self):
        swf, _, _ = build(rules.Config(cursed_extra=(5920001,)))
        got = verify._gate_case(swf.abc, peek_kind='weapon', sid=verify.PARADOX,
                                weapons=(verify.PARADOX, 5910101, None))
        self.assertEqual(('off',), got)
        self.assertEqual(('keep',), verify.gate_matrix(self.abc)['r2_paradox_is_not_cursed'])

    def test_config_validation(self):
        with self.assertRaises(ValueError):
            rules.validate(rules.Config(tier_stride=100, decay=((5920001, 5920999),)))
        with self.assertRaises(ValueError):
            rules.validate(rules.Config(cursed_threshold=1))
        rules.validate(rules.DEFAULT)

    # ------------------------------------------------------------------ 预载
    def test_preload_feeds_every_tier_of_weapon_and_orb_slots(self):
        world = verify.World(soul_keys=verify.TIER_KEYS | {verify.PARADOX},
                             enh_keys=verify.TIER_KEYS | {verify.PARADOX})
        weapon = world.weapon(verify.PARADOX, 88)
        orb = world.orb_soul(verify.PARADOX)
        interp = interp_mod.Interp(self.abc, world.lex)
        body = verify.added_method_bodies(self.abc)['wfPreloadEquipmentTiers']

        def run(this_fields):
            seen = []
            this = verify.character(self.abc, world, interp, **this_fields)
            interp.run(body, [this, lambda ability: seen.append(ability)])
            return seen

        fed = run({'equipment': verify.some({'getCurrentAbility': lambda: weapon}),
                   'getAbilitySoulAbility': lambda: verify.some(orb)})
        weapon_tiers = [(a['abilitySoulAbility']['id'], a['enhancementAbility']['params'][0]['id'],
                         a['enhancementAbility']['params'][0]['currentLevel']) for a in fed[:3]]
        self.assertEqual([(5921001, 5921001, 88), (5922001, 5922001, 88), (5923001, 5923001, 88)], weapon_tiers)
        self.assertEqual([(5921001, 31), (5922001, 31), (5923001, 31)], [(a['id'], a['number']) for a in fed[3:]])
        other = run({'equipment': verify.some({'getCurrentAbility': lambda: world.weapon(5910101, 120)}),
                     'getAbilitySoulAbility': lambda: verify.NONE_OPTION})
        self.assertEqual([], other)

    def test_preload_insertion_sits_on_the_equipment_merge_point(self):
        label = rules.RPC
        native = asm.decode(self.base_abc.bodies[bodies.resolve(self.base_abc, label)][5])
        patched = asm.decode(self.abc.bodies[bodies.resolve(self.abc, label)][5])
        at = self.report['anchors'][label]
        incoming = [i for i, x in enumerate(native) if x.target == at]
        self.assertEqual(2, len(incoming))
        self.assertTrue(all(patched[i].target == at for i in incoming))
        self.assertEqual('callpropvoid', patched[at + 3].name)
        self.assertEqual('wfPreloadEquipmentTiers', self.abc.mn_name(patched[at + 3].args[0]))
        calls = []
        block = asm.assemble(rules.preload_insertion(self.editor) + [('returnvoid',)])
        fn = object()
        this = {'wfPreloadEquipmentTiers': calls.append}
        interp_mod.Interp(self.abc).run(block, [this], scopes=[this, {'slot7': fn}])
        self.assertEqual([fn], calls)

    # ------------------------------------------------------------------ R3 解析器
    def test_equipment_tables_parse_gauge_rule_like_ability_table(self):
        self.assertEqual(verify.EXPECTED_PARSE, verify.parse_matrix(self.abc))

    def test_negative_control_unpatched_equipment_tables_throw_c7050(self):
        self.assertEqual(verify.UNPATCHED_PARSE, verify.parse_matrix(self.base_abc))

    def test_gauge_mask_8_blocks_ability_class_gains_only(self):
        got = verify.gauge_matrix(self.abc, 8)
        blocked = {k for k, v in got.items() if v}
        self.assertEqual({'character_ability', 'leader_ability', 'weapon_ability', 'weapon_enhancement_combo',
                          'soul_skill_triggered', 'ex_ability', 'invoke_skill_629_snapshot_weapon',
                          'invoke_skill_629_no_snapshot', 'ability_without_origin'}, blocked)
        self.assertFalse(verify.gauge_matrix(self.abc, 7944)['ability_without_origin'])

    # ------------------------------------------------------------------ 交付入口
    def test_apply_entry_check_prepare_idempotence_and_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            apk = root / 'receiver.apk'
            with zipfile.ZipFile(apk, 'w') as archive:
                archive.write(BASE, apply_mod.SWF_MEMBER)
                archive.writestr('assets/receiver.txt', b'receiver-only resource')
            before = apk.read_bytes()
            self.assertEqual('ready', apply_mod.prepare(apk, check_only=True)['status'])
            result = apply_mod.prepare(apk, root / 'out')
            self.assertEqual('prepared', result['status'])
            self.assertEqual(before, apk.read_bytes())
            self.assertEqual(sorted(self.locks), result['changed_methods'])
            self.assertTrue(json.loads((root / 'out/verify-report.json').read_text(encoding='utf8'))['ok'])
            with self.assertRaises(FileExistsError):
                apply_mod.prepare(apk, root / 'out')
            self.assertEqual('already_patched', apply_mod.prepare(result['output_swf'], root / 'unused')['status'])
            self.assertFalse((root / 'unused').exists())
            foreign = root / 'foreign.swf'
            foreign.write_bytes(b'not the 1047 client')
            with self.assertRaisesRegex(ValueError, 'Unknown SWF baseline'):
                apply_mod.prepare(foreign, root / 'foreign-out')
            self.assertFalse((root / 'foreign-out').exists())
            copy = root / 'copy.swf'
            shutil.copyfile(BASE, copy)
            self.assertEqual('ready', apply_mod.prepare(copy, check_only=True)['status'])


if __name__ == '__main__':
    unittest.main()
