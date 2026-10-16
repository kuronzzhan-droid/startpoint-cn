package cn.mod {
    /** Maps the Rush activity selected by the loading task to its own party set. */
    public class IndependentRushParty {
        private static var _eventId:int = 0;

        public static function setEventId(value:int):void {
            _eventId = value;
        }

        public static function getEventId():int {
            return _eventId;
        }

        public static function category():int {
            if (_eventId == 700099) return 5;
            if (_eventId == 700100) return 6;
            if (_eventId == 700098) return 7;
            return 4;
        }
    }
}
