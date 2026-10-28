"""C5 identity constants and shared readback helpers for the inherited suites."""
from c4_admission import (TAG, CONFIG_TAG, locate, replace_literal, references,
                         verify_tags, unpack, patch_tag)
from c5_config import ADMISSION_BUILD
from c5_constants import OLD_BUILD, reverse_all_constants

OLD_PREFIX = 'SP-ADMISSION-1\n' + OLD_BUILD + '\n'
NEW_PREFIX = 'SP-ADMISSION-1\n' + ADMISSION_BUILD + '\n'


def patch(raw):
    result, transport = patch_tag(raw, TAG, [
        ('declaration', OLD_BUILD, ADMISSION_BUILD), ('proof_prefix', OLD_PREFIX, NEW_PREFIX)])
    result, config = patch_tag(result, CONFIG_TAG, [('config_id', OLD_BUILD, ADMISSION_BUILD)])
    return result, {'abc_tags': [transport, config], 'build': ADMISSION_BUILD}
