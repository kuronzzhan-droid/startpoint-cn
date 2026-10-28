"""Native general-dialog content and original first-dialog texture loading."""
from .common import OWNER

CONTENT = 'pinball.dialog.general::DialogContent'
VARIATION = 'pinball.dialog.general.variation::DialogVariationKind'
WIDTH = 'pinball.dialog.general.variation::DialogVariationWidthKind'
ICON = 'pinball.dialog.general.variation::DialogVariationIconKind'
FORMAT = 'pinball.dialog.general.variation::DialogVariationSliderFormatterKind'
UISTRING = 'pinball.common.data.ui::UiStringKind'

def build(c):
    c.add('wfxContinueTextureLoaded', 'void', ['Object'], [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_1',), c.p('image'), ('setlocal_2',),
        # A closed/disposed dialog has no parent; do not touch its texture.
        ('getlocal_2',), c.p('parent'), ('iffalse', 'DONE'),
        ('getlocal_2',), c.p('width'), ('setlocal_3',),
        ('getlocal_2',), c.p('height'), ('setlocal', 4),
        # Starling Image.set_texture preserves the quad geometry. Deliberately
        # do not call readjustSize, which would resize an arbitrary item icon.
        ('getlocal_2',), ('getlocal_1',), c.p('asset'), ('getlocal_1',), c.p('path'),
        c.call('getTexture', 1), ('setproperty', c.q('texture')),
        ('getlocal_2',), ('getlocal_3',), ('setproperty', c.q('width')),
        ('getlocal_2',), ('getlocal', 4), ('setproperty', c.q('height')),
        ('label', 'DONE'), ('returnvoid',),
    ], 5)
    # The first line explicitly carries item identity and the configured amount;
    # the second line remains clear even when the balance cannot cover the cost.
    c.add('wfxContinueTitle', 'String', ['Object'], [
        ('getlocal_0',), ('pushscope',),
        c.text('消耗 '), ('getlocal_1',), c.p('itemName'), ('add',),
        c.text(' × '), ('add',), ('getlocal_1',), c.p('amount'), ('add',),
        c.text(' 继续战斗\n持有 '), ('add',), ('getlocal_1',), c.p('before'), ('add',),
        c.text(' → 消费后 '), ('add',), ('setlocal_2',),
        ('getlocal_1',), c.p('after'), ('pushbyte', 0), ('iflt', 'SHORT'),
        ('getlocal_2',), ('getlocal_1',), c.p('after'), ('add',), ('returnvalue',),
        ('label', 'SHORT'), ('getlocal_2',), c.text('数量不足'), ('add',), ('returnvalue',),
    ], 3)
    c.add('wfxContinueContents', 'Array', ['Object'], [
        ('getlocal_0',), ('pushscope',),
        c.lex(CONTENT), c.lex(OWNER), ('getlocal_1',), c.helper('wfxContinueTitle', 1), c.call('Title', 1),
        c.lex(CONTENT), ('pushbyte', 40), c.call('Margin', 1),
        # DialogContent.Item uses native ItemThumbnailView's asynchronous
        # ItemThumbnail asset group; Variation.Image calls getImage eagerly.
        c.lex(CONTENT), ('getlocal_1',), c.p('item_id'),
        c.lex('haxe.ds::Option'), ('getlocal_1',), c.p('amount'), c.call('Some', 1), c.call('Item', 2),
        c.lex(CONTENT), ('pushbyte', 16), c.call('Margin', 1),
        c.lex(CONTENT), c.lex(VARIATION), c.lex(WIDTH), c.p('None'),
        c.text('title'), c.lex(UISTRING), ('getlocal_1',), c.p('itemName'), c.call('Dynamic', 1),
        c.text('icon'), c.lex(ICON), c.p('None'),
        c.text('before'), ('getlocal_1',), c.p('before'),
        c.text('after'), ('getlocal_1',), c.p('after'),
        c.text('minValue'), c.lex('haxe.ds::Option'), c.p('None'),
        c.text('maxValue'), c.lex('haxe.ds::Option'), c.p('None'),
        c.text('formatter'), c.lex(FORMAT), c.p('Default'),
        ('newobject', 7), ('newarray', 1), c.call('Fix', 2), c.call('Variation', 1),
        ('newarray', 5), ('returnvalue',),
    ], 2)
    # view.peek is an interface at the call site; cast to the actual existing
    # ContinueDialog before reading its public questId/globalLogic fields.
    c.add('wfxContinueView', 'void', ['Object'], [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_1',), c.p('peek'),
        ('astype', c.q('pinball.dialog.continueDialog::ContinueDialog')), ('setlocal_2',),
        ('getlocal_2',), ('iffalse', 'DONE'),
        c.lex(OWNER), ('getlocal_2',), c.p('globalLogic'), ('getlocal_2',), c.p('questId'),
        c.helper('wfxContinueCost', 2), ('setlocal_3',), ('getlocal_3',), ('iffalse', 'DONE'),
        ('getlocal_1',), c.p('layout'), c.text('notice'), ('pushnull',), c.call('getText', 2),
        c.lex(OWNER), ('getlocal_3',), c.helper('wfxContinueTitle', 1), c.call('set_text', 1, void=True),
        ('getlocal_1',), c.p('layout'), c.text('variation'), ('pushnull',), c.call('getContainer', 2),
        c.text('icon'), ('pushnull',), c.call('getImage', 2),
        ('setlocal', 4),
        ('getlocal_1',), c.p('view'), c.p('asset'), ('setlocal', 5),
        ('getlocal', 5),
        c.lex('pinball.asset::AssetGroupKind'), c.p('ItemThumbnail'),
        ('getlocal_3',), c.p('thumbnail'),
        c.lex('pinball.common.tools._FunctionTools::BindImpl1_0'),
        c.lex(OWNER), ('getproperty', c.e.newq('wfxContinueTextureLoaded')),
        c.text('image'), ('getlocal', 4), c.text('asset'), ('getlocal', 5),
        c.text('path'), ('getlocal_3',), c.p('thumbnail'), ('newobject', 3),
        ('construct', 2), c.p('execute'), c.call('setTexture', 3, void=True),
        ('label', 'DONE'), ('returnvoid',),
    ], 6)
