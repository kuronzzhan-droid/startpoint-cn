import unittest
from fractions import Fraction
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_content_gacha as g


def pool(rates):
    return {"rankRates": {"normal": rates, "multiGuarantee": [rates[0], 1000-rates[0]]},
            "pool": {"1": [dict(id=i, rank=5, odds=w, isExchangeable=True)
                            for i, w in ((101, 99999), (102, 17), (149990, 0))],
                     "2": [dict(id=201, odds=20)], "3": [dict(id=301, odds=30)]}}


class ContentGachaTests(unittest.TestCase):
    def test_exact_rates_and_foreign_pools(self):
        data = {"990001": pool([150, 350, 500]), "990002": pool([950, 20, 30]), "foreign": ["keep"]}
        roster = g.MINIBOSSES | g.NEW_ABYSS_ZERO | {149990, 169999}
        result = g.build(data, roster)
        for cid in roster:
            self.assertEqual(g.probability(result["990002"], cid), Fraction(1, 100))
        for cid in g.MINIBOSSES:
            self.assertEqual(g.probability(result["990001"], cid), Fraction(2, 100))
        self.assertEqual(result["foreign"], data["foreign"])
        self.assertEqual(data["990001"]["rankRates"]["normal"], [150, 350, 500])
        for pid in ("990001", "990002"):
            self.assertEqual(result[pid]["pool"]["2"], data[pid]["pool"]["2"])
            self.assertEqual(result[pid]["pool"]["3"], data[pid]["pool"]["3"])
            self.assertEqual(sum(result[pid]["rankRates"]["normal"]), 1000)
            self.assertEqual(sum(result[pid]["rankRates"]["multiGuarantee"]), 1000)

    def test_rounding_never_changes_total_or_zero(self):
        self.assertEqual(g.allocate({1: 1, 2: 1, 3: 1, 4: 0}, 2), {1: 1, 2: 1, 3: 0, 4: 0})
        self.assertEqual(sum(g.allocate({1: 39187, 2: 9983, 3: 15}, 105000).values()), 105000)

    def test_rejects_unreviewed_rates_and_duplicate(self):
        data = {"990001": pool([160, 340, 500]), "990002": pool([950, 20, 30])}
        with self.assertRaisesRegex(ValueError, "baseline"):
            g.build(data, g.MINIBOSSES | g.NEW_ABYSS_ZERO)
        target = pool([950, 20, 30])
        target["pool"]["1"].append(dict(target["pool"]["1"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            g.update_entries(target, {1: 10000}, 950000)

    def test_zero_entries_remain_nonexchangeable(self):
        data = {"990001": pool([150, 350, 500]), "990002": pool([950, 20, 30])}
        result = g.build(data, g.MINIBOSSES | g.NEW_ABYSS_ZERO | {149990})
        for e in result["990001"]["pool"]["1"]:
            if e["id"] in g.NEW_ABYSS_ZERO:
                self.assertFalse(e["isExchangeable"])
                self.assertEqual(e["odds"], 0)

    def test_named_big_boss_series_stay_zero_without_excluding_small_robots(self):
        data = {"990001": pool([150, 350, 500]), "990002": pool([950, 20, 30])}
        # 歼灭者原本可抽；本次整个系列明确归零。未入深渊的大Boss不新增条目。
        data['990001']['pool']['1'].append(dict(id=179981, rank=5, odds=666, isExchangeable=True))
        roster = g.MINIBOSSES | g.NEW_ABYSS_ZERO | g.BIG_BOSS_ZERO | {169980, 149990}
        result = g.build(data, roster)
        self.assertEqual(len(g.BIG_BOSS_ZERO), 25)
        self.assertFalse(g.BIG_BOSS_ZERO & g.MINIBOSSES)
        for cid in g.BIG_BOSS_ZERO:
            self.assertEqual(g.probability(result['990002'], cid), 0)
        self.assertEqual(g.probability(result['990001'], 179981), 0)
        self.assertNotIn(119970, {e['id'] for e in result['990001']['pool']['1']})
        for cid in (159999, 169980):
            self.assertEqual(g.probability(result['990002'], cid), Fraction(1, 100))
        self.assertEqual(g.probability(result['990001'], 159999), Fraction(2, 100))


if __name__ == "__main__":
    unittest.main()
