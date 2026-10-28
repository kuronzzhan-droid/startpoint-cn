"""C18 values-only draw: existing methods, native buttons and frozen confirmation."""
from c18_values_logic import apply as logic
from c18_values_view import apply as view


def apply(editor):
    result = {'logic': logic(editor), 'view': view(editor)}
    assert not editor.new_methods and not editor.traits
    return result
