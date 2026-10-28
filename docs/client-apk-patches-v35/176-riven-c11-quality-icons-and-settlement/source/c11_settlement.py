"""C11 response/context propagation and single native settlement dialog."""
import asm
from c2_common import get, queue
from c11_settlement_data import parse_auto, queue_types
from c11_settlement_popup import popup


def queue_settlement(e):
    report = {}
    for label, target, source in (
        ('RealRemoteService/earlySuccessHandler', 28,
         [('getlocal_2',), ('getproperty', e.q('rawData')), *get(e, 'data')]),
        ('BattleQuestFinishRealRemote/successHandler', 70,
         [('getlocal_1',), ('getproperty', e.q('rawData')), *get(e, 'data')]),
        ('BattleQuestFinishLoadingTask/processQuestFinish', 62, [('getlocal_1',)]),
    ):
        body = e.body(label)
        ops = asm.decode(body[5])
        hits = [i for i, op in enumerate(ops) if op.name == 'setlocal' and op.args == [target]
                and ops[i - 1].name == 'coerce_a' and ops[i - 2].name == 'newobject']
        assert len(hits) == 1, (label, hits)
        report[label] = queue(e, label, parse_auto(e, source, [('getlocal', target)],
                              body[2], 'c11_auto_parse'), hits[0] + 1)
    for label in ('QuestResultScene/run', 'QuestResultScene/viewDidChange'):
        body = e.body(label)
        ops = asm.decode(body[5])
        hits = [i - 1 for i, op in enumerate(ops) if op.name == 'getproperty'
                and e.abc.mn_name(op.args[0]) == 'questResultContext'
                and ops[i - 1].name == 'getlocal_0' and ops[i + 1].name == 'setlocal']
        assert len(hits) == 1 and ops[-1].name == 'returnvoid', (label, hits)
        report[label] = queue(e, label, popup(e, body[2]), hits[0])
    return {'methods': report, 'types': queue_types(e),
            'dialog': 'one C9 OkDialog contains both granted cards and auto-dismantled lines',
            'consume': 'clear only current context lists after native openDialog accepts the new dialog',
            'inventory': 'unchanged native item_list Option -> applyCommonResponseItemList absolute overwrite',
            'protocol': 'optional field; integer tuples copied; duplicate equal auto-results intentionally retained'}
