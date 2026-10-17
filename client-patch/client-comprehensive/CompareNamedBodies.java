import com.jpexs.decompiler.flash.SWF;
import com.jpexs.decompiler.flash.abc.ABC;
import com.jpexs.decompiler.flash.abc.types.MethodBody;
import com.jpexs.decompiler.flash.abc.types.ABCException;
import com.jpexs.decompiler.flash.tags.ABCContainerTag;
import com.jpexs.decompiler.flash.tags.DoABC2Tag;
import java.io.*;
import java.util.*;

/** Independent FFDec parser: compare existing bytecode and exception tables by named ABC. */
public final class CompareNamedBodies {
    static Map<String,ABC> load(String path) throws Exception {
        SWF swf;try(InputStream in=new BufferedInputStream(new FileInputStream(path))) { swf=new SWF(in,true); }
        Map<String,ABC> result=new LinkedHashMap<>();
        for(ABCContainerTag tag:swf.getAbcList()) {
            if(!(tag instanceof DoABC2Tag)) throw new IllegalStateException("unnamed ABC");
            String name=((DoABC2Tag)tag).name;
            String key=name;int occurrence=1;
            while(result.containsKey(key))key=name+"#"+(++occurrence);
            result.put(key,tag.getABC());
        }
        return result;
    }
    static boolean same(MethodBody a,MethodBody b) {
        if(a.method_info!=b.method_info || a.max_stack!=b.max_stack || a.max_regs!=b.max_regs
            || a.init_scope_depth!=b.init_scope_depth || a.max_scope_depth!=b.max_scope_depth
            || !Arrays.equals(a.getCodeBytes(),b.getCodeBytes()) || a.exceptions.length!=b.exceptions.length) return false;
        for(int i=0;i<a.exceptions.length;i++) {
            ABCException x=a.exceptions[i],y=b.exceptions[i];
            if(x.start!=y.start||x.end!=y.end||x.target!=y.target||x.type_index!=y.type_index||x.name_index!=y.name_index)return false;
        }
        return true;
    }
    public static void main(String[] args)throws Exception {
        Map<String,ABC> before=load(args[0]),after=load(args[1]);
        List<String> changed=new ArrayList<>(),helpers=new ArrayList<>();int count=0,added=0;
        for(Map.Entry<String,ABC> entry:before.entrySet()) {
            ABC a=entry.getValue(),b=after.get(entry.getKey());
            if(b==null||a.bodies.size()!=b.bodies.size())throw new IllegalStateException("body inventory: "+entry.getKey());
            count+=a.bodies.size();
            for(int i=0;i<a.bodies.size();i++)if(!same(a.bodies.get(i),b.bodies.get(i)))changed.add(entry.getKey()+":"+i);
        }
        for(Map.Entry<String,ABC> entry:after.entrySet())if(!before.containsKey(entry.getKey())) {
            if(!entry.getKey().startsWith("cn/optimize/")&&!entry.getKey().startsWith("cn.optimize."))throw new IllegalStateException("helper namespace");
            helpers.add(entry.getKey());added+=entry.getValue().bodies.size();
        }
        Collections.sort(changed);Collections.sort(helpers);
        System.out.println("method_bodies="+count);System.out.println("changed="+String.join(",",changed));
        System.out.println("helpers="+String.join(",",helpers));System.out.println("added_bodies="+added);
    }
}
