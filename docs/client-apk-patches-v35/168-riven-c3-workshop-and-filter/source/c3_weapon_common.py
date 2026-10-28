"""Weapon-list splice helpers; no runtime trait or method is introduced."""
from c1_lookup import number
from c2_common import DYNAMIC, get, set_

ROW_DOMAIN = 0x05000000
TOGGLE = 0x01000000
FILTER = 0x02000000
RIVEN_MIN, RIVEN_MAX = 16000001, 16000200


def mode(e, fail, source=None):
    source = source or [('getlocal_0',), ('getproperty', e.q('filterSetting'))]
    return [*source, *get(e, 'wfxRiven'), ('iffalse', fail)]


def rows(e):
    return [('getlocal_0',), ('getproperty', e.q('player')),
            ('getproperty', e.q('saveData')), *get(e, 'weapon_rivens')]


def refresh(e):
    q = e.q
    return [('getlocal_0',), ('getlocal_0',),
            ('callproperty', q('getFilteredEquipmentList'), 0),
            ('setproperty', q('equipmentIds')), ('getlocal_0',),
            ('callpropvoid', q('rebuildAllThumbnails'), 0)]


def row_guard(e, value, fail):
    return [*value, number(e, ROW_DOMAIN + RIVEN_MIN), ('iflt', fail),
            *value, number(e, ROW_DOMAIN + RIVEN_MAX), ('ifgt', fail)]


def safe_buttons(e, enabled):
    q = e.q
    code = []
    for group, keys in [('buttonGroup', [0x03000000, 0x04000000]),
                        ('checkBoxButtonGroup', [0, 1])]:
        for key in keys:
            code += [('getlocal_0',), ('getproperty', q(group)), number(e, key),
                     ('callproperty', q('get'), 1), *enabled,
                     ('setproperty', q('visible'))]
    return code


def text(e, node, value):
    return [('getlocal_0',), ('getproperty', e.q('layout')), e.string(node),
            ('pushnull',), ('callproperty', e.q('getText'), 2), *value,
            ('callpropvoid', e.q('set_text'), 1)]
