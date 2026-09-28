# -*- coding: utf-8 -*-
"""wf_five_boss_v2：纯函数单测 + live store 冒烟（store 不在时跳过）。"""
from __future__ import annotations

import sys
import unittest
import zlib
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import wf_dsl  # noqa: E402
import wf_five_boss_v2 as F  # noqa: E402
import wf_quest_lib as q  # noqa: E402


PARAMS = F.load_spec()["affix_params"]


class PureFunctionTests(unittest.TestCase):
    def test_num_never_uses_exponent(self):
        self.assertEqual(F.num(1319617.52), "1319617.52")
        self.assertEqual(F.num(2500.0), "2500")
        self.assertEqual(F.num(-0.3), "-0.3")
        self.assertEqual(F.num(1e9), "1000000000")
        self.assertNotIn("e", F.num(1.23456789e12))

    def test_affix_trees_whitelisted_and_roundtrip(self):
        for name, tree in F.affix_library(PARAMS).items():
            with self.subTest(affix=name):
                self.assertEqual(F.dsl_constructor_problems(tree), [])
                raw = F.encode_dsl(tree)
                self.assertEqual(wf_dsl.parse_dsl(zlib.decompress(raw, -15))["tree"], tree)

    def test_whitelist_catches_typo(self):
        tree = F._root([F._cmd(["CreateConditon", 0, []])])
        self.assertEqual(F.dsl_constructor_problems(tree), ["CreateConditon"])

    def test_purge_uses_forced_dispel_and_gauge_clear(self):
        cmds = list(wf_dsl.iter_dsl_commands(F.affix_library(PARAMS)["purge_r1"]))
        deletes = [c for c in cmds if c[0] == "DeleteCondition"]
        self.assertTrue(deletes and all(c[2] == ["DCAll", 2] and c[4] == 2 for c in deletes))
        self.assertTrue(any(c[0] == "SubtractSkillPoint" and c[2] == [{"min": 1, "max": 1}] for c in cmds))

    def test_replace_in_chunk_keeps_sibling_bytes(self):
        tree = {"a": "1,2,3", "b": {"x": "4,5", "y": "6"}}
        raw = q.build_node(tree)
        new = F.replace_in_chunk(raw, ["b", "y"], "7")
        self.assertEqual(q.parse_node(new), {"a": "1,2,3", "b": {"x": "4,5", "y": "7"}})
        keys, chunks = q._try_parse_map(new)
        keys0, chunks0 = q._try_parse_map(raw)
        self.assertEqual(chunks[0], chunks0[0])          # 兄弟键 a 原字节
        added = F.replace_in_chunk(raw, ["c", "z"], "8")
        self.assertEqual(q.parse_node(added)["c"], {"z": "8"})
        removed = F.replace_in_chunk(raw, ["a"], None)
        self.assertNotIn("a", q.parse_node(removed))

    def test_write_rows_quotes_commas_without_trailing_newline(self):
        self.assertEqual(F.write_rows([["a,b", "c"]]), '"a,b",c')

    def test_watch_copies_self_and_partner(self):
        gew = {"1": {"m": {"m": {"2": {"f": {"f": "rows1"}}}}},
               "2": {"f": {"f": {"1": {"m": {"m": "rows2"}, "other": {"other": "rows3"}}}}}}
        got = dict((tuple(p), n) for p, n in F.watch_copies(gew, "m", "c"))
        self.assertEqual(got[("1", "c")], {"c": {"2": {"f": {"f": "rows1"}}}})
        self.assertEqual(got[("2", "f", "f", "1", "c")], {"c": "rows2"})
        self.assertEqual(len(got), 2)


STORE_OK = True
try:
    q.store_path(F.T_BBQ).stat()
except Exception:  # noqa: BLE001
    STORE_OK = False


@unittest.skipUnless(STORE_OK, "live store not available")
class LiveBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = F.load_spec()
        cls.live = F.Live()
        cls.plan = F.build(cls.spec, cls.live)

    def edits(self, table):
        return {tuple(p): n for p, n in self.plan.edits.get(table, [])}

    def test_no_gate_problems(self):
        self.assertEqual(self.plan.problems, [])

    def test_budget_every_variant_within_fail_line(self):
        for qid, b in self.plan.report["budget"].items():
            self.assertLessEqual(b["mpx"], self.spec["budget"]["fail_mpx"], qid)

    def test_routes_cover_all_pairs_and_fallback_is_last(self):
        r0 = [v.quest for v in self.spec["_variants"] if v.round == "r0"]
        r1 = [v.quest for v in self.spec["_variants"] if v.round == "r1"]
        maps = self.edits(F.T_BBM)
        pairs = set()
        for (mid,), text in maps.items():
            row = F.one_row(text)
            if mid == str(self.spec["fallback_map_id"]):
                self.assertEqual(row[1], "(None)")
                continue
            self.assertEqual((row[1], row[2]), ("0", str(F.ALWAYS_TRUE_THRESHOLD)))
            pairs.add((int(row[11]), int(row[12])))
        self.assertEqual(pairs, {(a, b) for a in r0 for b in r1})
        group = F.one_row(self.edits(F.T_BBG)[(str(self.spec["entry_quest"]),)])
        ids = group[1].split(",")
        self.assertEqual(ids[-1], str(self.spec["fallback_map_id"]))
        self.assertEqual(len(ids), len(pairs) + 1)

    def test_quest_rows(self):
        quests = self.edits(F.T_BBQ)
        for v in self.spec["_variants"]:
            row = F.one_row(quests[("1", "99", str(v.quest - 1099000))])
            self.assertEqual(row[0], str(v.quest))
            self.assertEqual((row[F.Q_HP[2]], row[F.Q_TP[2]]), ("1", "1"))
            self.assertEqual(row[F.Q_TIME], str(self.spec["time_limit_frames"]))
            self.assertEqual((row[F.Q_IS_BOTH], row[F.Q_HIDDEN]), ("false", "true"))

    def test_clone_hp_and_tp_match_targets(self):
        bl = self.edits(F.T_BL)
        for code, info in self.plan.clones.items():
            row = F.one_row(bl[(code,)])
            unit = F.GENERAL_HP_K_LV80 * float(row[F.BL_HP_MUL]) * F.curve_hp_corr(row[F.BL_HP_CORR])
            self.assertAlmostEqual(float(row[F.BL_HP_HITS]) * unit / 1e8, info["hp_e8"], delta=info["hp_e8"] * 1e-4)
            self.assertEqual(row[F.BL_TP_CURVE], F.TP_CURVE)
            self.assertAlmostEqual(float(row[F.BL_TP_BASE]) * F.TP_NORMAL_LV80, info["tp"], delta=1)

    def test_carriers_and_entry_purge(self):
        purge = F.affix_program("purge_r1")
        gb = self.edits(F.T_GB)
        for code, info in self.plan.clones.items():
            tiers = gb[(code,)]
            row = F.one_row(tiers[F.tier_for_level(tiers)])
            pre = F.split_programs(row[F.GB_PRE])
            self.assertNotEqual(row[F.GB_PRE], "(None)", code)   # 官方写空串；(None) 会被当文件名加载
            self.assertFalse(any("/mod/five_boss/" in p for p in pre), code)   # v1 诅咒已剥离
            v = next(x for x in self.spec["_variants"] if x.quest == info["quest"])
            carrier = v.group_kind == 1 or info["slot"] == 0
            has_affix = any(p.startswith(F.OWN_DSL_DIR) for p in pre)
            self.assertEqual(has_affix, carrier and bool(v.affixes or v.entry_affixes), code)
            if purge in pre:
                self.assertEqual((info["wave"], row[F.GB_PRE_RERUN]), (0, "false"), code)

    def test_terrains(self):
        for rnd, t in self.spec["terrains"].items():
            tree, _ = F.build_terrain(self.live, t)
            for layer in F.object_layers(tree):
                self.assertFalse(any("ACCUMULATION" in str(o.get("type")) for o in layer["objects"]) and rnd == "r1")
                b = next(o for o in layer["objects"] if o.get("type") == "BOUNDS")
                for o in layer["objects"]:
                    if o.get("type") in ("FUNNEL_SPAWN6", "FUNNEL_SPAWN8"):
                        self.assertTrue(b["x"] <= o["x"] <= b["x"] + b["width"], (rnd, o))
                        self.assertTrue(b["y"] <= o["y"] <= b["y"] + b["height"], (rnd, o))

    def test_envy_revert_restores_official(self):
        node = self.edits(F.T_GBS).get(("devil_commander_evil_envy_80",))
        if self.plan.report.get("envy_revert") == "already official":
            self.skipTest("already reverted")
        self.assertIsNotNone(node)
        official = q.parse_node(F.official_table_loader(F.T_GBS)())["devil_commander_evil_envy_80"]
        self.assertEqual(node, official)

    def test_own_prefixes(self):
        for table in (F.T_ZONE, F.T_FD, F.T_GB, F.T_BL):
            for (key, *_rest) in self.edits(table):
                self.assertTrue(key.startswith(F.OWN_CODE_PREFIX), (table, key))


if __name__ == "__main__":
    unittest.main()
