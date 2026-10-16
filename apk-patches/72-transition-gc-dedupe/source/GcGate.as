package cn.loading {
    import flash.utils.getTimer;

    /** v28: collapses back-to-back explicit System.gc() calls during one scene transition.
     *  skip() returns true when an explicit GC already ran within windowMs (caller then skips its own). */
    public final class GcGate {
        public static var windowMs:int = 1500;
        public static var enabled:Boolean = true;
        public static var skipped:int = 0;
        public static var ran:int = 0;
        private static var last:int = -1000000;

        public static function skip():Boolean {
            if (!enabled) return false;
            var now:int = getTimer();
            if (now - last < windowMs) { skipped++; return true; }
            last = now; ran++;
            return false;
        }

        /** tests only */
        public static function reset():void { last = -1000000; skipped = 0; ran = 0; }
    }
}
