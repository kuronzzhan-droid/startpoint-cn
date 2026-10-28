"""Append visual cutin assets to the native summoned active-skill branch.

The leading logic cache already resolves c9 before the visual resolver runs.
Keep that complete layer byte-identical and lock it as a tested dependency.
"""
import hashlib

import asm


RESOLVER = 'ActionDslAssetResolver/addAnimationLayoutForSummonedMultiball'
LEADING = 'ActionDslHandler/resolveActionDsl'
TARGETS = [RESOLVER]
DEPENDENCIES = {
    RESOLVER: ('e87c936f6d212008808b0c096299527715a383e36eb70ae8716b85a06a230bef',
               [8, 15, 1, 2]),
    LEADING: ('f9cd8fcea730f7284782e26b0d5482b7d6062f5d3914bc60e593891b2df19e29',
              [8, 20, 1, 2]),
}
ASSIST = 'battle/common/layer1/cutin_action_skill_assist_character_single'
SINGLE_ME = 'battle/common/layer1/cutin_action_skill_me_single'
SINGLE_OTHER = 'battle/common/layer1/cutin_action_skill_other_single'
BUILDER = 'pinball.asset.logic:IAssetPathCollectionBuilder::'


def _cutin_code(editor):
    q = editor.q
    # Local 3 is the current MultiballValues; local 6 is its Some(action).
    # The branch is already guarded by action.index == 0 (c9 present).
    code = [
        ('getlocal_0',), ('getproperty', q('withoutView')), ('iftrue', 'DONE'),
        ('getlocal', 6), ('getproperty', q('path')), editor.string(''),
        ('ifeq', 'DONE'),
        # Native remote Single and Assist views read the 064 skill-name bucket.
        # The original resolver only prepares 100 for the local view.
        ('getlocal_0',), ('getproperty', q('paths')),
        ('getlex', q('pinball.asset.view::BattleDynamicTextureKind')),
        ('getlocal', 6), ('getproperty', q('name')),
        editor.string('064'), ('pushdouble', editor.abc.doubles.index(0.64)),
        ('callproperty', q('ActionSkillName'), 3),
        ('getlocal_0',), ('getproperty', q('logicAssets')),
        ('callpropvoid', q(BUILDER + 'addDynamicTexture'), 2),
        ('getlocal_0',), ('getproperty', q('paths')),
        editor.string('character/'), ('getlocal_3',),
        ('getproperty', q('image_prefix')), ('add',),
        editor.string('/ui/skill_cutin_0'), ('add',),
        editor.string('100'), editor.number(1),
        ('getlex', q('starling.textures::TextureSmoothing')),
        ('getproperty', q('BILINEAR')),
        ('callpropvoid', q(BUILDER + 'addCharacter'), 4),
        ('getlocal_3',), ('getproperty', q('assist_character')),
        ('iffalse', 'SINGLE'),
        ('getlocal_0',), editor.string(ASSIST),
        ('callpropvoid', q('addAnimationLayout'), 1),
        ('jump', 'DONE'), ('label', 'SINGLE'),
    ]
    for path in (SINGLE_ME, SINGLE_OTHER):
        code.extend([('getlocal_0',), editor.string(path),
                     ('callpropvoid', q('addAnimationLayout'), 1)])
    return code + [('label', 'DONE')]


def build(editor):
    for label, (expected, header) in DEPENDENCIES.items():
        body = editor.body(label)
        if hashlib.sha256(body[5]).hexdigest() != expected or body[1:5] != header:
            raise asm.AsmError('summon cutin dependency differs from p11: ' + label)
    body = editor.body(RESOLVER)
    ops = asm.decode(body[5])
    anchors = [i for i, op in enumerate(ops)
               if op.name == 'callpropvoid'
               and editor.abc.mn_name(op.args[0]) == BUILDER + 'addDynamicTexture']
    if len(anchors) != 1 or anchors[0] != 88 or body[6]:
        raise asm.AsmError('unknown summoned action visual asset branch')
    at = anchors[0] + 1
    editor.insert(RESOLVER, at, _cutin_code(editor), incoming=asm.FORBID)
    return {
        'capability': 'client.summon.cutin_preload@1',
        'visual_method': RESOLVER,
        'original_insertion_index': at,
        'character_path': 'character/<multiball.c1>/ui/skill_cutin_0',
        'character_options': {'bucket': '100', 'scale': 1, 'smoothing': 'bilinear'},
        'conditions': 'action Some, nonempty action.path, and withoutView == false',
        'assist_true_layouts': [ASSIST],
        'assist_false_layouts': [SINGLE_ME, SINGLE_OTHER],
        'remote_skill_name_texture': {'bucket': '064', 'scale': 0.64,
                                      'name': 'multiball.c9.name',
                                      'layouts': ['Single other-player', 'Assist other-player']},
        'leading_logic': {'method': LEADING, 'status': 'native_complete_preserved',
                          'sha256': DEPENDENCIES[LEADING][0],
                          'behavior': 'c9 Some -> addActionDsl(path + colon + element)'},
        'new_classes': 0, 'new_helpers': 0,
    }
