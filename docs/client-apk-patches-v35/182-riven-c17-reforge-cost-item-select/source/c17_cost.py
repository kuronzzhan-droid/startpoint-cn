"""C17 selected-cost support, applied only to existing method bodies."""
from c17_cost_data import apply as data
from c17_cost_logic import apply as logic
from c17_cost_view import apply as view
from c17_cost_dialog import apply as dialog


def apply(editor):
    result={'data':data(editor),'logic':logic(editor),'view':view(editor),'dialog':dialog(editor)}
    assert not editor.new_methods and not editor.traits
    return result
