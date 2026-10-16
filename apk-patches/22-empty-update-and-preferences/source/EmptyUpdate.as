package cn.asset {
    /** Compatibility with older servers that encode no tasks as Some(empty). */
    public final class EmptyUpdate {
        public static function normalize(response:Object):void {
            response=response && response.rawData ? response.rawData.data : null;
            if(!response || !response.info || response.info.is_initial) return;
            var current:String=String(response.info.client_asset_version);
            if(!/^\d+\.\d+\.\d+$/.test(current) || current!=String(response.info.target_asset_version)) return;
            if(!empty(response.full, false) || !empty(response.diff, true)) return;
            response.full=null;
            response.diff=null;
        }
        private static function empty(value:Object, diff:Boolean):Boolean {
            if(value==null) return true;
            if(!diff) return value && value.archive is Array && value.archive.length==0;
            if(!(value is Array)) return false;
            for each(var group:Object in value) {
                if(!group || !(group.archive is Array) || group.archive.length!=0) return false;
            }
            return true;
        }
    }
}
