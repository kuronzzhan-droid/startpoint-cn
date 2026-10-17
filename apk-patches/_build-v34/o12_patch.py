"""Archive 111 / O12: show paradox core consumption in the confirmation text."""
from overlimit_patch_plugin import apply_selected


def apply(source, target, work):
    return apply_selected(source, target, work, 'O12')
