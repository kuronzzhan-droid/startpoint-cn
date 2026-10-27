"""执行真实窗口方法；图形、资源及构造器边界使用可观察夹具。"""
import inspect
import types

import asm
import avm_interp
import bodies


def make_vm():
    source = inspect.getsource(avm_interp)
    source = source.replace('        self.steps = 0\n', '        self.steps = 0\n        self.trace = []\n')
    source = source.replace('            x = ins[pc]\n', '            self.trace.append(pc)\n            x = ins[pc]\n')
    module = types.ModuleType('window_avm')
    exec(compile(source, '<run1 AVM2 interpreter + trace + AS3 array bounds>', 'exec'), module.__dict__)
    base_lookup = module._lookup

    def lookup(obj, key):
        if isinstance(obj, dict) and isinstance(key, (int, float)):
            return obj.get(int(key))
        # AVM2 Array 越界得到 undefined；随后原 coerce ItemThumbnailView 得 null。
        if isinstance(obj, (list, tuple)):
            if isinstance(key, (int, float)):
                return obj[int(key)] if 0 <= int(key) < len(obj) else None
            if str(key).split('::')[-1] == 'push':
                return obj.append
        return base_lookup(obj, key)

    module._lookup = lookup
    module._truthy = lambda x: True if isinstance(x, (dict, list, module.Cls)) else bool(x)
    return module


VM = make_vm()
SETUP = 'OverLimitWindowView/setupStatusInformationWindow'
GET_BUTTON = 'ButtonGroupLogic/get'


def body(abc, label):
    return abc.bodies[bodies.resolve(abc, label)]


def status(count=1, step=3, numbers=None, ids=None):
    numbers = numbers if numbers is not None else [7 + i for i in range(count)]
    ids = ids if ids is not None else [10000000 + i for i in range(count)]
    return {'characterName': '受控角色', 'overLimitStep': step,
            'characterMaxLevel': 80 + min(step, 4) * 5 + max(0, step - 4) * 5,
            'stack': 2, 'items': [
                {'id': item_id, 'ownNumber': number, 'imageAssetPath': 'item/' + str(item_id),
                 'rarity': {'_type': 'Option', 'index': 1, 'params': []}}
                for item_id, number in zip(ids, numbers)]}


class World:
    def __init__(self, abc, slots=0, holes=(), logic_ids=()):
        self.abc, self.calls, self.texts, self.children = abc, [], {}, []
        self.frames, self.buttons, self.machines = [], {}, []
        self.logic = {'buttons': {'map': {'h': {
            33554432 + item_id: {'_type': 'ButtonLogic', 'id': item_id}
            for item_id in logic_ids}}}}
        self.lex = {
            'Std': {'string': lambda value: str(value)},
            'Boot': {}, 'Error': VM.Cls('Error', lambda: {'_type': 'Error'}),
            'ClientError': VM.Cls('ClientError', lambda code, message: {'code': code, 'message': message}),
            'Option': VM.Cls('Option', Some=lambda x: {'index': 0, 'params': [x]}),
            'ButtonAnimationBehaviorKind': VM.Cls('ButtonAnimationBehaviorKind', Scale='Scale'),
            'ItemThumbnailView': VM.Cls('ItemThumbnailView', self.thumbnail),
        }
        self.view = {'uiLayout': self.container('root'),
                     'asset': {'getUiString': lambda key: 'ui/' + key},
                     'gear': {'addChild': self.add_child},
                     'buttonGroupView': {'registerDisplayObjectAsButton': self.register}}
        self.view['itemThumbnails'] = [None if i in holes else self.thumbnail({'slot': i}, None, None)
                                       for i in range(slots)]

    def container(self, path):
        return {'getContainer': lambda name, meta=None: self.container(path + '/' + name),
                'getContainers': lambda name: [{'slot': i} for i in range(2)],
                'getText': lambda name, meta=None: {'set_text': lambda value: self.texts.__setitem__(path + '/' + name, value)},
                'goto': lambda frame: self.frames.append(frame)}

    def thumbnail(self, container, image, rarity):
        obj = {'slot': container.get('slot', 0), 'image': image, 'rarity': rarity,
               'number': None, 'gray': None}
        def change(name, value):
            obj[name] = value
            self.calls.append([obj['slot'], name, value])
        obj.update(showNumber=lambda n: change('number', n), setGrayOut=lambda b: change('gray', b),
                   getDisplayObjectForButtonGroup=lambda: obj)
        return obj

    def add_child(self, child, meta):
        self.children.append(child)

    def register(self, button_id, display, animation):
        # 真正调用未修改的 ButtonGroupLogic/get，缺新道具模型时走原生 throw。
        self.run(GET_BUTTON, self.logic, button_id)
        self.buttons[button_id] = display

    def run(self, label, this, *args):
        machine = VM.Interp(self.abc, self.lex)
        self.machines.append((label, machine))
        return machine.run(asm.decode(body(self.abc, label)[5]), [this, *args])

    def apply(self, information):
        from .patches import TARGET
        return self.run(TARGET, self.view, information)

    def snapshot(self):
        return {'calls': self.calls.copy(), 'texts': dict(self.texts), 'frames': self.frames.copy(),
                'slots': [None if x is None else [x['slot'], x['number'], x['gray']]
                          for x in self.view['itemThumbnails']]}
