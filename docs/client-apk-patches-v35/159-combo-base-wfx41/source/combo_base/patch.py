"""N3: preserve ordinary combo storage and layer a live team maximum on reads."""
import asm
from common import describe
from .helpers import install

READS = ['getCombo', 'getComboInt', 'getPowerFlipChargeLv', 'getPowerFlipChargeRate']
TARGETS = ['ComboCalculatorImpl/' + name for name in READS + ['decreaseComboTo']]
ADDED = ['ComboCalculatorImpl/wfxComboBase', 'ComboCalculatorImpl/wfxComboEffective']


def build(e):
    effective = install(e)
    convert = [('getlocal_0',), ('swap',), ('callproperty', effective, 1), ('convert_i',)]
    sites = {}
    for name in READS:
        label = 'ComboCalculatorImpl/' + name
        ins = asm.decode(e.body(label)[5])
        indices = [i + 1 for i, op in enumerate(ins)
                   if op.name == 'getproperty' and e.abc.mn_name(op.args[0]) == 'combo']
        assert len(indices) == (3 if name.startswith('getPowerFlip') else 1), (label, indices)
        for at in indices:
            e.insert(label, at, convert)
        sites[label] = indices
    # decreaseComboTo's threshold notification must use the same effective
    # values as getCombo. Keep the original normal-combo history/stat counters.
    label = 'ComboCalculatorImpl/decreaseComboTo'
    ins = asm.decode(e.body(label)[5])
    descriptions = [describe(e.abc, op) for op in ins]
    call = next(i for i, s in enumerate(descriptions) if '::updateCombo' in s)
    assert descriptions[call - 2:call] == ['getlocal_2 []', 'getlocal_1 []']
    e.insert(label, call - 1, convert)
    e.insert(label, call, convert)
    sites[label] = [call - 1, call]
    return {'capability': 'client.combo.base@1', 'wfx_code': 41,
            'base': 'max positive raw per-layer value of live local-team wfx:41 rows; stacks do not multiply',
            'ordinary_combo': 'all writes, consumption, expiry, restrictions, max/history counters and timing preserved',
            'reads': 'masked normal + live base; zero base preserves the original integer',
            'threshold_notification': 'effective before/after values on ordinary decrease',
            'sites': sites, 'added': ADDED}
