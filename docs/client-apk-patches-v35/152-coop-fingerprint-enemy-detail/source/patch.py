"""v35s 到 v35t：只拼接诊断方法，保留游戏方法字节。"""
import sampling21
import enemy21
import version21

MODULES = [('sampling', sampling21), ('enemies', enemy21), ('version', version21)]
TARGETS = [target for _, module in MODULES for target in module.TARGETS]


def build(editor):
    return {name: module.build(editor) for name, module in MODULES}
