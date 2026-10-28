"""Reuse the existing equipment filter controls only for wfxRiven settings."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, OPTION, get, prefix, queue


def mode(e, fail, view=False):
    code = [('getlocal_0',)]
    if view:
        code += [('getproperty', e.q('peek'))]
    return code + [('getproperty', e.q('initialSetting')), *get(e, 'wfxRiven'), ('iffalse', fail)]


def clicked(e, first):
    text, elements, selected, i, value, result = range(first, first + 6)
    q = e.q
    g = lambda v: ('getlocal', v)
    p = lambda v: ('setlocal', v)
    n = lambda v: number(e, v)
    code = mode(e, 'filter_original') + [
        ('getlocal_1',), n(0), ('ifne', 'filter_not_ok'),
        ('getlocal_0',), ('getproperty', q('keywordSearchInput')), ('getproperty', q('text')), p(text),
        g(text), e.string(''), ('ifne', 'filter_some_text'),
        ('getlex', q(OPTION)), ('getproperty', q('None')), p(text), ('jump', 'filter_text_done'),
        ('label', 'filter_some_text'), ('getlex', q(OPTION)), g(text), ('callproperty', q('Some'), 1), p(text),
        ('label', 'filter_text_done'), ('newarray', 0), p(elements),
        ('getlocal_0',), ('getproperty', q('elementButtonGroup')), ('callproperty', q('getCheckedButtonKinds'), 0), p(selected),
        n(0), p(i), ('label', 'filter_choice_loop'), ('avm_label',),
        g(i), g(selected), ('getproperty', q('length')), ('ifge', 'filter_choices_done'),
        g(selected), g(i), ('getproperty', DYNAMIC), ('convert_i',), p(value),
        g(value), n(16777216), ('ifne', 'filter_some_element'),
        ('getlex', q(OPTION)), ('getproperty', q('None')), p(value), ('jump', 'filter_element_done'),
        ('label', 'filter_some_element'), ('getlex', q(OPTION)), g(value), ('callproperty', q('Some'), 1), p(value),
        ('label', 'filter_element_done'), g(elements), g(value),
        ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1),
        ('inclocal_i', i), ('jump', 'filter_choice_loop'), ('label', 'filter_choices_done'),
        e.string('wfxRiven'), ('pushtrue',), e.string('keywordSearchText'), g(text),
        e.string('keywordSearchKinds'), ('getlocal_0',), ('getproperty', q('keywordSearchButtonGroup')),
        ('callproperty', q('getCheckedButtonKinds'), 0), e.string('elements'), g(elements), ('newobject', 4), p(result),
        ('getlocal_0',), ('getlex', q('pinball.common.tools._FunctionTools::BindImpl1_0')),
        ('getlocal_0',), ('getproperty', q('okHandler')), g(result), ('construct', 2),
        ('getproperty', q('execute')), ('callpropvoid', q('closeThen'), 1), ('returnvoid',),
        ('label', 'filter_not_ok'), ('getlocal_1',), n(1), ('ifne', 'filter_not_cancel'),
        ('getlocal_0',), ('callpropvoid', q('close'), 0), ('returnvoid',),
        ('label', 'filter_not_cancel'), ('getlocal_1',), n(2), ('ifne', 'filter_end')]
    for group in ('elementButtonGroup', 'keywordSearchButtonGroup'):
        code += [('getlocal_0',), ('getproperty', q(group)), ('callpropvoid', q('uncheckAllButtons'), 0)]
    code += [('getlocal_0',), ('getproperty', q('keywordSearchInput')), ('callpropvoid', q('clearText'), 0),
             ('label', 'filter_end'), ('returnvoid',), ('label', 'filter_original')]
    return code


def white_button(e, labels, index):
    """Existing white selectable button art with a literal text override."""
    q = e.q
    code = [('getlex', q('pinball.ui.component.button.config.core::ButtonConfig')),
            e.string('background'), e.string('parent'),
            ('getlex', q('pinball.ui.component.button.config.preset::ButtonBackgroundDefaultConfigs')),
            ('getproperty', q('boxPureWhiteColor')), ('newobject', 1),
            e.string('content'), e.string('parent'),
            ('getlex', q('pinball.ui.component.button.config.preset::ButtonContentDefaultConfigs')),
            ('getproperty', q('white')), e.string('text')]
    code += [e.string(label) for label in labels]
    code += [('newarray', len(labels)), ('getlocal', index), ('getproperty', DYNAMIC),
             e.string('textSize'), number(e, 24), ('newobject', 3), ('newobject', 2),
             ('callproperty', q('Box'), 1)]
    return code


def configure(e, first):
    return mode(e, 'filter_prepare_done') + [
        ('getlocal_0',), ('getproperty', e.q('keywordSearchInput')), e.string('输入绑定武器名称'),
        ('setproperty', e.q('placeholder')), ('label', 'filter_prepare_done')]


def content_tail(e, first):
    q = e.q
    code = mode(e, 'filter_content_done', True)
    code += [('getlocal_0',), ('getproperty', q('layout')), e.string('search_description'), ('pushnull',),
             ('callproperty', q('getText'), 2),
             e.string('名称筛选绑定武器。条数、负面可多选；不限忽略两组限制。\n默认按获得顺序由新到旧；勾选重抽排序 / 升序可切换。'),
             ('callpropvoid', q('set_text'), 1)]
    return code + [('label', 'filter_content_done')]


def mark_title(e, first):
    """Mark only newly created title instances; never hide a layout parent."""
    q = e.q
    return mode(e, 'filter_mark_done', True) + [
        ('dup',), ('getproperty', q('uiString')),
        e.string('equipment_list_filter_dialog_group_title_keyword'), ('ifne', 'filter_mark_affix'),
        ('dup',), e.string('wfx_riven_filter_keyword'), ('setproperty', q('uiString')), ('jump', 'filter_mark_done'),
        ('label', 'filter_mark_affix'), ('dup',), e.string('wfx_riven_filter_affix'),
        ('setproperty', q('uiString')), ('label', 'filter_mark_done')]


def title_prefix(e, first):
    q = e.q
    code = [('pushnull',), ('setlocal', first)]
    for suffix, original, title in [
        ('keyword', 'keyword', '武器名称与排序'), ('affix', 'element', '词条数量与负面')]:
        code += [('getlocal_0',), ('getproperty', q('uiString')), e.string('wfx_riven_filter_' + suffix),
                 ('ifne', 'filter_title_next_' + suffix), ('getlocal_0',),
                 e.string('equipment_list_filter_dialog_group_title_' + original), ('setproperty', q('uiString')),
                 e.string(title), ('setlocal', first), ('label', 'filter_title_next_' + suffix)]
    return code


def queue_filter_splices(e):
    report = {'EquipmentFilterDialog/dialogButtonClicked':
              prefix(e, 'EquipmentFilterDialog/dialogButtonClicked', clicked)}
    label = 'EquipmentFilterDialog/prepare'
    ops = asm.decode(e.body(label)[5])
    report[label] = queue(e, label, configure(e, e.body(label)[2]), len(ops) - 1)
    label = 'EquipmentFilterDialogContentView/run'
    ops = asm.decode(e.body(label)[5])
    report[label] = {'tail': queue(e, label, content_tail(e, e.body(label)[2]), len(ops) - 1), 'buttons': []}
    for method, labels in (
        ('whiteWithCustomLabel', ['按重抽次数', '升序排列']),
        ('optionalElementSelect', ['1条', '2条', '3条', '4条', '有负', '无负', '不限']),
    ):
        hits = [i for i, op in enumerate(ops) if op.name == 'callproperty' and e.abc.mn_name(op.args[0]) == method]
        assert len(hits) == 1, (label, method, hits)
        fail = 'filter_config_' + method
        code = mode(e, fail, True) + [('pop',)] + white_button(e, labels, 4) + [('label', fail)]
        report[label]['buttons'].append(queue(e, label, code, hits[0] + 1))
    hits = [i for i, op in enumerate(ops) if op.name == 'constructprop' and
            e.abc.mn_name(op.args[0]) == 'pinball.ui.component.groupTitle::FlipperGroupTitleView']
    assert len(hits) == 1
    report[label]['titles'] = queue(e, label, mark_title(e, e.body(label)[2]), hits[0] + 1)
    label = 'EquipmentFilterDialogView/run'
    ops = asm.decode(e.body(label)[5])
    hits = [i for i, op in enumerate(ops) if op.name == 'callproperty' and e.abc.mn_name(op.args[0]) == 'getUiString']
    assert len(hits) == 1
    code = mode(e, 'filter_title_done', True) + [('pop',), e.string('裂罅筛选与排序'), ('label', 'filter_title_done')]
    report[label] = queue(e, label, code, hits[0] + 1)
    label = 'FlipperGroupTitleView/run'
    first = e.body(label)[2]
    report[label] = {'prefix': prefix(e, label, title_prefix)}
    ops = asm.decode(e.body(label)[5])
    hits = [i for i, op in enumerate(ops) if op.name == 'callproperty' and e.abc.mn_name(op.args[0]) == 'getUiString']
    assert len(hits) == 1
    code = [('getlocal', first), ('iffalse', 'filter_group_title_done'), ('pop',),
            ('getlocal', first), ('label', 'filter_group_title_done')]
    report[label]['label'] = queue(e, label, code, hits[0] + 1)
    return {'queued': report, 'setting': 'wfxRiven=true on ordinary filterSetting Object',
            'keyword': 'bound weapon name substring',
            'controls': 'elements 0..3=count1..4; 4=negative; 5=no-negative; None=unrestricted; keywords 0=roll,1=ascending',
            'date_deviation': 'acquisition sequence by riven_id; load contract has no created_at',
            'normal_filter': 'all added logic is guarded by initialSetting.wfxRiven'}
