"""equipment-description-override：结构 / 行为矩阵 / 消费链 / 负对照 / 变异体 / 交付入口。

行为测试执行 SWF 里的真实字节码（equipment-description-override/desc_interp.py，它以私有模块名导入并扩展
equipment-rules/avm_interp.py，不改后者）。负对照：同一矩阵在未打补丁的 equipment-rules 产物上必须全部是原生结果；
去掉 returnvalue、前缀写错的两个变异体在所有命中项上都必须变红。
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

PATCH_DIR = Path(__file__).resolve().parents[1] / 'equipment-description-override'
MOD_TOOLS = Path(__file__).resolve().parents[2] / 'mod-tools'
FIXTURE_DIR = Path('D:/WF/out/PARADOX-20260928/apk/equipment-rules-20260928')
BASE = FIXTURE_DIR / 'swf/equipment-rules.swf'
BASE_APK = FIXTURE_DIR / 'WorldFlipper-equipment-rules.apk'
BASE_SWF_SHA = '6989d31a99a04882a152e5b55343ff2ead65c3ae433d1fc3b5da3985fdfe6237'
BASE_ABC_SHA = 'd99246d9ced7b7e81c81d27ad436347cb2a1b02b861558776f566ef091773b22'
TARGET_ABC_SHA = '4994e23d612c24a7c13072bf641b9b11ca0aa2e36561cb3d521bda16e325c38b'


def _load(name, file):
    """按路径以唯一模块名加载，避免与其他补丁目录的 rules.py / verify.py / overlay.py 互相遮蔽。"""
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PATCH_DIR / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


overlay = _load('equipment_desc_override_overlay', 'overlay.py')
rules = overlay.rules
asm, bodies, SwfAbc = overlay.asm, overlay.bodies, overlay.SwfAbc
verify = _load('equipment_desc_override_verify', 'verify.py')
apply_mod = _load('equipment_desc_override_apply', 'apply_equipment_description_override.py')
package_mod = _load('equipment_desc_override_package', 'package_apk.py')
desc_interp = verify.desc_interp


def build(mutate=None, path=BASE):
    swf = SwfAbc(path)
    editor, report = overlay.patch_editor(swf, mutate=mutate)
    return swf, editor, report


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class DesignConstantsTest(unittest.TestCase):
    """不需要夹具的设计常量。"""

    def test_override_keys_are_derived_from_the_equipment_id(self):
        self.assertEqual({'base': 'desc_override_equipment_5920001',
                          'growth': 'desc_override_equipment_enhancement_5920001',
                          'final': 'desc_override_equipment_enhancement_5920001_final'},
                         rules.override_keys(5920001))
        self.assertEqual(('desc_override_equipment_', 'desc_override_equipment_enhancement_', '_final'),
                         rules.ADDED_STRINGS)

    def test_candidate_capabilities_are_equipment_rules_plus_one(self):
        self.assertEqual('equipment-description-override-v1', rules.CAPABILITY)
        self.assertEqual(9, len(rules.INHERITED_CAPABILITIES))
        self.assertEqual(sorted(rules.INHERITED_CAPABILITIES + (rules.CAPABILITY,)), package_mod.capabilities())
        self.assertEqual(TARGET_ABC_SHA, apply_mod.TARGET_ABC_SHA)
        self.assertEqual(TARGET_ABC_SHA, package_mod.TARGET_ABC_SHA)

    def test_capability_and_key_shape_agree_with_data_side_gate(self):
        """数据侧门禁（mod-tools/wf_client_legality.py）与补丁对同一能力名、同一键形。门禁尚未实现时跳过。"""
        path = MOD_TOOLS / 'wf_client_legality.py'
        if not path.is_file():
            self.skipTest('mod-tools/wf_client_legality.py unavailable')
        added = str(MOD_TOOLS) not in sys.path
        if added:
            sys.path.insert(0, str(MOD_TOOLS))
        try:
            spec = importlib.util.spec_from_file_location('equipment_desc_override_legality_probe', path)
            legality = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(legality)
        except ImportError as exc:
            self.skipTest(f'wf_client_legality not importable: {exc}')
        finally:
            if added:
                sys.path.remove(str(MOD_TOOLS))
        if not hasattr(legality, 'EQUIPMENT_DESC_OVERRIDE'):
            self.skipTest('data-side EQUIPMENT_DESC_OVERRIDE not implemented yet')
        self.assertEqual(rules.CAPABILITY, legality.EQUIPMENT_DESC_OVERRIDE)
        for key in rules.override_keys(5920001).values():
            self.assertEqual(rules.CAPABILITY, legality.panel_override_capability(key), key)
            if hasattr(legality, 'EQUIPMENT_DESC_OVERRIDE_KEY_RE'):
                self.assertTrue(legality.EQUIPMENT_DESC_OVERRIDE_KEY_RE.fullmatch(key), key)

    def test_interpreter_extends_equipment_rules_interpreter_without_touching_it(self):
        base = desc_interp.base
        self.assertEqual('equipment_desc_override_avm_base', base.__name__)
        self.assertEqual((PATCH_DIR.parent / 'equipment-rules/avm_interp.py').resolve(), Path(base.__file__).resolve())
        self.assertTrue(issubclass(desc_interp.DescInterp, base.Interp))
        self.assertIs(desc_interp.AvmThrow, base.AvmThrow)


@unittest.skipUnless(BASE.is_file(), 'local equipment-rules client SWF fixture unavailable')
class EquipmentDescOverrideTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert sha(BASE.read_bytes()) == BASE_SWF_SHA
        cls.swf, cls.editor, cls.report = build()
        cls.abc = cls.swf.abc
        cls.base_abc = SwfAbc(BASE).abc
        assert sha(cls.base_abc.serialize()) == BASE_ABC_SHA
        cls.locks = json.loads((PATCH_DIR / 'baseline.json').read_text(encoding='utf8'))
        cls.results, cls.probes = verify.behaviour_matrix(cls.abc)
        cls.native, cls.native_probes = verify.behaviour_matrix(cls.base_abc)

    # ------------------------------------------------------------------ 结构
    def test_locks_describe_the_equipment_rules_baseline(self):
        self.assertEqual(set(rules.TARGETS), set(self.locks))
        for label, lock in self.locks.items():
            index = bodies.resolve(self.base_abc, label)
            body = self.base_abc.bodies[index]
            self.assertEqual(lock['index'], index, label)
            self.assertEqual(lock['sha'], sha(body[5]), label)
            self.assertEqual(lock['header'], list(body[1:5]), label)

    def test_only_locked_bodies_change_and_every_insertion_is_reversible(self):
        self.assertEqual(set(self.locks), set(self.report['methods']))
        self.assertEqual(len(self.base_abc.bodies) - len(self.locks), self.report['unchanged_method_bodies'])
        self.assertEqual(92565, self.report['unchanged_method_bodies'])
        self.assertEqual(rules.INSERTED_COUNTS, self.report['inserted_counts'])
        self.assertEqual(verify.EXPECTED_HEADERS, self.report['headers'])
        fix = lambda ins: [asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in ins]  # noqa: E731
        for label, change in self.report['methods'].items():
            body = self.abc.bodies[bodies.resolve(self.abc, label)]
            self.assertEqual(self.locks[label]['sha'], change['before'])
            self.assertEqual([(rules.ANCHOR, rules.INSERTED_COUNTS[label], asm.FORBID)],
                             [tuple(x) for x in change['insertions']])
            self.assertEqual(self.locks[label]['sha'], sha(asm.unsplice_many(body[5], change['insertions'])))
            native = asm.decode(self.base_abc.bodies[bodies.resolve(self.base_abc, label)][5])
            patched = asm.decode(body[5])
            before = asm.simulate(fix(native), body[3], self.abc.multinames)
            after = asm.simulate(fix(patched), body[3], self.abc.multinames)
            self.assertEqual(before[1], after[1], label)          # 作用域深度不变
            self.assertEqual(before[2], after[2], label)          # 死代码数不变，插入段全部可达
            self.assertEqual(self.locks[label]['header'][0], body[1], label)   # maxstack 不需抬高
            self.assertLessEqual(after[0], body[1], label)

    def test_patched_abc_is_the_locked_target_and_reproducible(self):
        self.assertEqual(TARGET_ABC_SHA, sha(self.abc.serialize()))
        again, _, _ = build()
        self.assertEqual(self.abc.serialize(), again.abc.serialize())

    def test_constant_pool_only_appends_three_strings(self):
        pool = self.report['pool']
        self.assertEqual(list(rules.ADDED_STRINGS), pool['added_strings'])
        self.assertEqual([], pool['added_multinames'])
        self.assertEqual([], pool['added_ints'])

    def test_stacked_patch_bodies_and_tables_preserved(self):
        result = verify.preservation(SwfAbc(BASE), self.swf)
        self.assertTrue(result['ok'], {k: v for k, v in result.items() if k != 'pools'})
        self.assertEqual([7492, 7494, 7700], result['changed_bodies'])
        self.assertEqual(92565, result['unchanged_bodies'])
        self.assertEqual(0, result['added_bodies'])
        labels = result['stacked_patch_bodies']
        for group in (verify.EQUIPMENT_RULES_BODIES, verify.EQUIPMENT_RULES_ADDED, verify.BR_ADDED,
                      verify.KYUBI_BODIES, ('MemberImpl/applyInstantAbility',)):
            for label in group:
                self.assertEqual('identical', labels[label], label)
        self.assertEqual({'identical'}, set(labels.values()))

    def test_static_proof_block_is_isolated_from_the_native_body(self):
        proof = verify.static_proof(self.base_abc, self.abc)
        self.assertTrue(proof['ok'], proof)
        for label in rules.TARGETS:
            self.assertNotIn(rules.GET_MASTER, proof[label]['calls'])
            self.assertIn(rules.MAYBE, proof[label]['calls'])

    def test_patching_twice_is_refused(self):
        with self.assertRaises(asm.AsmError):
            overlay.patch_editor(self.swf)

    # ------------------------------------------------------------------ 行为
    def test_behaviour_matrix_on_patched_build(self):
        mismatches = {verify.matrix_key(k): [self.results[k], v] for k, v in verify.EXPECTED.items()
                      if self.results[k] != v}
        self.assertEqual({}, mismatches)
        self.assertEqual(80, len(self.results))
        self.assertEqual(32, len(verify.HITS))

    def test_hit_shapes(self):
        r = self.results
        self.assertEqual(('lines', ['B1', 'B2', 'B3']), r[('paradox_all_keys', 'lines')])
        self.assertEqual(('text', 'B1<NL>B2<NL>B3'), r[('paradox_all_keys', 'text_newline')])
        self.assertEqual(('text', 'B1<D>B2<D>B3'), r[('paradox_all_keys', 'text_inline')])
        self.assertEqual(('blocks', {0: {1: ['G1', 'G2']}, 1: {120: ['F1', 'F2', 'F3']}}),
                         r[('paradox_all_keys', 'blocks')])
        # 满级块键缺失 / 空串 / null：只返回成长块
        for name in ('paradox_growth_without_final', 'paradox_final_empty', 'paradox_final_null'):
            self.assertEqual(('blocks', {0: {1: ['G1', 'G2']}}), r[(name, 'blocks')], name)
        # 满级块的等级取对象的 maxLevel，不写死 120
        self.assertEqual(('blocks', {0: {1: ['G1', 'G2']}, 1: {80: ['F1', 'F2', 'F3']}}),
                         r[('paradox_max_level_80', 'blocks')])
        # 命中时在 2324 检查之前返回：原生数据会抛 2324，覆盖照常显示
        self.assertEqual(verify.TWO_BLOCKS, r[('paradox_native_would_throw_2324', 'blocks')])
        self.assertEqual(('lines', ['ONE']), r[('paradox_single_lines', 'lines')])

    def test_misses_run_the_original_method(self):
        r = self.results
        for name in ('tier_5921001', 'tier_5922001', 'tier_5923001', 'official_5020042', 'table_not_loaded',
                     'rows_missing', 'empty_strings', 'null_strings', 'v2_panel_key_namespace',
                     'paradox_final_key_only'):
            for method in verify.METHOD_LABELS:
                self.assertEqual(verify.NATIVE[method], r[(name, method)], (name, method))
        self.assertEqual(verify.NATIVE['lines'], r[('paradox_enhancement_keys_only', 'lines')])
        self.assertEqual(verify.NATIVE['blocks'], r[('paradox_base_key_only', 'blocks')])
        self.assertEqual(('throw', 2324), r[('tier_miss_keeps_native_2324', 'blocks')])

    def test_probe_uses_maybe_table_and_id_derived_keys_only(self):
        for key, expected in verify.EXPECTED_PROBES.items():
            self.assertEqual(expected, self.probes[key], key)
        for key, probe in self.probes.items():
            self.assertEqual([rules.CAS], probe['maybe_tables'], key)
        errors = {k: v for k, v in self.results.items() if v[0] == 'error'}
        self.assertEqual({}, errors)          # 假容器的 getMasterTable 一被调用就会在这里出现

    def test_fallthrough_reaches_native_entry_on_every_miss(self):
        fall = verify.fallthrough_matrix(self.abc)
        for key in verify.EXPECTED:
            want = verify.EXPECTED[key] if key in verify.HITS else 'native_entry'
            self.assertEqual(want, fall[key], key)

    def test_dialog_chain_greys_final_block_until_max_level(self):
        chain = verify.dialog_chain(self.abc)
        self.assertEqual(verify.EXPECTED_CHAIN, chain)

    # ------------------------------------------------------------------ 负对照
    def test_negative_control_unpatched_baseline_is_native_everywhere(self):
        for key in verify.EXPECTED:
            self.assertEqual(verify.native_expected(key), self.native[key], key)
        self.assertEqual(set(verify.HITS), {k for k in verify.HITS if self.native[k] != verify.EXPECTED[k]})
        self.assertFalse([k for k, v in self.native_probes.items() if v['maybe_tables'] or v['lookups']])
        fall = verify.fallthrough_matrix(self.base_abc)
        self.assertEqual({'native_entry'}, set(fall.values()))
        self.assertEqual(verify.NATIVE_CHAIN, verify.dialog_chain(self.base_abc))

    def test_negative_control_mutants_turn_every_hit_red(self):
        for name, mutate in verify.MUTANTS.items():
            swf, _, _ = build(mutate=mutate)
            still = [k for k in verify.HITS if verify.run_scenario(swf.abc, *k)[0] == verify.EXPECTED[k]]
            self.assertEqual([], still, name)
            # 控制项不受影响：变异体仍然是完整的原生回落
            control = ('official_5020042', 'blocks')
            self.assertEqual(verify.NATIVE['blocks'], verify.run_scenario(swf.abc, *control)[0], name)

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
            self.assertTrue(checked['swf_container_matches_equipment_rules'])
            result = apply_mod.prepare(apk, root / 'out', mutants=False)
            self.assertEqual('prepared', result['status'])
            self.assertEqual(before, apk.read_bytes())
            self.assertEqual(TARGET_ABC_SHA, result['output_abc_sha256'])
            self.assertEqual(sorted(self.locks), result['changed_methods'])
            report = json.loads((root / 'out/patch-report.json').read_text(encoding='utf8'))
            self.assertEqual(BASE_SWF_SHA, report['source_sha256'])
            self.assertEqual([rules.CAPABILITY], report['capabilities_added'])
            self.assertTrue(json.loads((root / 'out/verify-report.json').read_text(encoding='utf8'))['ok'])
            with self.assertRaises(FileExistsError):
                apply_mod.prepare(apk, root / 'out')
            self.assertEqual('already_patched', apply_mod.prepare(result['output_swf'], root / 'unused')['status'])
            self.assertFalse((root / 'unused').exists())
            # 同一主 ABC、不同容器（基线是未压缩 FWS，这里重新压成 CWS）：按 ABC 认基线，容器只作参考
            raw = SwfAbc(BASE)
            self.assertEqual(b'FWS', raw.signature)
            cws = root / 'recompressed.swf'
            cws.write_bytes(b'CWS' + bytes([raw.version]) + struct.pack('<I', len(raw.body) + 8)
                            + zlib.compress(raw.body))
            state = apply_mod.prepare(cws, check_only=True)
            self.assertEqual(('ready', False), (state['status'], state['swf_container_matches_equipment_rules']))
            foreign = root / 'foreign.swf'
            foreign.write_bytes(b'not the equipment-rules client')
            with self.assertRaisesRegex(ValueError, 'Unknown SWF baseline'):
                apply_mod.prepare(foreign, root / 'foreign-out')
            self.assertFalse((root / 'foreign-out').exists())
            # 1047（未打 equipment-rules）的主 SWF 也拒绝
            older = Path('D:/WF/out/月兔回槽性能与狮子PF点火-20260925/gauge-performance.swf')
            if older.is_file():
                with self.assertRaisesRegex(ValueError, 'Unknown SWF baseline'):
                    apply_mod.prepare(older, check_only=True)

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
            for field, value, message in (('patch', 'equipment-rules', 'not an equipment-description-override'),
                                          ('output_abc_sha256', BASE_ABC_SHA, 'verified target ABC'),
                                          ('output_sha256', sha(b'x'), 'does not match the patch report'),
                                          ('source_sha256', BASE_SWF_SHA, 'not the SWF this patch was applied to')):
                with self.assertRaisesRegex(ValueError, message):
                    package_mod.check_inputs(args(dict(good, **{field: value})))
            # 底包不是已安装的 e03bc22b：不带显式开关就在签名前拒绝（命名空间缺该属性也按拒绝处理）
            with self.assertRaisesRegex(ValueError, 'not the installed equipment-rules build'):
                package_mod.check_inputs(args(good, allow_foreign_base=False))
            with self.assertRaisesRegex(ValueError, 'not the installed equipment-rules build'):
                path = root / 'report.json'
                package_mod.check_inputs(argparse.Namespace(base=apk, swf=swf, patch_report=path))

    @unittest.skipUnless(BASE_APK.is_file(), 'installed equipment-rules APK unavailable')
    def test_package_accepts_the_installed_base_without_the_override_flag(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            swf = root / 'candidate.swf'
            swf.write_bytes(b'candidate')
            report = root / 'report.json'
            report.write_text(json.dumps({
                'patch': overlay.PATCH_NAME, 'status': overlay.STATUS, 'output_abc_sha256': TARGET_ABC_SHA,
                'output_sha256': sha(b'candidate'), 'source_sha256': BASE_SWF_SHA, 'methods': {}}), encoding='utf8')
            package_mod.check_inputs(argparse.Namespace(base=BASE_APK, swf=swf, patch_report=report,
                                                        allow_foreign_base=False))

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
            self.assertIn('not the installed equipment-rules build', str(result))
            self.assertEqual([], calls, 'build_apk.py must not run for a refused base')

    def test_package_refuses_a_foreign_certificate_and_marks_the_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, calls, build_report = self._package_with_fake_signer(Path(tmp), ['00' * 32])
            self.assertIsInstance(result, ValueError)
            self.assertIn('certificate', str(result))
            self.assertEqual(1, len(calls))
            written = json.loads(build_report.read_text(encoding='utf8'))
            self.assertEqual('refused_certificate_mismatch', written['status'])
            self.assertNotIn(rules.CAPABILITY, written['candidate_capabilities'])
            self.assertNotIn('equipment_description_override', written)

    def test_package_positive_control_with_the_installed_certificate(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, calls, build_report = self._package_with_fake_signer(Path(tmp), [package_mod.CERTIFICATE_SHA])
            self.assertIsInstance(result, dict, result)
            self.assertEqual(1, len(calls))
            self.assertEqual(package_mod.capabilities(), result['candidate_capabilities'])
            self.assertTrue(result['equipment_description_override']['certificate_matches_installed'])
            self.assertFalse(result['equipment_description_override']['base_apk_is_installed_equipment_rules'])
            self.assertEqual('signed_static_candidate',
                             json.loads(build_report.read_text(encoding='utf8'))['status'])

    @unittest.skipUnless(BASE_APK.is_file(), 'installed equipment-rules APK unavailable')
    def test_installed_apk_carries_the_baseline_swf(self):
        with zipfile.ZipFile(BASE_APK) as archive:
            self.assertEqual(BASE_SWF_SHA, sha(archive.read(apply_mod.SWF_MEMBER)))
        self.assertEqual('ready', apply_mod.prepare(BASE_APK, check_only=True)['status'])


if __name__ == '__main__':
    unittest.main()
