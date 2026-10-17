package cn.startpoint;

import android.content.pm.ApplicationInfo;
import android.os.Process;
import android.util.Log;
import java.io.*;
import java.nio.channels.FileLock;

/** Runs before the packed AIR loader. Never visits Local Store, files or preferences. */
public final class StartupCache {
    private static final String TAG = "SPStartupCache";
    static final long PERIOD_MS = 600000L;
    private static volatile boolean periodicStarted;
    private static volatile String currentPhase = "not-started";

    public static void run(ApplicationInfo info) {
        try {
            if (info == null || !"com.leiting.wf".equals(info.packageName)
                    || info.uid != Process.myUid()) return;
            clean(new File(info.dataDir), new File(info.sourceDir), BuildIdentity.ID);
            startPeriodic(new File(info.dataDir));
        } catch (Exception error) {
            // A transient cleanup failure must not prevent starting the game; retry next launch.
            Log.w(TAG, "cleanup deferred: " + error.getClass().getSimpleName());
        }
    }

    private static void startPeriodic(File dataDir) {
        synchronized (StartupCache.class) {
            if (periodicStarted) return;
            periodicStarted = true;
        }
        writeDiag(dataDir, "stage=scheduled\nperiod_ms=" + PERIOD_MS + "\n");
        Thread worker = new Thread(new Periodic(dataDir), "sp-cache-periodic");
        worker.setDaemon(true);
        worker.start();
    }

    private static final class Periodic implements Runnable {
        private final File dataDir;

        Periodic(File dataDir) {
            this.dataDir = dataDir;
        }

        @Override
        public void run() {
            for (;;) {
                try {
                    Thread.sleep(PERIOD_MS);
                    periodicPurge(dataDir);
                } catch (InterruptedException stopped) {
                    return;
                } catch (Throwable error) {
                    Log.w(TAG, "periodic cleanup deferred: " + error.getClass().getSimpleName());
                }
            }
        }
    }

    // The AIR process owns these extracted files until it exits. Never delete them live.
    static void periodicPurge(File dataDir) {
        try {
            File root = dataDir.getCanonicalFile();
            File stateDir = inside(root, "no_backup");
            if (!stateDir.isDirectory() && !stateDir.mkdir()) throw new IOException("state directory");
            File pending = inside(stateDir, "sp-startup-cache.pending");
            if (!pending.isFile()) {
                try (FileOutputStream output = new FileOutputStream(pending)) {
                    output.write("v1\n".getBytes("UTF-8"));
                    output.getFD().sync();
                }
            }
            currentPhase = "deferred-until-next-launch";
            writeDiag(root, "stage=deferred-until-next-launch\nperiod_ms=" + PERIOD_MS
                    + "\nlive_cache_deleted=false\n");
            Log.i(TAG, "AIR cache cleanup deferred until next process startup");
        } catch (Exception error) {
            Log.w(TAG, "cache cleanup scheduling failed: " + error.getClass().getSimpleName());
        }
    }

    private static void writeDiag(File dataDir, String record) {
        try {
            File root = dataDir.getCanonicalFile();
            File target = inside(root, "sp-cache-periodic.diag");
            byte[] bytes = record.getBytes("UTF-8");
            if (bytes.length > 4096) {
                byte[] bounded = new byte[4096];
                System.arraycopy(bytes, 0, bounded, 0, bounded.length);
                bytes = bounded;
            }
            try (FileOutputStream output = new FileOutputStream(target, false)) {
                output.write(bytes);
                output.getFD().sync();
            }
        } catch (Throwable error) {
            Log.w(TAG, "periodic diagnostic write failed: " + error.getClass().getSimpleName());
        }
    }

    static void clean(File data, File apk, String build) throws IOException {
        File root = data.getCanonicalFile();
        if (!root.isDirectory() || !"com.leiting.wf".equals(root.getName()) || !apk.isFile())
            throw new IOException("invalid application directories");
        File stateDir = inside(root, "no_backup");
        if (!stateDir.isDirectory() && !stateDir.mkdir()) throw new IOException("state directory");
        // PackageInstaller replaces the APK path and/or mtime even for a same-version cover install.
        // The payload ID also handles different SWFs with the same public application version.
        String stamp = "v1\n" + build + "\n" + apk.getAbsolutePath() + "\n"
                + apk.lastModified() + "\n" + apk.length() + "\n";
        File lockFile = inside(stateDir, "sp-startup-cache.lock");
        try (RandomAccessFile lock = new RandomAccessFile(lockFile, "rw");
             FileLock held = lock.getChannel().lock()) {
            File marker = inside(stateDir, "sp-startup-cache.state");
            File pending = inside(stateDir, "sp-startup-cache.pending");
            if (stamp.equals(read(marker)) && !pending.isFile()) {
                Log.i(TAG, "unchanged installation; skipped");
                return;
            }
            File cache = inside(root, "cache");
            // Exact AIR startup allowlist. Downloaded assets live outside this directory.
            boolean cleared = remove(inside(cache, "app"));
            cleared = remove(inside(cache, ".AIR")) && cleared;
            if (!cleared) throw new IOException("incomplete cleanup");
            File next = inside(stateDir, "sp-startup-cache.next");
            try (FileOutputStream output = new FileOutputStream(next)) {
                output.write(stamp.getBytes("UTF-8"));
                output.getFD().sync();
            }
            if (!next.renameTo(marker)) {
                // Some file systems do not replace an existing destination. A missing
                // marker only causes a safe cleanup retry after an interrupted commit.
                if (!marker.isFile() || !marker.delete() || !next.renameTo(marker))
                    throw new IOException("commit marker");
            }
            if (pending.exists() && !pending.delete()) throw new IOException("pending marker removal");
            Log.i(TAG, "startup cache cleared before AIR loader");
        }
    }

    private static String read(File file) throws IOException {
        if (!file.isFile() || file.length() > 4096) return "";
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] bytes = new byte[512];
            int count;
            while ((count = input.read(bytes)) != -1) {
                data.write(bytes, 0, count);
                if (data.size() > 4096) return "";
            }
        }
        return data.toString("UTF-8");
    }

    private static File inside(File parent, String name) throws IOException {
        File file = new File(parent, name).getAbsoluteFile();
        if (!file.getCanonicalFile().equals(file)) throw new IOException("symlink outside allowlist");
        return file;
    }

    private static boolean remove(File file) throws IOException {
        if (!file.exists()) return true;
        if (!file.getCanonicalFile().equals(file.getAbsoluteFile()))
            throw new IOException("symlink inside cache");
        boolean done = true;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) return false;
            for (File child : children) done = remove(child) && done;
        }
        return done && file.delete();
    }
}
