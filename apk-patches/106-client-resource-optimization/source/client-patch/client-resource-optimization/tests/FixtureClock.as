package {import flash.utils.getTimer;public class FixtureClock {public static function now():FixtureClock {return new FixtureClock();}public function getTime():Number{return getTimer();}}}
