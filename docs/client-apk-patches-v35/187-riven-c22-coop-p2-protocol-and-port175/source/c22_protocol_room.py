"""Mates prepare, Log ACK and Start admission in existing room methods."""
from c2_common import prefix, set_
from c22_catalog import CATALOG_ID
from c22_protocol_common import num, gp, call, identifier, show, clear
from c22_protocol_validate import validate

NOTIFY = 'pinball.online.meeting.message::MeetingNotifyMessage'
SYNC_FAILED = '裂罅快照同步失败，请重新准备。'


def assets(e):
    return [('getlocal_0',), *gp(e, 'globalLogic'), *call(e, 'getLogicAssets', 0)]


def cache(e, key, loc):
    value = []
    for name in ('snapshot', 'canonical', 'rows', 'reason'):
        value += [e.string(name), ('getlocal', loc[name])]
    return [('getlocal_0',), *gp(e, 'continuationData'),
            *set_(e, key, [*value, ('newobject', 4)])]


def log(e, text):
    return [('getlocal_0',), *gp(e, 'cooperationRoomSocketContact'),
            ('getlex', e.q(NOTIFY)), *text, *call(e, 'Log', 1), *call(e, 'notify', 1, True)]


def reject(e, loc, tag, start=False):
    invalid, send = tag + '_invalid_token', tag + '_send_nack'
    code = [*identifier(e, loc['snapshot'], invalid), ('jump', send),
            ('label', invalid), e.string('invalid'), ('setlocal', loc['snapshot']),
            ('label', send), *log(e, [e.string('WFR2|N|'), ('getlocal', loc['snapshot']),
                ('add',), e.string('|invalid_snapshot'), ('add',)]),
            *clear(e, 'wfr2_pending'), *show(e, SYNC_FAILED)]
    if start:
        code += [*clear(e, 'wfr2_committed'), ('getlocal_0',),
                 *gp(e, 'cooperationRoomSocketContact'), *call(e, 'disconnect', 0, True)]
    return [*code, ('returnvoid',)]


def mates(e, first):
    fail, original = 'c22_mates_fail', 'c22_mates_original'
    code, loc = validate(e, 1, first, fail, 'c22_mates', CATALOG_ID, assets(e))
    pending = loc['next_local']
    code += [('getlocal', loc['has_context']), ('iffalse', original),
             ('getlocal_0',), *gp(e, 'continuationData'), *gp(e, 'wfr2_committed'),
             ('setlocal', pending), ('getlocal', pending), ('iffalse', 'c22_mates_pending')]
    for name in ('snapshot', 'canonical', 'reason'):
        code += [('getlocal', pending), *gp(e, name), ('getlocal', loc[name]),
                 ('ifne', 'c22_mates_committed_fail')]
    code += [*log(e, [e.string('WFR2|A|'), ('getlocal', loc['snapshot']), ('add',),
                     e.string('|'), ('add',), ('getlocal', loc['canonical']), ('add',)]),
             ('returnvoid',), ('label', 'c22_mates_pending'),
             ('getlocal_0',), *gp(e, 'continuationData'), *gp(e, 'wfr2_pending'),
             ('setlocal', pending), ('getlocal', pending), ('iffalse', 'c22_mates_save'),
             ('getlocal', pending), *gp(e, 'snapshot'), ('getlocal', loc['snapshot']),
             ('ifne', 'c22_mates_save')]
    for name in ('canonical', 'reason'):
        code += [('getlocal', pending), *gp(e, name), ('getlocal', loc[name]), ('ifne', fail)]
    code += [('label', 'c22_mates_save'),
             *clear(e, 'wfr2_committed'), *cache(e, 'wfr2_pending', loc),
             *log(e, [e.string('WFR2|A|'), ('getlocal', loc['snapshot']), ('add',),
                      e.string('|'), ('add',), ('getlocal', loc['canonical']), ('add',)]),
             ('jump', original), ('label', 'c22_mates_committed_fail'), ('avm_label',),
             *reject(e, loc, 'c22_mates_committed', True),
             ('label', fail), ('getlocal_0',), *gp(e, 'continuationData'),
             *gp(e, 'wfr2_committed'), ('iftrue', 'c22_mates_committed_fail'),
             *reject(e, loc, 'c22_mates'),
             ('label', original)]
    return code


def start(e, first):
    fail, legacy, original = 'c22_start_fail', 'c22_start_legacy', 'c22_start_original'
    code, loc = validate(e, 1, first, fail, 'c22_start', CATALOG_ID, assets(e))
    pending = loc['next_local']
    code += [('getlocal_0',), *gp(e, 'continuationData'), *gp(e, 'wfr2_pending'),
             ('setlocal', pending), ('getlocal', loc['has_context']), ('iffalse', legacy),
             ('getlocal', pending), ('iftrue', 'c22_start_pending'),
             ('getlocal_0',), *gp(e, 'continuationData'), *gp(e, 'wfr2_committed'),
             ('setlocal', pending), ('getlocal', pending), ('iffalse', fail)]
    for name in ('snapshot', 'canonical', 'reason'):
        code += [('getlocal', pending), *gp(e, name), ('getlocal', loc[name]), ('ifne', fail)]
    code += [('returnvoid',), ('label', 'c22_start_pending')]
    for name in ('snapshot', 'canonical', 'reason'):
        code += [('getlocal', pending), *gp(e, name), ('getlocal', loc[name]), ('ifne', fail)]
    code += [*cache(e, 'wfr2_committed', loc), *clear(e, 'wfr2_pending'),
             ('jump', original), ('label', legacy), ('getlocal', pending), ('iftrue', fail),
             ('getlocal_0',), *gp(e, 'continuationData'), *gp(e, 'wfr2_committed'), ('iftrue', fail),
             ('jump', original), ('label', fail), *reject(e, loc, 'c22_start', True),
             ('label', original)]
    return code


def lifecycle(e, first):
    done = 'c22_lifecycle_done'
    code = [('getlocal_0',), *gp(e, 'continuationData'), ('iffalse', done)]
    for key in ('wfr2_pending', 'wfr2_committed', 'wfr2_notice'):
        code += clear(e, key)
    return [*code, ('label', done)]


def apply(e):
    report = {}
    for method, builder in (('serverMessage_Mates', mates), ('serverMessage_Start', start),
                            ('run', lifecycle), ('serverMessage_Disbanded', lifecycle)):
        label = 'MultiBattleRoomScene/' + method
        report[label] = prefix(e, label, builder)
    return report
