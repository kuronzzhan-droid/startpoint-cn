import unittest

import wf_seasonal7_voice as voice
from wf_voice_selection_timing import delivery_edges, delivery_dead_air


class DeliveryTimingTests(unittest.TestCase):
    def test_trimmed_lead_is_not_rejected_again(self):
        metrics = dict(duration=2.84, lead_in_seconds=1.12, tail_seconds=0.06)
        qc = dict(seconds=1.81, trim=dict(start_seconds=1.0, end_seconds=2.78))
        self.assertEqual(delivery_edges(metrics, qc), (0.12, 0.0))
        self.assertAlmostEqual(delivery_dead_air(metrics, qc), 0.12 / 1.81)

    def test_untrimmed_silence_stays_visible(self):
        self.assertEqual(delivery_edges(dict(lead_in_seconds=1.12, tail_seconds=0.7), {}),
                         (1.12, 0.7))

    def test_missing_subtitle_uses_mastered_audio(self):
        qc = dict(source_pcm=dict(leading_quiet_seconds=1.3, trailing_quiet_seconds=0.8),
                  mastered_pcm=dict(leading_quiet_seconds=0.1, trailing_quiet_seconds=0.15))
        self.assertEqual(delivery_edges({}, qc), (0.1, 0.15))

    def test_dash_is_not_a_spoken_word_but_inserted_words_still_fail(self):
        self.assertEqual(voice.normalize_spoken('——ひとつとっておけ。'),
                         voice.normalize_spoken('ひとつとっておけ'))
        self.assertNotEqual(voice.normalize_spoken('よばんぶんだ、ひとつとっておけ。'),
                            voice.normalize_spoken('——ひとつとっておけ。'))


if __name__ == '__main__':
    unittest.main()
