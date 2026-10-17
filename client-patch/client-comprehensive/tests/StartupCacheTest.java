package cn.startpoint;
import java.io.*;
import java.nio.file.*;
import java.util.*;

public final class StartupCacheTest {
    static int assertions;
    static void put(File f) throws Exception { f.getParentFile().mkdirs(); Files.write(f.toPath(),new byte[]{1,2,3}); }
    static void check(boolean value) { assertions++; if(!value) throw new AssertionError("assertion "+assertions); }
    public static void main(String[] args) throws Exception {
        File base=new File(args[0]).getCanonicalFile();
        check(!base.exists());check(base.mkdirs());
        File root=new File(base,"com.leiting.wf");check(root.mkdir());
        File apk=new File(base,"base.apk");put(apk);
        File cached=new File(root,"cache/app/old/assets/game.swf"), air=new File(root,"cache/.AIR/cookies");
        File pending=new File(root,"no_backup/sp-startup-cache.pending");
        File[] kept={new File(root,"com.leiting.wf/Local Store/asset/data"),
            new File(root,"com.leiting.wf/Local Store/custom_Release_Android/application_option"),
            new File(root,"files/account"),new File(root,"shared_prefs/login"),new File(root,"cache/oat_primary/native")};
        for(File f:kept)put(f);put(cached);put(air);
        StartupCache.clean(root,apk,"payload-1");check(!cached.exists()&&!air.exists());
        for(File f:kept)check(Arrays.equals(Files.readAllBytes(f.toPath()),new byte[]{1,2,3}));
        put(cached);StartupCache.clean(root,apk,"payload-1");check(cached.exists());
        check(apk.setLastModified(apk.lastModified()+10000));
        StartupCache.clean(root,apk,"payload-1");check(!cached.exists());
        put(cached);StartupCache.clean(root,apk,"payload-2");check(!cached.exists());
        File next=new File(root,"no_backup/sp-startup-cache.next");check(next.mkdir());
        boolean failed=false;try{StartupCache.clean(root,apk,"payload-3");}catch(IOException expected){failed=true;}
        check(failed);check(next.delete());put(cached);
        StartupCache.clean(root,apk,"payload-3");check(!cached.exists());
        // Runtime schedule leaves every open/readable cache path intact.
        put(cached);put(air);
        try(FileInputStream held=new FileInputStream(cached)) {
            StartupCache.periodicPurge(root);
            check(cached.exists()&&air.exists()&&held.read()==1&&pending.isFile());
        }
        byte[] marker=Files.readAllBytes(pending.toPath());
        StartupCache.periodicPurge(root);
        check(Arrays.equals(marker,Files.readAllBytes(pending.toPath())));
        check(cached.exists()&&air.exists());
        String diagnostic=new String(Files.readAllBytes(new File(root,"sp-cache-periodic.diag").toPath()),"UTF-8");
        check(diagnostic.contains("stage=deferred-until-next-launch")&&diagnostic.contains("live_cache_deleted=false"));
        check(StartupCache.PERIOD_MS==600000L);
        // Unchanged installation still honors a pending request at next cold start.
        StartupCache.clean(root,apk,"payload-3");
        check(!cached.exists()&&!air.exists()&&!pending.exists());
        put(cached);StartupCache.clean(root,apk,"payload-3");check(cached.exists());
        // Failed marker commit keeps pending work for retry.
        StartupCache.periodicPurge(root);check(next.mkdir());
        failed=false;try{StartupCache.clean(root,apk,"payload-3");}catch(IOException expected){failed=true;}
        check(failed&&pending.exists());check(next.delete());put(cached);
        StartupCache.clean(root,apk,"payload-3");check(!pending.exists()&&!cached.exists());
        for(File f:kept)check(Arrays.equals(Files.readAllBytes(f.toPath()),new byte[]{1,2,3}));
        System.out.println("PASS assertions="+assertions+" install/relaunch/reinstall/deferred cleanup/idempotence/retry/protected data");
    }
}
