"""Method-local literal overrides and complete C9 custom-copy location catalog."""
import asm
import bodies
from c2_common import queue
from c10_strings import TEXT, BASE_TEXT

# p13 has exactly this many strings. C1-C9 custom copy was appended after it;
# do not catalog or rewrite identical native literals before this boundary.
CUSTOM_POOL_START = 94303


def occurrences(abc):
    labels = bodies.label_map(abc)
    for body_index, body in enumerate(abc.bodies):
        for index, op in enumerate(asm.decode(body[5])):
            if op.name == 'pushstring':
                value = abc.s(op.args[0])
                if op.args[0] >= CUSTOM_POOL_START and value in BASE_TEXT:
                    yield {'body': body_index, 'method': labels.get(body_index),
                           'instruction': index, 'pool_index': op.args[0],
                           'key': BASE_TEXT[value], 'original': value,
                           'text': TEXT[BASE_TEXT[value]]}


def queue_copy(editor):
    positions = list(occurrences(editor.abc))
    changes = []
    for position in positions:
        if position['original'] == position['text']:
            continue
        assert position['method'], ('unlabelled visible copy', position)
        insertion = queue(editor, position['method'],
                          [('pop',), editor.string(position['text'])],
                          position['instruction'] + 1, asm.SKIP)
        changes.append({**position, 'insertion': insertion})
    assert changes, 'C9 copy baseline not found'
    return {'strings': TEXT, 'locations': positions, 'changes': changes,
            'baseline_pool_policy': 'append only; original pushstring is consumed immediately by pop',
            'ordinary_shared_text': 'unchanged catalog entries are not spliced',
            'data_owned_text': ['武器主表名称及技能描述继续从现有主表读取，不在客户端伪造。']}
