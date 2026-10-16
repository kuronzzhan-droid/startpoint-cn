package cn.rules {
    /** Opt-in quest resistance. Random selection belongs to the content builder. */
    public final class QuestElementResistance {
        private static const PREFIX:String = "【属性伤害：";
        private static const ELEMENTS:String = "火水雷风光暗";

        public static function parse(text:String):Array {
            if (text == null || text.indexOf(PREFIX) < 0) return [];
            var start:int = text.indexOf(PREFIX);
            var end:int = text.indexOf("】", start);
            if (end < 0 || text.indexOf(PREFIX, start + PREFIX.length) >= 0)
                throw new ArgumentError("Invalid quest element resistance block");
            var tokens:Array = text.substring(start + PREFIX.length, end).split(";");
            var rows:Array = [];
            var seen:Object = {};
            var bans:int = 0;
            if (tokens.length < 1 || tokens.length > 6) throw new ArgumentError("Invalid element count");
            for each (var token:String in tokens) {
                var match:Object = /^([火水雷风光暗])=([0-9]+(?:\.[0-9]+)?)%$/.exec(token);
                if (match == null || seen[match[1]]) throw new ArgumentError("Invalid or duplicate element");
                seen[match[1]] = true;
                var percent:Number = Number(match[2]);
                if (!isFinite(percent) || percent < 0.0001 || percent > 100)
                    throw new ArgumentError("Invalid remaining damage percentage");
                if (percent <= 1) bans++;
                rows.push({element:ELEMENTS.indexOf(match[1]) + 1, strength:100 / percent - 1});
            }
            if (bans == 6) throw new ArgumentError("At least one element must remain available");
            return rows;
        }

        public static function apply(values:Object, original:Array, content:Object, decimal:Object):Array {
            // Several special modes project their quest data and have no subtitle.
            if (values == null || !("sub_name" in values) || values.sub_name == null) return original;
            try {
                var subtitle:Object = values.sub_name;
                var text:String;
                if (subtitle is String) text = String(subtitle);
                else if (subtitle.index === 0 && subtitle.params is Array && subtitle.params.length == 1)
                    text = String(subtitle.params[0]);
                else return original;
                var rows:Array = parse(text);
                if (rows.length == 0) return original;
                var output:Array = original.concat();
                var totals:Array = [0, 0, 0, 0, 0, 0, 0];
                var unit:Number = decimal.fromFloat(1);
                var i:int;
                for each (var old:Object in original) {
                    if (old != null && old.index === 7) {
                        var target:int = int(old.params[0]);
                        if (target == 0) for (i = 1; i <= 6; i++) totals[i] += Number(old.params[1]) / unit;
                        else if (target >= 1 && target <= 6) totals[target] += Number(old.params[1]) / unit;
                    }
                }
                for each (var row:Object in rows) {
                    totals[row.element] += row.strength;
                    if (row.strength > 0)
                        output.push(content.ElementResistance(row.element, decimal.fromFloat(row.strength)));
                }
                var bans:int = 0;
                for (i = 1; i <= 6; i++) if (totals[i] >= 99 - 0.000001) bans++;
                if (bans == 6) throw new ArgumentError("Combined quest conditions ban all elements");
                return output;
            } catch (error:*) {
                // Broken opt-in content must not turn an otherwise valid quest into C7050.
                // Publication must validate parse() and combined resistance before release.
                trace("QuestElementResistance rejected quest configuration: " + String(error));
                return original;
            }
        }
    }
}
