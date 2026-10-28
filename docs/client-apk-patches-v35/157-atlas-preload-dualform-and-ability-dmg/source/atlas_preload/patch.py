"""Restrict special atlases to dual forms and preload the common ability effect."""
import asm

from .arrays import animation_array, require_unconditional
from .inline import DEPENDENCIES, PARSER, parser_block


CHARACTER = 'BattleCharacterLogic/resolvePathCollection'
COMMON = 'BattleAssetPathCollectionBuilder/addCommonAssets'
TARGETS = [CHARACTER, COMMON]
TOTAL = 'battle/common/layer1/total_ability_damage_effect'


def _one(values, description):
    if len(values) != 1:
        raise asm.AsmError(f'expected one {description}, got {values}')
    return values[0]


def _special(editor):
    body = editor.body(CHARACTER)
    ops = asm.decode(body[5])
    special = _one([i for i, op in enumerate(ops)
                    if op.name == 'callproperty'
                    and editor.abc.mn_name(op.args[0]) == 'getSpecialPixelArtAnimationPath'],
                   'special atlas call')
    at = special - 3
    guard = ops[at - 4:at]
    expected = ['findpropstrict', 'callproperty', 'pushbyte', 'ifnge']
    if ([op.name for op in guard] != expected
            or editor.abc.mn_name(guard[0].args[0]) != 'get_rarity'
            or editor.abc.mn_name(guard[1].args[0]) != 'get_rarity'
            or guard[1].args[1:] != [0] or guard[2].args != [4]
            or guard[3].target != special + 2
            or [op.name for op in ops[at:special + 2]] !=
            ['getscopeobject', 'getslot', 'findpropstrict', 'callproperty', 'callpropvoid']):
        raise asm.AsmError('unknown or already patched special atlas guard')
    first_local = body[2]
    block = parser_block(editor, first_local)
    # An out-of-block branch is bound only after splice rebases the old targets.
    block.append(asm.Instruction(asm.MNEMONICS['iffalse'], target=len(block) + 1))
    _, exceptions, merged = asm.splice(body, at, block, incoming=asm.FORBID)
    merged[at + len(block) - 1].target = special + 2 + len(block)
    raw, _ = asm.encode(merged)
    if asm.unsplice(raw, at, len(block)) != body[5]:
        raise asm.AsmError('special guard insertion is not reversible')
    editor.replace(CHARACTER, raw, exceptions)
    return {'status': 'added', 'condition': 'rarity >= 4 AND wfxDualFormUid(get_characterTags()) != 0',
            'parser': PARSER, 'implementation': 'exact parser body inlined; receiver scope omitted',
            'original_insertion_index': at, 'inserted_instructions': len(block),
            'fresh_locals': list(range(first_local, first_local + 5)),
            'dependencies': {label: {'sha256': value[0], 'header': value[1]}
                             for label, value in DEPENDENCIES.items()}}


def _common(editor):
    body = editor.body(COMMON)
    ops = asm.decode(body[5])
    if body[6]:
        raise asm.AsmError('unexpected common-assets exception handlers')
    existing = [i for i, op in enumerate(ops)
                if op.name == 'pushstring' and editor.abc.s(op.args[0]) == TOTAL]
    if existing:
        anchor = _one(existing, 'existing total ability effect')
        entry, _, paths = animation_array(editor.abc, ops, anchor)
        require_unconditional(ops, entry)
        return {'status': 'already_exists', 'message': '已存在', 'path': TOTAL,
                'array_size': len(paths), 'unconditional': True}
    # Locate the unconditional damage array by its two existing total effects.
    anchor = _one([i for i, op in enumerate(ops) if op.name == 'pushstring'
                   and editor.abc.s(op.args[0]) == 'battle/common/layer1/total_skill_damage_effect'],
                  'common damage array anchor')
    entry, end, paths = animation_array(editor.abc, ops, anchor)
    require_unconditional(ops, entry)
    if 'battle/common/layer1/total_powerflip_damage_effect' not in paths:
        raise asm.AsmError('unknown common damage array structure')
    block = asm.assemble([editor.string(TOTAL)])
    _, exceptions, merged = asm.splice(body, end, block, incoming=asm.FORBID)
    merged[end + 1].args = [len(paths) + 1]
    raw, _ = asm.encode(merged)
    # Undo both intentional edits and require exact recovery of the old method.
    merged[end + 1].args = [len(paths)]
    if asm.unsplice(asm.encode(merged)[0], end, 1) != body[5]:
        raise asm.AsmError('common array insertion is not reversible')
    editor.replace(COMMON, raw, exceptions)
    return {'status': 'added', 'path': TOTAL, 'original_array_index': end,
            'array_size_before': len(paths), 'array_size_after': len(paths) + 1,
            'unconditional': True}


def build(editor):
    return {'capability': 'atlas-preload-dual-form-and-global-ability-v1',
            'special': _special(editor), 'global_ability_effect': _common(editor),
            'new_classes': 0, 'new_helpers': 0}
