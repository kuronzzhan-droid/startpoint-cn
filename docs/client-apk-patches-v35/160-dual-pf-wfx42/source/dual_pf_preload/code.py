"""Small AVM2 helpers for the existing party resource preloading entry."""
import asm

MAP = 'pinball.master.runtime:MasterMap::'
ASSETS = 'pinball.asset.logic:ILogicAssetContainer::'
BUILDER = 'pinball.asset.logic:IAssetPathCollectionBuilder::'


def class_q(editor, short):
    hits = [row[0] for row in editor.abc.instances
            if editor.abc.mn_name(row[0]).split('::')[-1] == short]
    if len(hits) != 1:
        raise ValueError('ambiguous class: ' + short)
    return hits[0]


def runtime_q(editor):
    hits = {op.args[0] for op in asm.decode(editor.body('BattlePartyLogic/resolvePathCollection')[5])
            if op.name == 'getproperty' and editor.abc.multinames[op.args[0]][0] == 0x1B}
    if len(hits) != 1:
        raise ValueError('ambiguous runtime property namespace')
    return hits.pop()


def pf_paths(editor):
    """(PF id, element, builder) -> append existing nonempty LV1..3 DSL keys."""
    q = editor.q
    code = [('getlocal_0',), ('pushscope',), ('getlocal_1',), ('iffalse', 'DONE'),
            ('getlocal_0',), ('getproperty', q('logicAssets')),
            ('getlex', class_q(editor, 'PowerFlipActionTable')),
            ('callproperty', q(ASSETS + 'getMasterTableMaybe'), 1), ('setlocal', 4),
            ('getlocal', 4), ('iffalse', 'DONE'),
            ('getlocal', 4), ('callproperty', q('get_data'), 0),
            ('getlocal_1',), ('callproperty', q(MAP + 'getMaybe'), 1), ('setlocal', 4),
            ('getlocal', 4), ('iffalse', 'DONE'),
            ('getlex', class_q(editor, 'ElementKind_Impl_')), ('getlocal_2',),
            ('callproperty', q('toColorlessable'), 1), ('convert_s',), ('setlocal', 5)]
    for level in range(1, 4):
        next_label = 'NEXT_' + str(level)
        code.extend([
            ('getlocal', 4), ('getproperty', q('power_flip_action' + str(level))),
            ('setlocal', 6), ('getlocal', 6), ('iffalse', next_label),
            ('getlocal_3',), ('getlocal', 6), editor.string(':'), ('add',),
            ('getlocal', 5), ('add',), ('pushnull',),
            ('callpropvoid', q(BUILDER + 'addActionDsl'), 2), ('label', next_label)])
    return code + [('label', 'DONE'), ('returnvoid',)]


def party_members(editor, path_method):
    """(builder) -> actual main-character type PFs, including nonleaders."""
    q, dyn = editor.q, runtime_q(editor)
    return [
        ('getlocal_0',), ('pushscope',), ('getlocal_0',),
        ('callproperty', q('getUnitedCharacterPeeks'), 0), ('setlocal_2',),
        ('pushbyte', 0), ('setlocal_3',), ('label', 'LOOP'), ('avm_label',),
        ('getlocal_3',), ('getlocal_2',), ('getproperty', q('length')), ('ifge', 'DONE'),
        ('getlocal_2',), ('getlocal_3',), ('getproperty', dyn), ('setlocal', 4),
        ('inclocal_i', 3), ('getlocal', 4), ('iffalse', 'LOOP'),
        ('getlocal', 4), ('getproperty', q('index')), ('pushbyte', 0), ('ifne', 'LOOP'),
        ('getlocal', 4), ('getproperty', q('params')), ('pushbyte', 0),
        ('getproperty', dyn), ('setlocal', 4), ('getlocal', 4), ('iffalse', 'LOOP'),
        ('getlocal_0',), ('getlocal', 4), ('getproperty', q('powerFlipActionId')),
        ('getlocal', 4), ('callproperty', q('get_element'), 0), ('getlocal_1',),
        ('callpropvoid', path_method, 3), ('jump', 'LOOP'),
        ('label', 'DONE'), ('returnvoid',),
    ]


def scan(editor, path_method, members_method):
    """(builder) -> valid wfx42 target ball PFs and current party PFs."""
    q, dyn = editor.q, runtime_q(editor)
    return [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_0',), ('getproperty', q('logicAssets')), ('setlocal_2',),
        ('getlocal_2',), ('getlex', class_q(editor, 'UniqueConditionTable')),
        ('callproperty', q(ASSETS + 'getMasterTableMaybe'), 1), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'DONE'),
        ('getlocal_3',), ('callproperty', q('get_data'), 0),
        ('callproperty', q(MAP + 'keys'), 0), ('setlocal_3',),
        ('pushbyte', 0), ('setlocal', 4), ('pushfalse',), ('setlocal', 5),
        ('label', 'LOOP'), ('avm_label',), ('getlocal', 4), ('getlocal_3',),
        ('getproperty', q('length')), ('ifge', 'MEMBERS'),
        ('getlex', class_q(editor, 'ConditionSlot')), ('getlocal_3',),
        ('getlocal', 4), ('getproperty', dyn), ('convert_i',), ('getlocal_2',),
        ('callproperty', q('wfxSpec'), 2), ('setlocal', 6), ('inclocal_i', 4),
        ('getlocal', 6), ('iffalse', 'LOOP'),
        ('getlocal', 6), ('pushbyte', 0), ('getproperty', dyn),
        ('pushbyte', 42), ('ifne', 'LOOP'),
        ('getlocal', 6), ('pushbyte', 1), ('getproperty', dyn),
        ('pushbyte', 1), ('iflt', 'LOOP'),
        ('getlocal', 6), ('pushbyte', 1), ('getproperty', dyn),
        ('pushbyte', 3), ('ifgt', 'LOOP'),
        ('getlocal', 6), ('pushbyte', 2), ('getproperty', dyn), ('setlocal', 6),
        ('getlocal', 6), ('pushbyte', 0), ('ifle', 'LOOP'),
        ('pushtrue',), ('setlocal', 5),
        ('getlocal_2',), ('getlex', class_q(editor, 'MultiballTable')),
        ('callproperty', q(ASSETS + 'getMasterTableMaybe'), 1), ('setlocal', 7),
        ('getlocal', 7), ('iffalse', 'LOOP'),
        ('getlocal', 7), ('callproperty', q('get_data'), 0),
        ('getlocal', 6), ('callproperty', q(MAP + 'getMaybe'), 1), ('setlocal', 7),
        ('getlocal', 7), ('iffalse', 'LOOP'),
        ('getlocal', 7), ('getproperty', q('speciality_type')), ('setlocal', 8),
        ('getlocal', 8), ('pushbyte', 0), ('iflt', 'LOOP'),
        ('getlocal', 8), ('pushbyte', 4), ('ifgt', 'LOOP'),
        ('getlocal_0',), ('getlex', class_q(editor, 'SpecialityTypeTools')),
        ('getlocal', 8), ('callproperty', q('getPowerFlipActionId'), 1),
        ('getlocal', 7), ('getproperty', q('element')), ('getlocal_1',),
        ('callpropvoid', path_method, 3), ('jump', 'LOOP'),
        ('label', 'MEMBERS'), ('getlocal', 5), ('iffalse', 'DONE'),
        ('getlocal_0',), ('getlocal_1',), ('callpropvoid', members_method, 1),
        ('label', 'DONE'), ('returnvoid',),
    ]
