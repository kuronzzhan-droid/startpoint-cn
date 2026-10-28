"""Inline confirmation/selection presentation with original EX fallthrough."""
import asm
from c1_lookup import number
from c2_common import context, get, prefix, queue, MODE
from c2_presentation import global_logic, title, container, text, thumbnail


def confirm_values(e, first):
    ctx, item = first, first + 1
    g = lambda n: ('getlocal', n)
    code = context(e, ctx, 'confirm_original')
    code += [*global_logic(e), number(e, 2370099), ('callproperty', e.q('getItem'), 1),
             ('setlocal', item), e.string('mode'), e.string(MODE)]
    for key, value in [
        ('itemThumbnail', [g(item), ('callproperty', e.q('get_thumbnailId'), 0)]),
        ('itemRarity', [g(item), ('callproperty', e.q('get_rarity'), 0)]),
        ('itemName', [e.string('深渊币')]),
        ('itemNum', [*global_logic(e), ('callproperty', e.q('get_player'), 0), number(e, 2370099),
                     ('callproperty', e.q('getItemNumber'), 1)]),
        ('itemCostNum', [g(ctx), *get(e, 'record'), *get(e, 'next_cost'), ('convert_i',)]),
        ('exAbilityMinNum', [('pushbyte', 1)]),
        ('exAbilityMaxNum', [('pushbyte', 4)]),
        ('roll_count', [g(ctx), *get(e, 'record'), *get(e, 'roll_count'), ('convert_i',)]),
    ]:
        code += [e.string(key), *value]
    return code + [('newobject', 9), ('returnvalue',), ('label', 'confirm_original')]


def check_values_mode(e, fail):
    return [('getlocal_0',), ('getproperty', e.q('values')), *get(e, 'mode'),
            e.string(MODE), ('ifne', fail)]


def confirm_view(e, first):
    code = check_values_mode(e, 'confirm_view_original')
    code += text(e, 1, ('content',), 'dialog_title', [e.string('重抽裂罅')])
    code += text(e, 1, ('content',), 'description', [
        e.string('消耗 '), ('getlocal_0',), ('getproperty', e.q('values')),
        *get(e, 'itemCostNum'), ('add',), e.string(' 深渊币重抽。抽取后可保留新的或原来的词条。'), ('add',)])
    code += text(e, 1, ('content',), 'label_ex_status', [e.string('已重抽次数')])
    code += text(e, 1, ('content',), 'value_ex_status', [
        ('getlocal_0',), ('getproperty', e.q('values')), *get(e, 'roll_count'),
        ('convert_s',), e.string(' 次'), ('add',)])
    code += text(e, 1, ('content',), 'label_ex_ability', [e.string('词条数量')])
    code += text(e, 1, ('content',), 'value_ex_ability', [e.string('1～4 条')])
    code += text(e, 1, ('content',), 'label_item', [e.string('深渊币余额')])
    code += text(e, 1, ('content',), 'notice', [e.string('每次重抽仅扣费一次，保留原词条不会返还费用。')])
    return code + [('label', 'confirm_view_original')]


def custom_button(e, ctx, text_, positive, mode_check):
    # The original freshly constructed ButtonConfig is already on the stack.
    fail = 'button_' + str(ctx) + '_' + ('positive' if positive else 'negative')
    code = mode_check(fail)
    return code + [('pop',), ('getlex', e.q('pinball.ui.component.button.config::ButtonConfigs')),
                   e.string(text_), ('callproperty', e.q('positiveWithCustomString' if positive
                                                       else 'negativeWithCustomString'), 1),
                   ('label', fail)]


def select_name(e, first):
    return context(e, first, 'select_name_original') + title(e, first) + [
        ('returnvalue',), ('label', 'select_name_original')]


def select_run(e, first):
    code = context(e, first, 'select_run_original')
    code += [('getlocal_0',), ('pushtrue',), ('setproperty', e.q('isChecked'))]
    for ident in (0, 1):
        code += [('getlocal_0',), ('getproperty', e.q('buttonGroup')), ('pushbyte', ident),
                 ('pushtrue',), ('callpropvoid', e.q('setVisualEnabled'), 2)]
    return code + [('returnvoid',), ('label', 'select_run_original')]


def select_view(e, first):
    ctx = first
    gp = lambda n: ('getproperty', e.q(n))
    code = context(e, ctx, 'select_view_original')
    code += text(e, 1, ('content',), 'dialog_title', [e.string('选择保留的裂罅词条')])
    code += text(e, 1, ('content', 'now_detail'), 'header', [e.string('原来的词条')])
    code += text(e, 1, ('content', 'new_detail'), 'header', [e.string('新的词条')])
    code += text(e, 1, ('content',), 'notice', [e.string('左侧为原词条，右侧为新词条。请选择保留哪一组。')])
    code += [*container(e, 1, 'content', 'check_box'), ('pushfalse',), ('setproperty', e.q('visible')),
             ('getlocal_0',), gp('exBoostPixelArtCharacterView'), gp('layer'),
             ('pushfalse',), ('setproperty', e.q('visible'))]
    code += thumbnail(e, ctx, container(e, 1, 'content', 'character_detail'), first + 1,
                      x=[('getlocal_0',), gp('exBoostPixelArtCharacterView'), ('callproperty', e.q('get_x'), 0)],
                      y=[('getlocal_0',), gp('exBoostPixelArtCharacterView'),
                         ('callproperty', e.q('get_y'), 0), number(e, 100), ('subtract',)])
    return code + [('label', 'select_view_original')]


def queue_dialog_splices(e):
    report = {}
    for label, builder in [
        ('ExBoostDrawConfirmDialog/getValuesForView', confirm_values),
        ('ExBoostSelectDialog/getExBoostCharacterName', select_name),
        ('ExBoostSelectDialog/run', select_run),
    ]:
        report[label] = prefix(e, label, builder)
    for label, builder in [('ExBoostDrawConfirmDialogView/run', confirm_view),
                           ('ExBoostSelectDialogView/run', select_view)]:
        body = e.body(label)
        ops = asm.decode(body[5])
        assert ops[-1].name == 'returnvoid'
        report[label] = {'tail': queue(e, label, builder(e, body[2]), len(ops) - 1), 'buttons': []}
        calls = [i for i, op in enumerate(ops) if op.name == 'callproperty' and
                 e.abc.mn_name(op.args[0]) in ('postiveWithCustomLabel', 'negativeWithCustomLabel')]
        assert len(calls) == (1 if 'Confirm' in label else 2)
        for i in calls:
            positive = e.abc.mn_name(ops[i].args[0]) == 'postiveWithCustomLabel'
            if 'Confirm' in label:
                value = '重抽'
                check = lambda fail: check_values_mode(e, fail)
            else:
                value = '保留新的' if positive else '保留原来的'
                check = lambda fail: context(e, body[2], fail)
            code = custom_button(e, body[2], value, positive, check)
            report[label]['buttons'].append(queue(e, label, code, i + 1))
    return report
