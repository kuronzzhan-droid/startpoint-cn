"""物品品质底色覆盖（item-rarity-frame-override）的全部指令：纯函数，只依赖传入的 battle-rules Editor。

两处单方法指令插入（不回编 AS3、不走 FFDec），各自有方法锁（baseline.json）：

* ``ItemThumbnailView/setRarity(rarity, enhanced)``（体 85197）—— 锁的是 **v1 打过补丁的体**
  （equipment-enhanced-look 已在 #29 插了 66 条「强化态换底」）。本补丁插在 #29，即原生 ``frame.setRarity`` 之后、
  v1 插入段第一条之前（FORBID：没有任何分支指向 #29）。``enhanced`` 为**假**且 ``itemImagePath`` 是 ``Some(path)``
  （非空）时查 ``custom_ability_string["rarity_frame_override_" + path]``；值非空就
  ``hideRarity(); replaceBackgroundImage(值)``（与称号缩略图 showAnyThumbnail case 11、v1 强化框同一通路）。
  其余情况（含强化态：交给紧随其后的 v1 段）等于原方法。两段按 ``enhanced`` 互斥。
* ``ItemThumbnailView/replace(path, rarity)``（体 85210，原生体）—— 原生顺序是 ``setRarity(...)`` **先于**
  ``replaceItemImage(path)``，``setRarity`` 里看到的 ``itemImagePath`` 还是格子上一件物品的路径（商店格
  ShopCellContentsView、星粒 / 羁绊 / 玛那 / 体力等列表都走 ``replace``）。本补丁在入口 #2 插 6 条，与
  ``replaceItemImage`` 的 #2–#7 **逐字节相同**：``itemImagePath = Option.Some(path)``。原生随后
  ``replaceItemImage`` 再写一次同值；两次写之间只有 ``setRarity``，原生部分不读这个字段（v1 段只在强化态读，
  ``replace`` 恒传 false），所以没有本补丁的键时行为与原生相同。

取表只用 ``ILogicAssetContainer.getMasterTableMaybe``（表没加载返回 null）+ ``MasterMap.getMaybe``（缺行返回 null），
绝不调用会抛 8013/8014 的 ``getMasterTable``。setRarity 段只写新局部（从 v1 之后的 localcount 13 起编号）。
"""
from __future__ import annotations

THUMB = 'pinball.ui.component.item::ItemThumbnailView'

FRAME = 'ItemThumbnailView/setRarity'
REPLACE = 'ItemThumbnailView/replace'
#: 生成顺序固定（常量池追加顺序因此固定，产物 ABC 才可复现）。
TARGETS = (FRAME, REPLACE)

CAS = 'pinball.master.generated::CustomAbilityStringTable'
MAYBE = 'pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'
#: 会抛 8013/8014 的取表；插入段里**绝不**出现（verify 静态核对 + 行为探针双重把关）。
GET_MASTER = 'pinball.asset.logic:ILogicAssetContainer::getMasterTable'
GET_LOGIC_ASSETS = 'pinball.context.global:GlobalLogicForSection::getLogicAssets'
OPTION = 'haxe.ds::Option'
MULTINAME_L = 14          # 原生体里 Option.params[0] 用的同一个 MultinameL（数组下标读取）

PREFIX = 'rarity_frame_override_'
#: v1（equipment-enhanced-look）在同一个方法体里的前缀：本补丁要求它在（锁的是 v1 之后的体），且不碰它。
V1_FRAME_PREFIX = 'enhanced_frame_override_'
#: 常量池只允许追加这 1 个字符串（全部多名复用已有条目）。
ADDED_STRINGS = (PREFIX,)

CAPABILITY = 'item-rarity-frame-override-v1'

#: 已登记的底包（主 ABC → 底包说明、底包 APK / SWF、打完本补丁的主 ABC、底包声明的能力）。apply 只认这里的主 ABC，或者调用方显式给出
#: 底包构建报告（--base-build-report：报告里的 SWF 哈希必须等于输入、能力声明取报告的 candidate_capabilities）。
#: 两个被改方法体在这 4 个 ABC 里逐字节相同、体下标相同（测试核对）。
PARTY_FRAME_12 = (
    'damage-type-rules-v1', 'dash-parameter-v1', 'equipment-description-override-v1', 'equipment-enhanced-look-v1',
    'equipment-enhanced-party-frame-v1', 'equipment-gauge-gain-rules-v1', 'equipment-rules-v1',
    'gauge-gain-rules-v1', 'kyubi-fever-ratio-v1', 'kyubi-panel-description-override-v1',
    'kyubi-pf-initial-combo-v1', 'panel-description-override-v2',
)
KNOWN_BASES = {
    # 编成槽框 a 版：本机 MuMu 已装（APK 14396ce0，缓存 SWF 9986dea3）。有「自制武器图标会消失」缺陷，
    # 只用来单独验证本补丁；正式装机请叠在最终合成链上（见 README）。
    '016cd9270a5b9c0d2d7ae6e701f5d2bcbe6ac10c59a72d1f003ccd04234169dd': {
        'label': 'equipment-enhanced-party-frame a（APK 14396ce0，本机已装）',
        'apk_sha256': '14396ce09a4cf23624be570677ddc93b8e284ea8414836112dd7e78db6c056b6',
        'swf_sha256': '9986dea39831608e44a405619cf234c8cccdcdbc476939bb9b5c53d689d67177',
        'target_abc_sha256': 'c74ef64fdd46fd8e12d330471c85a7bbffe363b85112f557cc8f05bd9ea10e40',
        'capabilities': PARTY_FRAME_12,
    },
    # 编成槽框 b 版（APK 2f085757，候选）。
    '2a9583cddd47786844b9ce5fe2b99aff4e8b5f727e95e757fded99940688a1ad': {
        'label': 'equipment-enhanced-party-frame b（APK 2f085757）',
        'apk_sha256': '2f085757e46477625727fc5eb135027d15c14bb54e3486a395a730ed3f168666',
        'swf_sha256': '5bd476f6effd1452a8d2508bbc721e1bc1636a5eb62b226005511eb698627162',
        'target_abc_sha256': 'b989d0a1b7bc13a648a52051bc9786ed5b3e875e159c145c2fa2e4f2f8d3e388',
        'capabilities': PARTY_FRAME_12,
    },
    # 编成槽框 b + 觉醒专属素材（中间层，不单独出 APK）。
    '22292c21361fa505bccd563852810e6fb1d696ae03823f05ff694a74fbdf2ec1': {
        'label': 'equipment-awakening-material（叠在 b 上，无单独 APK）',
        'apk_sha256': None,
        'swf_sha256': '15c8cba8eb86c8e86be2d9508b810d7a4288b7aa000a4ae7e215e1c2132efa0a',
        'target_abc_sha256': '810e8d915f50d060282a861d68061a1780bc354c065f328d6116189cd18746de',
        'capabilities': tuple(sorted(PARTY_FRAME_12 + ('equipment-awakening-material-v1',))),
    },
    # 最终合成链：编成槽框 b + 觉醒专属素材 + 装备列表置顶（APK 71f420a8，候选）。
    'c39746e01bc14323d06873a698e40b9480f8b1552a70b0861995edb8ef6f509c': {
        'label': 'equipment-awakening-material + equipment-sort-pin（APK 71f420a8，最终合成链）',
        'apk_sha256': '71f420a84d1dafe791bb6dcbe5ba798da089776710a9b2a7c662906df1fda4a6',
        'swf_sha256': '52faeeb777f02fc2942080b0f99e0c3b9d346fcb823fc1d8e115b9adf0b30468',
        'target_abc_sha256': 'f3b15163927e0297e0150f2183b6f77ce0015053ff0603911d5785592344f188',
        'capabilities': tuple(sorted(PARTY_FRAME_12 + ('equipment-awakening-material-v1', 'equipment-sort-pin-v1'))),
    },
}

#: 插入点（锁定体的指令下标）。
ANCHORS = {FRAME: 29, REPLACE: 2}
#: 新局部变量从锁定体的 localcount 起编号，原方法体（含 v1 段）一个也读不到。replace 段不用局部。
LOCALS = {
    FRAME: {'option': 13, 'path': 14, 'key': 15, 'view': 16, 'asset': 17, 'global': 18, 'assets': 19, 'table': 20,
            'text': 21},
    REPLACE: {},
}
#: 插入段只读这些原有寄存器（this / enhanced 参数；replace 的 path 参数）。
READS = {FRAME: {0, 2}, REPLACE: {1}}
#: 锁定体的形状（名字、操作数短名）：setRarity 钉住锚点前后与 v1 段首尾，replace 整条钉死。
FRAME_SHAPE = {
    28: ('callpropvoid', 'setRarity'),   # 原生 frame.setRarity(rarity, enhanced)
    29: ('getlocal_2', None),            # v1 段第一条：enhanced 判定
    30: ('iffalse', None),
    48: ('pushstring', V1_FRAME_PREFIX),
    95: ('returnvoid', None),
}
FRAME_LENGTH = 96
FRAME_V1_EXIT = 95
REPLACE_NATIVE = (
    ('getlocal_0', None), ('pushscope', None),
    ('findproperty', 'setRarity'), ('getlex', 'Option'), ('getlocal_2', None), ('callproperty', 'Some'),
    ('coerce', 'Option'), ('pushfalse', None), ('callpropvoid', 'setRarity'),
    ('findproperty', 'replaceItemImage'), ('getlocal_1', None), ('callpropvoid', 'replaceItemImage'),
    ('returnvoid', None),
)
#: replace 段逐字节照抄 replaceItemImage 的这 6 条（#2–#7：itemImagePath = Option.Some(param1)）。
HOIST_SOURCE = 'ItemThumbnailView/replaceItemImage'
HOIST_RANGE = (2, 8)
#: 各插入段指令条数（设计值；测试逐一核对）。
INSERTED_COUNTS = {FRAME: 66, REPLACE: 6}
NEED_ACTIVATION = 0x02


def frame_key(icon_path: str) -> str:
    """品质底色覆盖的键：键尾是缩略图正在显示的图标路径（itemImagePath）。"""
    return PREFIX + icon_path


# ---------------------------------------------------------------------------
# 指令片段
# ---------------------------------------------------------------------------

def _guarded(local, source):
    """栈 [] -> []：``local = <source>``；null / 空串跳 SKIP。"""
    return list(source) + [('setlocal', local), ('getlocal', local), ('iffalse', 'SKIP')]


def frame_insertion(e):
    """setRarity(param1:Option, param2:Boolean):void 的原生 frame.setRarity 之后、v1 段之前。
    非强化态命中时 hideRarity + replaceBackgroundImage；出口（含命中）一律落到 v1 段第一条。"""
    q, loc = e.q, LOCALS[FRAME]
    code = [('getlocal_2',), ('iftrue', 'SKIP')]
    code += _guarded(loc['option'], [('getlocal_0',), ('getproperty', q('itemImagePath'))])
    code += [('getlocal', loc['option']), ('getproperty', q('index')), ('pushbyte', 0), ('ifne', 'SKIP')]
    code += _guarded(loc['path'], [('getlocal', loc['option']), ('getproperty', q('params')), ('pushbyte', 0),
                                   ('getproperty', MULTINAME_L), ('coerce_s',)])
    code += [e.string(PREFIX), ('getlocal', loc['path']), ('add',), ('setlocal', loc['key'])]
    code += _guarded(loc['view'], [('getlocal_0',), ('getproperty', q('view'))])
    code += _guarded(loc['asset'], [('getlocal', loc['view']), ('getproperty', q('asset'))])
    code += _guarded(loc['global'], [('getlocal', loc['asset']), ('getproperty', q('globalLogic'))])
    code += _guarded(loc['assets'], [('getlocal', loc['global']), ('callproperty', q(GET_LOGIC_ASSETS), 0)])
    code += _guarded(loc['table'], [('getlocal', loc['assets']), ('getlex', q(CAS)), ('callproperty', q(MAYBE), 1)])
    code += _guarded(loc['text'], [('getlocal', loc['table']), ('callproperty', q('get_data'), 0),
                                   ('getlocal', loc['key']), ('callproperty', q('getMaybe'), 1)])
    code += _guarded(loc['text'], [('getlocal', loc['text']), ('getproperty', q('string'))])
    code += [('getlocal_0',), ('callpropvoid', q('hideRarity'), 0),
             ('getlocal_0',), ('getlocal', loc['text']), ('callpropvoid', q('replaceBackgroundImage'), 1),
             ('label', 'SKIP')]
    return code


def replace_insertion(e):
    """replace(param1:String, param2:int):void 入口：``itemImagePath = Option.Some(param1)``，
    与 replaceItemImage #2–#7 同一组多名、同一顺序（findproperty / initproperty，Haxe 产物的字段写法）。"""
    q = e.q
    return [('findproperty', q('itemImagePath')), ('getlex', q(OPTION)), ('getlocal_1',),
            ('callproperty', q('Some'), 1), ('coerce', q(OPTION)), ('initproperty', q('itemImagePath'))]


BUILDERS = {FRAME: frame_insertion, REPLACE: replace_insertion}


# ---------------------------------------------------------------------------
# 锚点与登记
# ---------------------------------------------------------------------------

def _short(abc, x):
    if not x.args or x.args[0] == MULTINAME_L:
        return None
    return abc.mn_name(x.args[0]).rsplit(':', 1)[-1]


def _check_body(e, asm, bodies, label):
    abc = e.abc
    body = abc.bodies[bodies.resolve(abc, label)]
    ins = asm.decode(body[5])
    if [x.name for x in ins[:2]] != ['getlocal_0', 'pushscope']:
        raise asm.AsmError(f'{label} prologue changed')
    if abc.methods[body[0]][3] & NEED_ACTIVATION or body[6] or body[7]:
        raise asm.AsmError(f'{label} gained an activation, exception table or body traits')
    for x in ins:
        if x.name == 'pushstring' and abc.strings[x.args[0]] == PREFIX.encode():
            raise asm.AsmError(f'{label} already probes {PREFIX}')
    at = ANCHORS[label]
    incoming = [i for i, x in enumerate(ins) if x.target == at or (x.cases and at in [x.default, *x.cases])]
    if incoming:
        raise asm.AsmError(f'{label} anchor #{at} is a branch target: {incoming}')
    return abc, body, ins, at


def find_frame_anchor(e, asm, bodies):
    """setRarity：v1 段必须在（#29 起、#48 的前缀、唯一出口 #95 returnvoid）；本补丁的前缀不在；#29 不是分支目标；
    localcount 恰好 13（v1 之后）且新局部从 13 起；v1 段的所有分支都在段内或跳到 #95。"""
    abc, body, ins, at = _check_body(e, asm, bodies, FRAME)
    if len(ins) != FRAME_LENGTH:
        raise asm.AsmError(f'{FRAME} has {len(ins)} instructions, expected {FRAME_LENGTH} (v1-patched body)')
    for index, (name, operand) in FRAME_SHAPE.items():
        x = ins[index]
        got = abc.strings[x.args[0]].decode('utf8') if x.name == 'pushstring' else _short(abc, x)
        if x.name != name or (operand is not None and got != operand):
            raise asm.AsmError(f'{FRAME} native #{index} changed: {x}')
    if any(x.target is not None and index >= at and not at <= x.target <= FRAME_V1_EXIT
           for index, x in enumerate(ins)):
        raise asm.AsmError(f'{FRAME} v1 block branches outside itself')
    first_new = min(LOCALS[FRAME].values())
    if body[2] != first_new or asm.block_locals(ins) > first_new:
        raise asm.AsmError(f'{FRAME} localcount {body[2]} != first new local {first_new}')
    return at


def find_replace_anchor(e, asm, bodies):
    """replace：13 条原生指令逐条同形（已打过本补丁 = 多了 6 条，直接拒绝）；localcount 仍是 3；
    replaceItemImage 的 #2–#7 仍是本补丁要照抄的那 6 条。"""
    abc, body, ins, at = _check_body(e, asm, bodies, REPLACE)
    if len(ins) != len(REPLACE_NATIVE):
        raise asm.AsmError(f'{REPLACE} has {len(ins)} instructions, expected {len(REPLACE_NATIVE)} '
                           '(already patched or changed)')
    for i, (x, (name, operand)) in enumerate(zip(ins, REPLACE_NATIVE)):
        if x.name != name or (operand is not None and _short(abc, x) != operand):
            raise asm.AsmError(f'{REPLACE} native #{i} changed: {x}')
    if body[2] != 3 or asm.block_locals(ins) > 3:
        raise asm.AsmError(f'{REPLACE} localcount changed: {body[2]}')
    source = asm.decode(abc.bodies[bodies.resolve(abc, HOIST_SOURCE)][5])[slice(*HOIST_RANGE)]
    expected = asm.assemble(replace_insertion(e))
    if [(x.op, x.args) for x in source] != [(x.op, x.args) for x in expected]:
        raise asm.AsmError(f'{HOIST_SOURCE} #{HOIST_RANGE[0]}-#{HOIST_RANGE[1] - 1} is no longer '
                           'itemImagePath = Option.Some(param1)')
    return at


def install(e, asm, bodies, mutate=None):
    """在 Editor 上登记两段插入；返回 {标签: 锚点}。调用方负责 ``e.apply()``。

    ``mutate(e, label, code) -> code`` 只供测试 / verify 构造变异体（负对照），交付构建不传。
    """
    anchors = {FRAME: find_frame_anchor(e, asm, bodies), REPLACE: find_replace_anchor(e, asm, bodies)}
    for label in TARGETS:
        code = BUILDERS[label](e)
        if mutate is not None:
            code = mutate(e, label, code)
        e.insert(label, anchors[label], code, asm.FORBID)
    return anchors
