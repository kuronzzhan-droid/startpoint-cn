import unittest
import wf_seasonal7_voice as voice
from wf_seasonal7_voice_merge import remap_slot, merge_speech


class VoiceMergeTest(unittest.TestCase):
    def test_no_collision_and_all_sources_preserved(self):
        mapped=[remap_slot(s) for s in voice.SLOTS]
        self.assertEqual(len(mapped),22)
        self.assertEqual(len(set(mapped)|set(voice.SLOTS)),44)

    def test_battle_pools_have_contiguous_native_indices(self):
        for name,count in [('skill',4),('battle_start',2),('power_flip',2),('outhole',2),('win',2)]:
            old=[f'battle/{name}_{i}' for i in range(count)]
            self.assertEqual(old+[remap_slot(s) for s in old],[f'battle/{name}_{i}' for i in range(2*count)])

    def test_preparation_routes_remain_separate(self):
        self.assertEqual(remap_slot('battle/skill_ready'),'battle/skill_ready_alt')
        self.assertEqual(remap_slot('battle/matched_skill_ready'),'battle/matched_skill_ready_alt')

    def test_invalid_slot_fails(self):
        for slot in ['battle/skill_9','home/home_6','battle/noise_0']:
            with self.assertRaises(ValueError):remap_slot(slot)

    def test_speech_preserves_kinds_unlocks_and_original_subtitles(self):
        before=[['0','2','','旧主页','home/home_0'],['1','','1','旧觉醒','ally/evolution'],
                ['2','','','旧加入','ally/join']]
        added=[{'slot':r[4],'zh':'新'+r[3]} for r in before]
        after=merge_speech(before,added)
        self.assertEqual(after[:3],before)
        for old,new in zip(before,after[3:]):
            self.assertEqual(old[:3],new[:3]);self.assertEqual(new[3],'新'+old[3])
            self.assertEqual(new[4],remap_slot(old[4]))

    def test_duplicate_or_missing_donor_rejected(self):
        row=['2','','','hello','ally/join']
        for before in [[],[row,row]]:
            with self.assertRaises(ValueError):merge_speech(before,[{'slot':'ally/join','zh':'x'}])


if __name__=='__main__':unittest.main()
