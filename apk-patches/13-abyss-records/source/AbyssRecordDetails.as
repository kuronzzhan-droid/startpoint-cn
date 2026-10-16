package cn.ui {
    import flash.events.Event;
    import flash.events.IOErrorEvent;
    import flash.events.SecurityErrorEvent;
    import flash.events.TimerEvent;
    import flash.net.URLLoader;
    import flash.net.URLRequest;
    import flash.utils.Dictionary;
    import flash.utils.Timer;
    import flash.utils.getDefinitionByName;

    /** Open-time snapshot, never writes quest data or starts a polling loop. */
    public final class AbyssRecordDetails {
        private static var cache:Object = {}, cacheScope:String = "";
        private static var pending:Dictionary = new Dictionary(true);

        public static function formatTime(ms:Number):String {
            var minutes:int = Math.floor(ms / 60000);
            var seconds:int = Math.floor(ms / 1000) % 60;
            var millis:int = ms % 1000;
            return (minutes < 10 ? "0" : "") + minutes + ":" + (seconds < 10 ? "0" : "") + seconds
                + "." + (millis < 100 ? "0" : "") + (millis < 10 ? "0" : "") + millis;
        }

        public static function responseText(data:Object, questId:int):String {
            if (!data || Number(data.quest_id) != questId) return "暂时无法获取";
            if (data.status == "update_required") return "请更新资源后查看";
            if (data.status != "ok" || !/^[a-f0-9]{64}$/.test(String(data.revision))) return "暂时无法获取";
            if (data.best_time_ms === null) return "本期暂无通关纪录";
            var ms:Number = Number(data.best_time_ms);
            if (typeof data.best_time_ms != "number" || !isFinite(ms) || ms <= 0
                || ms != Math.floor(ms) || ms > 2147483647) return "暂时无法获取";
            var name:String = typeof data.holder_name == "string" ? String(data.holder_name) : "";
            name = name.replace(/[\x00-\x1f\x7f]/g, " ").replace(/^\s+|\s+$/g, "");
            if (name == "") name = "未知玩家";
            // Nicknames are text inside a rich-text document, never markup.
            name = name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
            return formatTime(ms) + "<br/>纪录保持者：" + name;
        }

        public static function open(scene:Object, html:String):void {
            if (pending[scene]) return;
            var questId:int = int(scene.targetQuest.id);
            if (questId < 700099001 || questId > 700099098) { show(scene, html, ""); return; }
            var origin:String, version:String;
            try {
                origin = String(scene.devConfig.getServerApiPath()).match(/^https?:\/\/[^\/]+/)[0];
                var localVersion:Object = scene.assetDownload.getResourceVersion();
                if (localVersion == null || localVersion.index != 0) throw new Error("version unavailable");
                version = String(localVersion.params[0]);
                if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("invalid version");
            } catch (error:*) { show(scene, html, "暂时无法获取"); return; }
            var scope:String = origin + "/" + version;
            if (scope != cacheScope) { cache = {}; cacheScope = scope; }
            var hit:Object = cache[questId];
            if (hit && new Date().time - hit.at < 10000) { show(scene, html, hit.text); return; }
            pending[scene] = true;
            var loader:URLLoader = new URLLoader();
            var timer:Timer = new Timer(1800, 1);
            var finished:Boolean = false;
            var finish:Function = function(text:String, cacheable:Boolean):void {
                if (finished) return;
                finished = true; delete pending[scene]; timer.stop();
                timer.removeEventListener(TimerEvent.TIMER_COMPLETE, failed);
                loader.removeEventListener(Event.COMPLETE, complete);
                loader.removeEventListener(IOErrorEvent.IO_ERROR, failed);
                loader.removeEventListener(SecurityErrorEvent.SECURITY_ERROR, failed);
                try { loader.close(); } catch (ignored:*) {}
                if (cacheable && scope == cacheScope) cache[questId] = {at:new Date().time, text:text};
                // Navigation during the request must not reopen a disposed scene.
                if (!scene.gear.isDisposed() && int(scene.targetQuest.id) == questId
                    && !scene.logicStatus.isDuringChangingScene) show(scene, html, text);
            };
            var complete:Function = function(event:Event):void {
                try {
                    var text:String = responseText(JSON.parse(String(loader.data)), questId);
                    finish(text, text != "暂时无法获取");
                } catch (error:*) { finish("暂时无法获取", false); }
            };
            var failed:Function = function(event:Event):void { finish("暂时无法获取", false); };
            loader.addEventListener(Event.COMPLETE, complete);
            loader.addEventListener(IOErrorEvent.IO_ERROR, failed);
            loader.addEventListener(SecurityErrorEvent.SECURITY_ERROR, failed);
            timer.addEventListener(TimerEvent.TIMER_COMPLETE, failed); timer.start();
            try { loader.load(new URLRequest(origin + "/abyss-records/" + questId + "?res_ver=" + encodeURIComponent(version))); }
            catch (error:*) { finish("暂时无法获取", false); }
        }

        private static function show(scene:Object, html:String, text:String):void {
            if (text != "") html = html.replace("<body>", "<body><h2>本期全服最快</h2><p>" + text + "</p>");
            var DialogClass:Class = getDefinitionByName("pinball.dialog.richTextDialog.RichTextDialog") as Class;
            var kind:Object = getDefinitionByName("pinball.dialog.richTextDialog.RichTextAssetKind");
            var option:Object = getDefinitionByName("haxe.ds.Option");
            scene.openDialog(new DialogClass("关卡详情", kind.Text(html), false, option.None, function():void {}));
        }
    }
}
