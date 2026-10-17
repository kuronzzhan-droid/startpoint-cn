"""Finish R4 composition on the exact v33 input, retaining all upstream locks."""
import os

from build_common import ROOT, PATCH, environment, load, write_json
from adapt_modules import data_adapter, ui_adapter, network_adapter

os.environ.update(environment())
work = ROOT / 'work'
stages = [
    ('network', 'client-network-optimization', work / 'after-refresh.swf', work / 'after-network.swf'),
    ('data', 'client-data-optimization', work / 'after-network.swf', work / 'after-data.swf'),
    ('resource', 'client-resource-optimization', work / 'after-data.swf', work / 'after-resource.swf'),
    ('ui', 'client-ui-optimization', work / 'after-resource.swf', ROOT / 'v34.swf'),
]
compositions = []
for name, folder, source, target in stages:
    module = load('v34_' + name, PATCH / folder / 'patch_swf.py')
    if name == 'network':
        network_adapter(module)
    elif name == 'data':
        data_adapter(module)
    elif name == 'ui':
        ui_adapter(module)
    if name == 'resource':
        report = module.patch(source, target, assets=work / 'resource-assets')
    else:
        report = module.patch(source, target)
    compositions.extend(getattr(module, 'compositions', []))
    write_json(work / 'manual-compositions.json', compositions)
    print(name, 'passed', flush=True)
