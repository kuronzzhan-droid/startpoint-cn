"""v35r：精简检查点、输入聚合与手机级诊断限速。"""
import compact_fields
import compact_inputs
import compact_sampling
import compact_transport

TARGETS = compact_inputs.TARGETS + compact_sampling.TARGETS + compact_transport.TARGETS


def build(editor):
    return {name: module.build(editor) for name, module in (
        ('fields', compact_fields), ('inputs', compact_inputs),
        ('sampling', compact_sampling), ('transport', compact_transport))}
