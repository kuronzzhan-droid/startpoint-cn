"""v35r -> v35s，只拼接既有方法，追加诊断助手。"""
import coverage_binding
import grid_budget
import grid_sampling

MODULES = [('binding', coverage_binding), ('budget', grid_budget), ('sampling', grid_sampling)]
TARGETS = [target for _, module in MODULES for target in module.TARGETS]


def build(editor):
    return {name: module.build(editor) for name, module in MODULES}
