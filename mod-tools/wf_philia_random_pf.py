"""五道PF风刃在命中时独立抽取整圈方向；仅用原生概率分支。

每道等概率选择36个角度，相邻10度；五道的采样网格分别错开0/2/4/6/8度，
避免两道完全重合。每次只执行五个分支，不新增实际风刃、伤害或贴图。
"""
from copy import deepcopy
from math import radians

import wf_seasonal7_kit_philia as K

CHOICES = 36
ID_BASE = 1000


def launch_body(tree):
    collisions = [e for e in K.events(tree) if e[0] == 'CollisionOfBallAndEnemy']
    if len(collisions) != 1:
        raise ValueError('PF collision event drift')
    burst = [c for c in K.cmds(collisions[0][5], 'CreateReferencePoint') if c[10] == 1]
    if len(burst) != 1 or burst[0][1] != collisions[0][4] or burst[0][6]:
        raise ValueError('PF must snapshot collision position')
    return burst[0][11][1]


def revise_pf(source):
    tree = deepcopy(source)
    body = launch_body(tree)
    if K.cmds(body, 'ConditionalsProbability'):
        validate(tree)
        return tree
    swords = [n for n in body if n[0] == 'Command' and n[1][0] == 'CreateHitArea'
              and 200 <= n[1][19] < 225]
    if len(swords) != 5:
        raise ValueError('expected five original PF blades')
    for i, node in enumerate(swords):
        branches = []
        for j in range(CHOICES):
            blade = deepcopy(node)
            # Keep the external impact anchor; remap every local binding/reference.
            ids = {1: 1}
            def rebind(old):
                if old not in ids:
                    ids[old] = ID_BASE + (i*CHOICES+j)*10 + len(ids)-1
                return ids[old]
            K.remap_subjects(blade, rebind)
            blade[1][6] = radians(j*10+i*2)
            for fx in K.cmds(blade[1][20], 'ShowEffect'):
                if fx[3] == 1 and fx[6] == ['AB']:
                    fx[9] = blade[1][6]
            branches.append(['Block', [['Command', ['ProbabilityWeight', 1.0]],
                                       ['Block', [blade]]]])
        body[body.index(node)] = ['Command', ['ConditionalsProbability', ['Block', branches]]]
    validate(tree)
    return tree


def validate(tree):
    choices = K.cmds(launch_body(tree), 'ConditionalsProbability')
    if len(choices) != 5:
        raise ValueError('expected five independent native random draws')
    for i, choice in enumerate(choices):
        if len(choice) != 2 or choice[1][0] != 'Block' or len(choice[1][1]) != CHOICES:
            raise ValueError('native random branch shape drift')
        for j, branch in enumerate(choice[1][1]):
            weight, payload = branch[1]
            if branch[0] != 'Block' or weight != ['Command', ['ProbabilityWeight', 1.0]] \
                    or payload[0] != 'Block' or len(payload[1]) != 1:
                raise ValueError('native weighted branch pair drift')
            blade = payload[1][0][1]
            moves = K.cmds(blade[20], 'MoveHitArea')
            rains = K.cmds(blade[23], 'CreateReferencePoint')
            if blade[0] != 'CreateHitArea' or blade[6] != radians(j*10+i*2) \
                    or blade[3] != ['AB'] or blade[18] != ['None'] \
                    or blade[15] != ['Some', K.slv(1, 1)] \
                    or len(moves) != 1 or moves[0][2:5] != [['CD'], 0, 14] \
                    or len(rains) != 1 or rains[0][1] != blade[21] or rains[0][6]:
                raise ValueError('random blade direction, piercing or impact rain drift')
    if errors := K.dsl_gate_failures(K.dsl_gates(tree)):
        raise ValueError(errors)
