"""Archive 108 / O8: owned-character pedestal routing."""
from overlimit_patch_plugin import apply_selected


def apply(source, target, work):
    return apply_selected(source, target, work, 'O8')
