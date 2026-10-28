"""Recognize P2 Update strings before the existing application-store dialog."""
from c2_common import DYNAMIC, prefix, set_
from c22_protocol_common import BUILTIN, num, gp, call, at, identifier, show, clear
from c22_protocol_room import SYNC_FAILED


def update(e, first):
    text, parts, prefix_, snapshot, reason, pending, key = range(first, first + 7)
    g = lambda i: ('getlocal', i)
    p = lambda i: ('setlocal', i)
    original, done, cancel, catalog = ('c22_update_' + x for x in ('original', 'done', 'cancel', 'catalog'))
    code = [('getlocal_1',), *gp(e, 'index'), *num(e, 8), ('ifne', original),
            ('getlocal_1',), *gp(e, 'params'), *num(e, 0), ('getproperty', DYNAMIC), p(text),
            g(text), ('istype', e.q('String')), ('iffalse', original),
            g(text), e.string('|'), *call(e, BUILTIN + 'split', 1), p(parts),
            *at(e, parts, 0), p(prefix_), g(prefix_), e.string('WFR2_DISABLED'),
            ('ifeq', 'c22_update_recognized'), g(prefix_), e.string('WFR2_CANCEL'),
            ('ifne', original), ('label', 'c22_update_recognized'),
            g(parts), *gp(e, 'length'), *num(e, 3), ('ifne', done),
            *at(e, parts, 1), p(snapshot), *identifier(e, snapshot, done),
            *at(e, parts, 2), p(reason), *identifier(e, reason, done),
            g(prefix_), e.string('WFR2_CANCEL'), ('ifeq', cancel),
            g(snapshot), e.string('|'), ('add',), g(reason), ('add',), p(key),
            ('getlocal_0',), *gp(e, 'continuationData'), *gp(e, 'wfr2_notice'),
            g(key), ('ifeq', done), ('getlocal_0',), *gp(e, 'continuationData'),
            *set_(e, 'wfr2_notice', [g(key)]),
            g(reason), e.string('catalog_mismatch'), ('ifeq', catalog),
            g(reason), e.string('catalog'), ('ifeq', catalog),
            *show(e, '房间内有成员版本不支持裂罅，本场裂罅效果已停用'), ('jump', done),
            ('label', catalog), *show(e, '房间内资源版本不一致，本场裂罅效果已停用'),
            ('jump', done), ('label', cancel),
            ('getlocal_0',), *gp(e, 'continuationData'), *gp(e, 'wfr2_pending'), p(pending),
            g(pending), ('iffalse', done), g(pending), *gp(e, 'snapshot'),
            g(snapshot), ('ifne', done), *clear(e, 'wfr2_pending'), *show(e, SYNC_FAILED),
            ('label', done), ('returnvoid',), ('label', original)]
    return code


def apply(e):
    label = 'MultiBattleRoomScene/socketInput_receive'
    return {label: prefix(e, label, update)}
