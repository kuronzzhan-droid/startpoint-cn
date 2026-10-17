"""Archive 110 / O10: register the paradox core cost-slot button."""
from overlimit_patch_plugin import apply_selected


def apply(source, target, work):
    return apply_selected(source, target, work, 'O10')
