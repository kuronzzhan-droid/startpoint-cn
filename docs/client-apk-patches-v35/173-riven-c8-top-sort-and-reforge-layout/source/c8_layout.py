"""C8 layout entry point: reversible single-method splices, no methods/traits."""
import json
import asm
from pathlib import Path
from bootstrap import ROOT, sha, write_json
from c2_common import queue
from c8_layout_page import queue_page
from c8_layout_color import queue_colors

UI=Path(r'<WORKDIR>\resources\game\wf-decrypted\scene\expod\ex_boost_window.ui.json')


def queue_layout(editor):
    raw=UI.read_bytes(); data=json.loads(raw)
    layouts={row['id']:row['children'] for row in data['layouts']}
    panel=layouts['container/ex_boost_panel']
    assert [(r['frames'][0]['depth'],r['attributes']['path']) for r in panel['bitmaps']]==[
        (0,'scene/general/sprite_sheet/bg-assets/colorfafafa_round24_shadow10'),
        (2,'scene/general/sprite_sheet/border_box-assets/border_box_fafafa_cccccc')]
    inner=layouts['container/ex_boost_button_inner']
    assert inner['bitmaps'][2]['frames'][0]['depth']==2
    assert inner['bitmaps'][2]['attributes']['path']=='scene/general/sprite_sheet/bitmap_text-assets/ex_boost_button'
    methods=queue_page(editor)
    methods.update(queue_colors(editor))
    label='ExBoostSelectDialogView/run'; ops=asm.decode(editor.body(label)[5])
    old='左侧为原词条，右侧为新词条。请选择保留哪一组。'
    hits=[i for i,o in enumerate(ops) if o.name=='pushstring' and editor.abc.s(o.args[0])==old]
    assert len(hits)==1
    methods[label]=queue(editor,label,[('pop',),editor.string('上方为原词条，下方为新词条。请选择保留哪一组。')],hits[0]+1,asm.SKIP)
    evidence={'methods':methods,'asset':str(UI),'asset_sha256':sha(raw),
              'thumbnail':{'parent':'ex_boost_panel','x':74,'y':72,'scale':0.5,'refresh':'ItemThumbnailView.replace'},
              'main_button':'existing orange button; old bitmap label hidden; existing font 重抽',
              'fee_frame':'anonymous border at depth 2 hidden; select_item_table hidden',
              'fee':'本次费用 <next_cost> 深渊币（持有 <balance>）','dismantle':'分解',
              'new_methods':0,'new_traits':0,'native_render_verified':False}
    write_json(ROOT/'audit/c8-layout/metadata.json',evidence)
    return evidence
