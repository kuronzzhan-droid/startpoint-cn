from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import patch
import asm
import router_blocks as blocks
import verify


class Pool:
    def __init__(self):
        self.strings, self.ints = [], []
        self.names = {9733:'character',15727:'mainCharacterStringId',46:'index',80:'params',
            9604:'logic',7746:'logicAssets',8215:'existsVoiceFileReader',241:'Some',
            7439:'characterId',7784:'addSoundEffect',100001:blocks.NORMAL_SLOT,100002:blocks.MATCHED_SLOT}
    def string(self, value):
        value = value.encode()
        if value not in self.strings: self.strings.append(value)
        return self.strings.index(value)
    def integer(self, value):
        if value not in self.ints: self.ints.append(value)
        return self.ints.index(value)
    def mn_name(self, index): return self.names[index]


def fixture():
    pool = Pool(); slots = {blocks.NORMAL_SLOT:100001, blocks.MATCHED_SLOT:100002}
    ready = asm.assemble(blocks.ready_block(pool, slots))
    preload = asm.assemble(blocks.preload_block(pool))
    return pool, ready, preload


class RouterTests(unittest.TestCase):
    def test_all_actual_opcode_branches_normal_matched_missing_and_unrelated(self):
        pool,ready,preload = fixture()
        self.assertEqual(len(verify.scenarios(ready,preload,pool)),150)

    def test_shared_counter_mutation_is_detected(self):
        pool,ready,preload = fixture()
        mutated = deepcopy(ready)
        for instruction in mutated:
            if instruction.name in ('getproperty','setproperty') and instruction.args == [100002]:
                instruction.args = [100001]
        with self.assertRaises(AssertionError): verify.scenarios(mutated,preload,pool)

    def test_wrong_character_preload_is_detected(self):
        pool,ready,preload = fixture();pool.ints[pool.ints.index(blocks.CID)] = 149990
        with self.assertRaises(AssertionError): verify.scenarios(ready,preload,pool)

    def test_wrong_base_and_overwriting_outputs_are_rejected_without_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder);source=folder/'source.swf';source.write_bytes(b'not verified V16')
            output=folder/'result.swf';report=folder/'report.json'
            with self.assertRaisesRegex(asm.AsmError,'verified installed V16'):patch.apply(source,output,report)
            self.assertFalse(output.exists());self.assertFalse(report.exists())
            with self.assertRaises(asm.AsmError):patch.apply(source,output,output)
            with self.assertRaises(asm.AsmError):patch.apply(source,source,report)
            self.assertEqual(source.read_bytes(),b'not verified V16')


if __name__=='__main__':unittest.main()
