"""Supply the final R9 text/box interfaces to the older default AIR fixture.

Only fixture objects are changed. Production ABC and all original assertions
are imported unchanged by the shared harness. Native display/GPU is not modeled.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'content-operations'))
import offline_runtime_test as harness

PERIOD_TEXT = '''
private function periodText(onText:Function):Object {
 var text:Object={width:300,height:60,visible:true,rawTextField:{wordWrap:true,format:{horizontalAlign:"left"}}};
 text.get_textWidth=function():Number{return text.width;};
 text.get_textHeight=function():Number{return text.height;};
 text.set_textWidth=function(value:Number):Number{text.width=value;return value;};
 text.set_textHeight=function(value:Number):Number{text.height=value;return value;};
 text.set_autoSize=function(value:String):String{text.autoSize=value;return value;};
 text.set_autoScale=function(value:Boolean):Boolean{text.autoScale=value;return value;};
 text.set_text=function(value:String):String{onText(value);return value;};
 return text;
}
'''


def adapt():
    replacements = {
        'public function StateTest() {': PERIOD_TEXT + '\npublic function StateTest() {',
        'var text:Object={set_text:function(v:String):void{labels.push(v);},visible:true};':
            'var text:Object=periodText(function(v:String):void{labels.push(v);});',
        'peek:{boxGachaId:1001},layout:':
            'peek:{boxGachaId:1001,getEndDate:function():Option{return Option.Some(1000);}},layout:',
        'return {set_text:function(value:String):void{boxLabels.push(value);}};':
            'return periodText(function(value:String):void{boxLabels.push(value);});',
    }
    for old, new in replacements.items():
        if harness.MAIN.count(old) != 1:
            raise ValueError(('Fixture adapter anchor changed', old))
        harness.MAIN = harness.MAIN.replace(old, new)


if __name__ == '__main__':
    adapt()
    harness.main()
