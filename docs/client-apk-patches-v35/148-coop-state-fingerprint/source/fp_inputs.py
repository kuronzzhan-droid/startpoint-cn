"""Actual-consumption input capture and route/Speed hooks; no simulation writes."""
import asm
from fp_input_copy import BATTLE, build as build_copy

TARGETS = ['BattleScenePlayingStateImpl/socketInput_broadcastMessage',
           'BattleDerailleur/addSocketCommand', 'BattleDerailleur/_addSocketCommand',
           'BattleDerailleur/proceed']


def capture(e):
    q, s, n = e.q, e.string, e.number
    rt = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1B)
    x = e.newq
    # b1, List2, state3, inputRows4, unsupported5, node6, command7,
    # ordinal8, sourceId9, sourceFrame10, kind11, content12, sourceEpoch13, lookup14.
    code = [('getlocal_0',), ('pushscope',), ('getlex', q(BATTLE)),
            ('getproperty', x('wfxFpEnabled')), ('iffalse', 'DISABLED'),
            ('getlex', q(BATTLE)), ('getproperty', x('wfxFpBattles')), ('dup',),
            ('iftrue', 'MAP'), ('pop',), ('jump', 'OFF'), ('label', 'MAP'),
            ('getlocal_1',), ('callproperty', q('get'), 1), ('setlocal_3',),
            ('getlocal_3',), ('iffalse', 'OFF'), ('newarray', 0), ('setlocal', 4),
            ('newarray', 0), ('setlocal', 5), ('getlocal_2',), ('getproperty', q('h')),
            ('setlocal', 6), n(0), ('setlocal', 8), ('label', 'LOOP'), ('avm_label',),
            ('getlocal', 6), ('iffalse', 'DONE'), ('getlocal', 6), ('getproperty', q('item')),
            ('setlocal', 7), ('getlocal', 6), ('getproperty', q('next')), ('setlocal', 6),
            ('getlocal_1',), ('getproperty', q('initialData')), ('getproperty', q('id')),
            ('setlocal', 9), ('pushnull',), ('setlocal', 10),
            ('getlocal_3',), ('getproperty', x('battleEpoch')), ('setlocal', 13),
            s('User'), ('setlocal', 11),
            ('getlocal', 7), ('getproperty', q('index')), n(1), ('ifeq', 'COOP'),
            ('getlocal', 7), ('getproperty', q('index')), n(0), ('ifne', 'UNKNOWN'),
            s('pinball.online::BattleUserCommand'), ('setlocal', 12), ('jump', 'CONTENT'),
            ('label', 'COOP'), s('Coop'), ('setlocal', 11),
            ('getlocal', 7), ('getproperty', q('params')), n(1), ('getproperty', rt),
            ('setlocal', 9), ('getlocal', 7), ('getproperty', q('params')), n(2),
            ('getproperty', rt), ('setlocal', 10), ('pushnull',), ('setlocal', 13),
            ('getlocal_3',), ('getproperty', x('ctx')), ('getproperty', x('byId')),
            ('getlocal', 9), ('getproperty', rt), ('setlocal', 14),
            # Queued Coop stores source ID/frame, not the source object. After a
            # same-ID rebuild its old epoch is unknowable; never claim the new one.
            ('getlocal', 14), ('iffalse', 'NOEPOCH'), ('getlocal', 14),
            ('getproperty', x('battleEpoch')), n(0), ('ifne', 'NOEPOCH'),
            n(0), ('setlocal', 13), ('label', 'NOEPOCH'),
            s('pinball.online::BattleCoopCommand'), ('setlocal', 12), ('label', 'CONTENT'),
            ('getlex', q(BATTLE)), ('getlocal', 7), ('getproperty', q('params')), n(0),
            ('getproperty', rt), ('getlocal', 12), ('getlocal', 5), s('/inputs/'),
            ('getlocal', 8), ('add',), s('/command'), ('add',),
            ('callproperty', x('wfxFpCommand'), 4), ('setlocal', 12), ('jump', 'APPEND'),
            ('label', 'UNKNOWN'), ('getlex', q(BATTLE)), ('getlocal', 5),
            s('/inputs/'), ('getlocal', 8), ('add',), s('/command'), ('add',),
            ('callproperty', x('wfxFpInputUnsupported'), 2), ('setlocal', 12),
            ('label', 'APPEND'), ('getlocal', 4),
            s('ordinal'), ('getlocal', 8), s('kind'), ('getlocal', 11),
            s('sourceBattleId'), ('getlocal', 9), s('sourceBattleEpoch'), ('getlocal', 13),
            s('sourceFrame'), ('getlocal', 10), s('targetBattleId'), ('getlocal_1',),
            ('getproperty', q('initialData')), ('getproperty', q('id')),
            s('battleEpoch'), ('getlocal_3',), ('getproperty', x('battleEpoch')),
            s('applyTargetFrame'), ('getlocal_1',), ('getproperty', q('currentFrame')),
            s('command'), ('getlocal', 12), ('newobject', 9), ('callpropvoid', q('push'), 1),
            ('inclocal_i', 8), ('jump', 'LOOP'), ('label', 'DONE'),
            s('inputs'), ('getlocal', 4), s('unsupported'), ('getlocal', 5),
            ('newobject', 2), ('returnvalue',), ('label', 'DISABLED'),
            ('getlex', q(BATTLE)), ('callpropvoid', x('wfxFpDisabled'), 0),
            ('label', 'OFF'), ('pushnull',), ('returnvalue',)]
    e.add_method(BATTLE, 'wfxFpCaptureInputs', 'Object', [BATTLE, 'haxe.ds::List'], code, 15, static=True)


def event_helper(e):
    q, x, s, n = e.q, e.newq, e.string, e.number
    rt = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1B)
    # scene1,b2,stage3,targetFrame4,sourceId5,sourceFrame6,command7,wire8,reason9;
    # ctx10,state11,detail12,event13,command14,unsupported15,sourceEpoch16,lookup17.
    code = [('getlocal_0',), ('pushscope',), ('getlex', q(BATTLE)),
            ('getproperty', x('wfxFpEnabled')), ('iffalse', 'DISABLED'), ('label', 'TRY'),
            ('getlex', q(BATTLE)), ('getlocal_1',), ('callproperty', x('wfxFpContext'), 1),
            ('setlocal', 10), ('getlocal', 10), ('iffalse', 'DONE'), ('pushnull',),
            ('setlocal', 11), ('getlocal_2',), ('iffalse', 'NOBATTLE'),
            ('getlex', q(BATTLE)), ('getlocal_2',), ('getlocal_1',),
            ('callproperty', x('wfxFpBind'), 2), ('setlocal', 11), ('label', 'NOBATTLE'),
            ('newobject', 0), ('setlocal', 12), ('getlocal', 8), ('pushnull',),
            ('ifeq', 'NOWIRE'), ('getlocal', 12), ('getlocal', 8), ('setproperty', x('wire')),
            ('label', 'NOWIRE'), ('getlocal', 9), ('iffalse', 'NOREASON'),
            ('getlocal', 12), ('getlocal', 9), ('setproperty', x('reason')), ('label', 'NOREASON'),
            ('pushnull',), ('setlocal', 14), ('newarray', 0), ('setlocal', 15),
            ('getlocal', 7), ('iffalse', 'NOCOMMAND'), ('getlex', q(BATTLE)),
            ('getlocal', 7), s('pinball.online.battle.message::BattleSocketCommand'),
            ('getlocal', 15), s('/events/command'), ('callproperty', x('wfxFpCommand'), 4),
            ('setlocal', 14), ('getlocal', 15), ('getproperty', q('length')), n(0),
            ('ifeq', 'SUPPORTED'), ('getlocal', 9), ('iftrue', 'KEEPNATIVE'),
            ('getlocal', 12), s('unsupported_command'), ('setproperty', x('reason')),
            ('label', 'KEEPNATIVE'), ('getlocal', 10), ('dup',),
            ('getproperty', x('generation')), n(1), ('add_i',), ('setproperty', x('generation')),
            ('getlex', q(BATTLE)), ('getlocal', 10), s('sampling_error'),
            ('getlocal', 4), ('getlocal', 4), ('callpropvoid', x('wfxFpGap'), 4),
            ('jump', 'NOCOMMAND'), ('label', 'SUPPORTED'),
            ('getlocal', 7), ('getproperty', q('index')), n(1),
            ('ifne', 'NOCOMMAND')]
    for key, idx in [('targetOtherBattleId', 0), ('speed', 1), ('length', 2)]:
        code += [('getlocal', 12), ('getlocal', 7), ('getproperty', q('params')), n(idx),
                 ('getproperty', rt), ('setproperty', x(key))]
    code += [('label', 'NOCOMMAND'), ('pushnull',), ('setlocal', 16),
             ('getlocal', 5), ('iffalse', 'NOSOURCE'), ('getlocal', 10),
             ('getproperty', x('byId')), ('getlocal', 5), ('getproperty', rt),
             ('setlocal', 17), ('getlocal', 17), ('iffalse', 'NOSOURCE'),
             ('getlocal', 17), ('getproperty', x('battleEpoch')), n(0), ('ifne', 'NOSOURCE'),
             n(0), ('setlocal', 16),
             ('label', 'NOSOURCE'), s('eventId'), ('getlocal', 10), ('getproperty', x('eventId')),
             s('stage'), ('getlocal_3',), s('battleId'), ('pushnull',), s('battleEpoch'),
             ('pushnull',), s('targetFrame'), ('getlocal', 4), s('sourceBattleId'),
             ('getlocal', 5), s('sourceBattleEpoch'), ('getlocal', 16), s('sourceFrame'),
             ('getlocal', 6), s('command'), ('getlocal', 14), s('detail'), ('getlocal', 12),
             ('newobject', 10), ('setlocal', 13), ('getlocal', 11), ('iffalse', 'META'),
             ('getlocal', 13), ('getlocal_2',), ('getproperty', q('initialData')),
             ('getproperty', q('id')), ('setproperty', x('battleId')), ('getlocal', 13),
             ('getlocal', 11), ('getproperty', x('battleEpoch')), ('setproperty', x('battleEpoch')),
             ('label', 'META'), ('getlocal', 10), ('getlocal', 10), ('getproperty', x('eventId')),
             ('setproperty', x('eventCursor')), ('getlocal', 10), ('dup',),
             ('getproperty', x('eventId')), n(1), ('add',), ('setproperty', x('eventId')),
             ('getlex', q(BATTLE)), ('getlocal', 10), s('events'), ('getlocal', 13),
             ('callpropvoid', x('wfxFpQueue'), 3), ('label', 'TRYEND'), ('jump', 'DONE'),
             ('label', 'CATCH'), ('pop',), ('getlocal_0',), ('pushscope',),
             ('getlocal', 10), ('iffalse', 'DONE'), ('getlocal', 10), ('dup',),
             ('getproperty', x('generation')), n(1), ('add_i',), ('setproperty', x('generation')),
             ('getlex', q(BATTLE)), ('getlocal', 10), s('sampling_error'), ('getlocal', 4), ('getlocal', 4),
             ('callpropvoid', x('wfxFpGap'), 4), ('jump', 'DONE'),
             ('label', 'DISABLED'), ('getlex', q(BATTLE)), ('callpropvoid', x('wfxFpDisabled'), 0),
             ('label', 'DONE'), ('returnvoid',)]
    e.add_method(BATTLE, 'wfxFpInputEvent', 'void', ['*', '*', 'String', '*', 'String', '*', '*', 'String', 'String'],
                 code, 18, static=True, exceptions=[('TRY', 'TRYEND', 'CATCH', 0, 0)])


def hooks(e):
    q, x, s, n = e.q, e.newq, e.string, e.number
    def gated(code):
        # Gate before argument evaluation, including reads of original objects.
        return [('getlex', q(BATTLE)), ('getproperty', x('wfxFpEnabled')),
                ('iftrue', 'FPACTIVE'), ('getlex', q(BATTLE)),
                ('callpropvoid', x('wfxFpDisabled'), 0), ('jump', 'FPDONE'),
                ('label', 'FPACTIVE'), *code, ('label', 'FPDONE')]
    def event(stage, frame, command=None, wire=None, reason=None, source=None, scene=None, battle=None):
        return [('getlex', q(BATTLE)), *(scene or [('getlocal_0',), ('getproperty', q('scene'))]),
                *(battle or [('getlocal_0',), ('getproperty', q('battle'))]), s(stage), *frame,
                *(source or [('getlocal_0',), ('getproperty', q('battle')), ('getproperty', q('initialData')), ('getproperty', q('id'))]),
                *frame, *(command or [('pushnull',)]), *(wire or [('pushnull',)]),
                s(reason) if reason else ('pushnull',), ('callpropvoid', x('wfxFpInputEvent'), 9)]
    route, decode, add, proceed = TARGETS
    ins = asm.decode(e.body(route)[5])
    assert ins[130].name == 'callpropvoid' and e.abc.mn_name(ins[130].args[0]) == 'addSocketCommand'
    # New local12 records whether the original route actually matched a derailleur.
    e.insert(route, 31, gated([('pushfalse',), ('setlocal', 12), *event('route_received', [('getlocal', 4)],
        wire=[('getlocal_3',)], source=[('getlocal_1',)], battle=[('pushnull',)])]))
    e.insert(route, 127, [('pushtrue',), ('setlocal', 12)])
    e.insert(route, 136, gated([('getlocal', 12), ('iftrue', 'MATCHED'),
        *event('route_rejected', [('getlocal', 4)], wire=[('getlocal_3',)], reason='unmatched_battle',
               source=[('getlocal_1',)], battle=[('pushnull',)]), ('label', 'MATCHED')]))
    # Parse-failure original catch and successful parse are distinct evidence.
    e.insert(decode, 56, gated(event('route_rejected', [('getlocal_1',)], wire=[('getlocal_2',)], reason='parse_error')))
    e.insert(decode, 57, gated(event('route_decoded', [('getlocal_1',)], command=[('getlocal', 4)], wire=[('getlocal_2',)])))
    e.insert(add, 2, gated([('getlocal_2',), ('getproperty', q('index')), n(1), ('ifne', 'NOTSPEED'),
        *event('speed_received', [('getlocal_1',)], command=[('getlocal_2',)]), ('label', 'NOTSPEED')]))
    e.insert(add, 53, gated(event('route_rejected', [('getlocal_1',)], command=[('getlocal_2',)], reason='older_than_last_command')))
    native = asm.decode(e.body(proceed)[5])
    assert native[1135].name == 'callpropvoid' and e.abc.mn_name(native[1135].args[0]) == 'applySpeedChange'
    # Copy speed/length immediately after the original plain setter, before the
    # following decrement; an uncompleted original apply cannot be called applied.
    # Constructing the diagnostic enum adds no gameplay object or queue mutation.
    e.insert(proceed, 1136, gated(event('speed_applied', [('getlocal', 36)], command=[
        ('getlex', q('pinball.online.battle.message::BattleSocketCommand')), ('getlocal', 11),
        ('getlocal', 7), ('getproperty', q('speed')), ('getlocal', 7), ('getproperty', q('length')),
        ('callproperty', q('Speed'), 3)])))


def build(e):
    report = build_copy(e)
    capture(e)
    event_helper(e)
    hooks(e)
    report['targets'] = TARGETS
    report['capture'] = 'original List only; applyTargetFrame=currentFrame before original command loop'
    report['speed_apply'] = 'BattleDerailleur.proceed original #1136, after applySpeedChange; targetFrame=local36, speed/length=local7'
    return report
