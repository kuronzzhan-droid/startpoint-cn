import unittest

from wf_magnus_hibiki_voice_revision import expected_slots, speech_rows


class VoiceRevisionTests(unittest.TestCase):
    def setUp(self):
        self.before = [['0', '2', '', '旧主页', 'home/home_0'],
                       ['2', '', '', '旧加入', 'ally/join'],
                       ['1', '', '1', '旧进化', 'ally/evolution']]
        self.lines = [dict(slot=s, zh='新台词') for s in
                      ['home/home_0', 'home/home_1', 'ally/join', 'ally/evolution', 'battle/skill_0']]

    def test_home_append_preserves_all_existing_bindings(self):
        result = speech_rows(self.before, self.lines)
        self.assertEqual([r[:3]+[r[4]] for r in result[:3]],
                         [r[:3]+[r[4]] for r in self.before])
        self.assertEqual(result[3], ['0', '2', '', '新台词', 'home/home_1'])
        self.assertEqual(self.before[0][3], '旧主页')

    def test_idempotent_and_no_battle_subtitle_rows(self):
        first = speech_rows(self.before, self.lines)
        self.assertEqual(first, speech_rows(first, self.lines))
        self.assertFalse(any(r[4].startswith('battle/') for r in first))

    def test_unknown_existing_binding_rejected(self):
        with self.assertRaises(ValueError):
            speech_rows(self.before+[['0', '2', '', '外来', 'home/unknown']], self.lines)

    def test_duplicate_binding_rejected(self):
        with self.assertRaises(ValueError):
            speech_rows(self.before+[self.before[0]], self.lines)

    def test_evolution_unlock_not_invented(self):
        with self.assertRaises(ValueError):
            speech_rows(self.before[:-1], self.lines)

    def test_home_unlock_schema_change_rejected(self):
        self.before[0][1] = '1'
        with self.assertRaises(ValueError):
            speech_rows(self.before, self.lines)

    def test_exact_requested_pools(self):
        for role, total, home, ready, skill, pf in [('magnus',46,12,6,8,10), ('hibiki',33,8,3,6,6)]:
            slots = expected_slots(role)
            self.assertEqual(len(slots), total)
            self.assertEqual(sum(s.startswith('home/') for s in slots), home)
            self.assertEqual(sum('ready' in s for s in slots), ready)
            self.assertTrue({f'battle/skill_{i}' for i in range(skill)} <= slots)
            self.assertTrue({f'battle/power_flip_{i}' for i in range(pf)} <= slots)


if __name__ == '__main__':
    unittest.main()
