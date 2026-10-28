"""Shared N4/N5 P-code action-key validation and member selection."""
from dual_pf.common import HEAD, MEMBER, PF, field
from dual_pf_preload.code import ASSETS, MAP, class_q

PREFIX = 'wfx_ball_pf_action_'


def resolver(e, builtin_keys):
    # Static (multiball id=1, logicAssets=2) -> validated key, or null.
    q = e.q
    code = HEAD + [
        ('getlocal_1',), ('pushbyte', 0), ('ifle', 'NONE'),
        ('getlocal_2',), ('iffalse', 'NONE'),
        ('getlocal_2',), ('getlex', class_q(e, 'CustomAbilityStringTable')),
        ('callproperty', q(ASSETS + 'getMasterTableMaybe'), 1), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'NONE'),
        ('getlocal_3',), ('callproperty', q('get_data'), 0),
        e.string(PREFIX), ('getlocal_1',), ('convert_s',), ('add',),
        ('callproperty', q(MAP + 'getMaybe'), 1), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'NONE'),
        *field(3, 'string', q), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'NONE'),
    ]
    for key in builtin_keys:
        code += [('getlocal_3',), e.string(key), ('ifstricteq', 'NONE')]
    code += [
        ('getlocal_2',), ('getlex', class_q(e, 'PowerFlipActionTable')),
        ('callproperty', q(ASSETS + 'getMasterTableMaybe'), 1), ('setlocal', 4),
        ('getlocal', 4), ('iffalse', 'NONE'),
        ('getlocal', 4), ('callproperty', q('get_data'), 0), ('getlocal_3',),
        ('callproperty', q(MAP + 'getMaybe'), 1), ('setlocal', 4),
        ('getlocal', 4), ('iffalse', 'NONE'),
    ]
    for level in range(1, 4):
        code += [*field(4, 'power_flip_action' + str(level), q), ('iffalse', 'NONE')]
    return code + [('getlocal_3',), ('returnvalue',),
                   ('label', 'NONE'), ('pushnull',), ('returnvalue',)]


def select_member(e, x, resolver_q):
    # Insert after original pushscope. Original native path and returns remain.
    q = e.q
    return [
        *field(0, 'squad', q), ('getproperty', q('kind')), ('setlocal_1',),
        *field(1, 'index', q), ('pushbyte', 1), ('ifne', 'NATIVE'),
        ('getlex', q(MEMBER)),
        *field(1, 'params', q), ('pushbyte', 0), ('getproperty', x),
        ('getproperty', q('id')), *field(0, 'logicAssets', q),
        ('callproperty', resolver_q, 2), ('setlocal_1',),
        ('getlocal_1',), ('iffalse', 'NATIVE'),
        ('getlex', q(PF)), ('getlocal_1',),
        *field(0, 'source', q), ('getproperty', q('element')),
        *field(0, 'logicAssets', q), ('construct', 3), ('returnvalue',),
        ('label', 'NATIVE'),
    ]
