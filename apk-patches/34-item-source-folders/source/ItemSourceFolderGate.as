package cn.ui {
    public final class ItemSourceFolderGate {
        // Preserve the ordinary/side-story result. Folder membership supplements
        // the acquisition search only; it must not add duplicate event banners.
        public static function allow(listed:Boolean, repository:Object, eventId:Object, now:Number):Boolean {
            if (listed) return true;
            var membership:Object = repository.getFolderIdFromEventId(eventId);
            if (membership == null || membership.index != 0) return false;
            var folder:Object = repository.getEventFolder(int(membership.params[0]));
            if (folder == null || !folder.isUnlocked()) return false;
            var event:Object = repository.getEvent(eventId);
            return event != null && event.isWithinPeriod(now);
        }
    }
}
