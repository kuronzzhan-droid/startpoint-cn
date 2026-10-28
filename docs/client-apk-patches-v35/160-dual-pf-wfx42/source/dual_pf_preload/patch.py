"""Complete N4 resource preload through the existing party action-key pipeline."""
import hashlib

import asm

from . import code

TARGET = 'BattlePartyLogic/resolvePathCollection'
TARGETS = [TARGET]
BASE_SHA = '1560d620443cad58868b5cca0ae64b403f9974be3cb1a196308883040ac8363e'
CLASS = 'pinball.common.data.party::BattlePartyLogic'


def build(editor):
    body = editor.body(TARGET)
    if hashlib.sha256(body[5]).hexdigest() != BASE_SHA or body[1:5] != [6, 10, 1, 2]:
        raise asm.AsmError('N4 preload party entry differs from p11')
    ops = asm.decode(body[5])
    if len(ops) != 72 or ops[-1].name != 'returnvoid' or body[6]:
        raise asm.AsmError('unknown N4 preload party method structure')
    paths = editor.add_method(CLASS, 'wfxDualPreloadPaths', 'void', ['String', 'int', '*'],
                              code.pf_paths(editor), 7)
    members = editor.add_method(CLASS, 'wfxDualPreloadMembers', 'void', ['*'],
                                code.party_members(editor, paths), 5)
    scan = editor.add_method(CLASS, 'wfxDualPreload', 'void', ['*'],
                             code.scan(editor, paths, members), 9)
    editor.insert(TARGET, len(ops) - 1,
                  [('getlocal_0',), ('getlocal_1',), ('callpropvoid', scan, 1)],
                  incoming=asm.ENTER)
    return {'entry': TARGET, 'condition': 'any valid unique_condition wfx:42 row',
            'parser': 'ConditionSlot$/wfxSpec', 'filter': 'code 42, arg 1..3, value > 0',
            'scan_scope': 'unique_condition table; values may be granted by any ability or DSL',
            'holders': 'current party main characters, their own PF id and element',
            'balls': 'configured multiball ids; native speciality-type PF id and row element',
            'levels': [1, 2, 3],
            'missing_dependencies': 'skip absent tables/rows and empty level paths',
            'pipeline': 'builder.addActionDsl -> leading logic cache -> quest ActionDslAssetResolver view pass',
            'no_config': 'no added action keys or image/layout loads',
            'new_helpers': ['wfxDualPreloadPaths', 'wfxDualPreloadMembers', 'wfxDualPreload']}
