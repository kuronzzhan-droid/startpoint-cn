package cn.ui {
    import flash.utils.getDefinitionByName;

    /** Presentation only: never writes quest values or combat conditions. */
    public final class AbyssDetails {
        public static const BUTTON:int = 268435456;

        public static function isAbyss(quest:Object):Boolean {
            return quest != null && "id" in quest && String(quest.id).match(/^7000990[0-9]{2}$/) != null;
        }

        public static function rawSubtitle(quest:Object):String {
            var value:Object = quest.values.sub_name;
            if (value is String) return String(value);
            return value != null && value.index == 0 ? String(value.params[0]) : "";
        }

        public static function elements(raw:String):Array {
            var match:Object = /【属性伤害：([^】]*)】/.exec(raw);
            var result:Array = [];
            if (match == null) return result;
            for each (var entry:String in String(match[1]).split(";")) {
                var item:Object = /^([火水雷风光暗])=([0-9.]+)%$/.exec(entry);
                if (item != null && isFinite(Number(item[2])))
                    result.push({name:String(item[1]), percent:Number(item[2])});
            }
            return result;
        }

        public static function summaryForQuest(raw:String, quest:Object):String {
            if (!isAbyss(quest)) return raw;
            var names:Array = [];
            for each (var item:Object in elements(raw))
                if (item.percent <= 1) names.push(item.name);
            if (names.length == 0) return "关卡说明见详情";
            var result:String = "封锁：" + names.join("·");
            var pf:Object = /PF抗性额外([+-]?[0-9.]+)个百分点/.exec(raw);
            if (pf != null) result += "　PF " + pf[1] + "%";
            return result;
        }

        public static function escape(value:String):String {
            return value.split("&").join("&amp;").split("<").join("&lt;")
                .split(">").join("&gt;").split('"').join("&quot;").split("'").join("&apos;");
        }

        public static function detailsHtml(raw:String):String {
            var html:String = "<html><body><h2>属性封锁</h2>";
            var el:Array = elements(raw);
            if (el.length == 0) html += "<p>本关未配置属性伤害调整。</p>";
            for each (var element:Object in el)
                html += "<p>" + element.name + "属性：伤害降至 " + element.percent + "%</p>";
            var metadata:Object = /【关卡资料：([^】]*)】/.exec(raw);
            if (metadata != null) {
                try {
                    var data:Object = JSON.parse(decodeURIComponent(String(metadata[1])));
                    html += "<h2>敌人与血量</h2><p>" + escape(String(data.enemy)) + "</p><p>" + escape(String(data.hp)) + "</p>";
                } catch (error:Error) {
                    html += "<p>本关敌人与血量说明暂不可用。</p>";
                }
            }
            var text:String = raw.replace(/【属性伤害：[^】]*】/g, "").replace(/【关卡资料：[^】]*】/g, "");
            // The complete source prose stays visible, apart from the duplicate guarantee.
            var parts:Array = [];
            var start:int = 0, next:int;
            while ((next = text.indexOf("「", start + 1)) >= 0) {
                parts.push(text.substring(start, next));
                start = next;
            }
            parts.push(text.substring(start));
            var curses:Array = [], domains:Array = [];
            for each (var part:String in parts) {
                part = part.replace(/^\s+|\s+$/g, "");
                if (part == "" || part.indexOf("「属性封锁保底」") == 0) continue;
                if (part.indexOf("「深渊法阵」") == 0) domains.push(part);
                else curses.push(part);
            }
            html += "<h2>诅咒与关卡效果</h2>";
            for each (part in curses) html += "<p>" + escape(part) + "</p>";
            html += "<h2>额外领域</h2>";
            if (domains.length == 0) html += "<p>本关没有额外领域；敌人自身机制仍按原关卡生效。</p>";
            for each (part in domains) html += "<p>" + escape(part) + "</p>";
            return html + "</body></html>";
        }

        public static function attach(panel:Object):void {
            var scene:Object = panel.peek;
            if (!("targetQuest" in scene) || !isAbyss(scene.targetQuest)) return;
            if (panel.buttonGroupView.exists(BUTTON)) return;
            var top:Object = panel.topPanel;
            var title:Object = top.getText("questTitle", null);
            var subtitle:Object = top.getText("questNumber", null);
            var continuation:Object = top.getText("continue_count", null);
            var unit:Number = Number(title.get_format().size) / 40;
            var format:Object = subtitle.get_format().clone();
            format.size = 28 * unit;
            subtitle.set_format(format);
            subtitle.set_autoScale(false);
            subtitle.set_text(summaryForQuest(rawSubtitle(scene.targetQuest), scene.targetQuest));

            var SpriteClass:Class = getDefinitionByName("starling.display.Sprite") as Class;
            var CanvasClass:Class = getDefinitionByName("starling.display.Canvas") as Class;
            var PolygonClass:Class = getDefinitionByName("starling.geom.Polygon") as Class;
            var button:Object = new SpriteClass();
            button.name = "cn_abyss_details";
            var width:Number = 200 * unit, height:Number = 60 * unit;
            button.x = title.x + title.get_textWidth() - width;
            button.y = continuation.y - 10 * unit;
            // One convex mesh; no texture cache or overlapping fills.
            var radius:Number = 12 * unit;
            var vertices:Array = [];
            for (var corner:int = 0; corner < 4; corner++) {
                var cx:Number = corner == 0 || corner == 1 ? width - radius : radius;
                var cy:Number = corner == 1 || corner == 2 ? height - radius : radius;
                for (var step:int = 0; step <= 8; step++) {
                    var angle:Number = (-90 + corner * 90 + step * 90 / 8) * Math.PI / 180;
                    vertices.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
                }
            }
            var background:Object = new CanvasClass();
            background.beginFill(0x21c4bb);
            background.drawPolygon(new PolygonClass(vertices));
            background.endFill();
            button.addChild(background);
            var label:Object = title.clone();
            label.x = 0; label.y = 0; label.scaleX = 1; label.scaleY = 1;
            label.set_textWidth(width); label.set_textHeight(height);
            format = title.get_format().clone();
            format.size = 32 * unit; format.color = 0xffffff;
            format.horizontalAlign = "center"; format.verticalAlign = "center";
            label.set_format(format); label.set_autoScale(false);
            label.set_text("关卡详情"); label.touchable = false;
            button.addChild(label);
            top.addChild(button);
            var group:Object = panel.buttonGroupView.peek;
            group.append(BUTTON);
            group.addClickHandler(function(id:int):void {
                if (id == BUTTON) openDetails(scene);
            });
            var behavior:Object = getDefinitionByName("pinball.ui.component.button.behavior.ButtonAnimationBehaviorKind");
            panel.buttonGroupView.registerDisplayObjectAsButton(BUTTON, button, behavior.Scale);
        }

        public static function openDetails(scene:Object):void {
            var records:Object = getDefinitionByName("cn.ui.AbyssRecordDetails");
            records.open(scene, detailsHtml(rawSubtitle(scene.targetQuest)));
        }
    }
}
