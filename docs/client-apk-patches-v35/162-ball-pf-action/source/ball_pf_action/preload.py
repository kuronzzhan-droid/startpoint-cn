"""Scan canonical N5/N6 CAS keys through every party's native preload entry."""
from dual_pf.common import HEAD, MEMBER, TYPE, field
from dual_pf_preload.code import ASSETS, MAP, class_q, runtime_q
from .select import PREFIX

FLIP_PREFIX = 'wfx_summon_flip_pf_'


def scan(e, resolver_q):
    # builder=1, assets=2, CAS map=3, keys=4, i=5, key=6, id=7, row=8, action=9.
    q, x = e.q, runtime_q(e)
    assert len(PREFIX) == len(FLIP_PREFIX)
    return HEAD + [
        *field(0, 'logicAssets', q), ('setlocal_2',),
        ('getlocal_2',), ('getlex', class_q(e, 'CustomAbilityStringTable')),
        ('callproperty', q(ASSETS + 'getMasterTableMaybe'), 1), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'DONE'),
        ('getlocal_3',), ('callproperty', q('get_data'), 0), ('setlocal_3',),
        ('getlocal_3',), ('callproperty', q(MAP + 'keys'), 0), ('setlocal', 4),
        ('pushbyte', 0), ('setlocal', 5),
        ('label', 'LOOP'), ('avm_label',),
        ('getlocal', 5), *field(4, 'length', q), ('ifge', 'DONE'),
        ('getlocal', 4), ('getlocal', 5), ('getproperty', x), ('setlocal', 6),
        ('inclocal_i', 5), ('getlocal', 6), ('iffalse', 'LOOP'),
        ('getlocal', 6), ('pushbyte', 0), e.number(len(PREFIX)),
        ('callproperty', q('http://adobe.com/AS3/2006/builtin::substr'), 2), e.string(PREFIX), ('ifstricteq', 'ID'),
        ('getlocal', 6), ('pushbyte', 0), e.number(len(FLIP_PREFIX)),
        ('callproperty', q('http://adobe.com/AS3/2006/builtin::substr'), 2), e.string(FLIP_PREFIX), ('ifstrictne', 'LOOP'),
        ('getlocal_3',), ('getlocal', 6), ('callproperty', q(MAP + 'getMaybe'), 1),
        ('setlocal', 8), ('getlocal', 8), ('iffalse', 'LOOP'),
        ('getlex', class_q(e, 'BallImpl')), *field(8, 'string', q),
        ('callproperty', q('wfxSummonFlipInterval'), 1), ('pushbyte', 0), ('iflt', 'LOOP'),
        ('label', 'ID'), ('getlocal', 6), e.number(len(PREFIX)),
        ('callproperty', q('http://adobe.com/AS3/2006/builtin::substr'), 1), ('setlocal', 7),
        ('getlocal', 7), ('convert_i',), ('setlocal', 8),
        ('getlocal', 8), ('pushbyte', 0), ('ifle', 'LOOP'),
        ('getlocal', 8), ('convert_s',), ('getlocal', 7), ('ifstrictne', 'LOOP'),
        ('getlocal', 8), ('setlocal', 7),
        ('getlocal_2',), ('getlex', class_q(e, 'MultiballTable')),
        ('callproperty', q(ASSETS + 'getMasterTableMaybe'), 1), ('setlocal', 8),
        ('getlocal', 8), ('iffalse', 'LOOP'),
        ('getlocal', 8), ('callproperty', q('get_data'), 0), ('getlocal', 7),
        ('callproperty', q(MAP + 'getMaybe'), 1), ('setlocal', 8),
        ('getlocal', 8), ('iffalse', 'LOOP'),
        ('getlex', q(MEMBER)), ('getlocal', 7), ('getlocal_2',),
        ('callproperty', resolver_q, 2), ('setlocal', 9),
        ('getlocal', 9), ('iftrue', 'ADD'),
        *field(8, 'speciality_type', q), ('setlocal', 9),
        ('getlocal', 9), ('pushbyte', 0), ('iflt', 'LOOP'),
        ('getlocal', 9), ('pushbyte', 4), ('ifgt', 'LOOP'),
        ('getlex', q(TYPE)), ('getlocal', 9),
        ('callproperty', q('getPowerFlipActionId'), 1), ('setlocal', 9),
        ('label', 'ADD'), ('getlocal_0',), ('getlocal', 9),
        *field(8, 'element', q), ('getlocal_1',),
        ('callpropvoid', q('wfxDualPreloadPaths'), 3), ('jump', 'LOOP'),
        ('label', 'DONE'), ('returnvoid',),
    ]
