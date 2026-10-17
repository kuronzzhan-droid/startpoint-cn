package pinball.common.math._Decimal {
    public class Decimal_Impl_ {
        public static var RESOLTION:Number=100000;
        public static function fromFloat(value:Number):Number { return Math.round(value * RESOLTION); }
    }
}
