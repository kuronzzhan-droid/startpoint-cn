"""Recover the original P0b insertion blocks and relocate only approved strings."""
import copy

import asm
from bootstrap import sha

TARGETS = (
    'GeneralAbilitySoulLogic/getAbility',
    'PartyLogic/getBattleParty',
    'TypePackerResource2/resolveMap1471',
    'TypePackerResource2/resolveMap2201',
    'BattleCharacterLogic/getAbilitySoulAbility',
)
STRINGS = ('1010001', '1060001', '1080001', '2020001', 'weapon_rivens',
           'Array<haxe.ds.Option<Array<Int>>>')
RELOCATION = dict(zip(range(94289, 94295), range(94303, 94309)))
EXPECTED_COUNTS = dict(zip(TARGETS, (4, 5, 2, 3, 1)))


def signature(instruction):
    return (instruction.op, instruction.args, instruction.target,
            instruction.cases, instruction.default)


def rebase_body(original, source, recovery, label):
    """Splice source blocks into p13, then prove the bounded operand exception."""
    assert not original[6] and not original[7]
    assert not source[6] and not source[7]
    assert asm.unsplice_many(source[5], recovery) == original[5], label
    operations = asm.decode(source[5])
    assert asm.encode(operations)[0] == source[5]
    additions, blocks = [], []
    inserted = 0
    for at, count, policy in recovery:
        assert policy == asm.ENTER
        block = copy.deepcopy(operations[at:at + count])
        for instruction in block:
            if instruction.target is not None:
                assert at <= instruction.target <= at + count
                instruction.target -= at
            if instruction.cases is not None:
                assert all(at <= x <= at + count
                           for x in [instruction.default, *instruction.cases])
                instruction.default -= at
                instruction.cases = [x - at for x in instruction.cases]
        before = asm.encode(block)[0]
        for instruction in block:
            if instruction.op == 0x2c and instruction.args[0] in RELOCATION:
                instruction.args[0] = RELOCATION[instruction.args[0]]
        after = asm.encode(block)[0]
        assert len(before) == len(after)
        additions.append((at - inserted, block, policy))
        blocks.append({'source_instruction_start': at, 'instruction_count': count,
                       'p13_instruction_start': at - inserted, 'incoming': policy,
                       'source_sha256': sha(before), 'relocated_sha256': sha(after),
                       'byte_count': len(before)})
        inserted += count
    code, exceptions, final_operations, placed = asm.splice_many(original, additions)
    assert [list(row) for row in placed] == recovery
    assert exceptions == source[6]
    assert asm.unsplice_many(code, placed) == original[5]
    assert len(code) == len(source[5])
    assert len(final_operations) == len(operations)
    _, offsets = asm.encode(operations)
    reverse = copy.deepcopy(final_operations)
    differences = []
    for index, (before, after) in enumerate(zip(operations, final_operations)):
        if signature(before) == signature(after):
            continue
        assert before.op == after.op == 0x2c
        assert before.args[0] in RELOCATION
        assert after.args == [RELOCATION[before.args[0]]]
        assert before.target == after.target and before.cases == after.cases
        assert before.default == after.default
        assert any(at <= index < at + count for at, count, _ in recovery)
        assert before.size() == after.size() == 4
        start, end = offsets[index], offsets[index] + before.size()
        old_bytes, new_bytes = source[5][start:end], code[start:end]
        assert sum(a != b for a, b in zip(old_bytes, new_bytes)) == 1
        reverse[index].args[0] = before.args[0]
        differences.append({'instruction_index': index, 'code_byte_offset': start,
                            'opcode': 'pushstring', 'old_index': before.args[0],
                            'new_index': after.args[0], 'before_hex': old_bytes.hex(),
                            'after_hex': new_bytes.hex(), 'changed_bytes': 1})
    assert len(differences) == EXPECTED_COUNTS[label]
    assert sum(a != b for a, b in zip(source[5], code)) == len(differences)
    assert asm.encode(reverse)[0] == source[5]
    for block in blocks:
        block['reverse_relocation_equals_p0b'] = True
    return code, exceptions, {
        'insertions': recovery, 'blocks': blocks, 'operand_differences': differences,
        'reverse_relocation_full_code_equals_p0b': True,
        'unsplice_recovers_p13_code': True,
        'branch_structure_and_operand_widths_unchanged': True,
    }
