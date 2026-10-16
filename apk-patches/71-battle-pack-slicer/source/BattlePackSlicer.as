package cn.loading {
    import flash.events.TimerEvent;
    import flash.filesystem.File;
    import flash.filesystem.FileMode;
    import flash.filesystem.FileStream;
    import flash.geom.Rectangle;
    import flash.utils.Timer;
    import flash.utils.getDefinitionByName;
    import flash.utils.getTimer;

    /**
     * v27: frame-sliced battle atlas composition for BattleStartProductionViewService.prepare.
     *
     * prepare() calls start(svc, "layer0_" + gachaId) right after autoDistribute().  When start() returns
     * true the original synchronous setupTextureAtlas x2 + completeHandler() are skipped and this class
     * does the same work spread over 16 ms timer ticks (about budgetMs of work per tick):
     *   pack (MaxRects, one rectangle at a time; "size exceeded" spills the rectangle to the next page)
     *   -> build RenderTexture + TextureAtlas per page -> draw sub images in drawBundled batches
     *   -> ColorChanger in batches of sheets -> register every page + RestoreContext -> completeHandler().
     * Page 1 keeps the official name (so the official "already registered" gate still works); further
     * pages are named "<name>#2", "#3"...  Sub textures are registered by name, so every consumer that
     * looks them up by name finds them on whichever page they landed.
     * Any unexpected error before registration falls back to the original synchronous path (which in
     * v26+ also carries the overflow-spill fallback).  Game classes are only reached by name.
     */
    public final class BattlePackSlicer {
        public static var enabled:Boolean = true;
        public static var budgetMs:int = 10;
        public static var intervalMs:int = 16;
        public static var pageSize:int = 4096;
        public static var drawsPerTick:int = 48;
        public static var colorSheetsPerBatch:int = 4;
        /** Overridable class lookup (tests inject fakes). */
        public static var resolver:Function = null;
        /** Last job summary for diagnostics/tests. */
        public static var last:Object = null;

        private static var running:Array = [];

        private var svc:*;
        private var asset:*;
        private var layers:Array;
        private var phase:String = "pack";
        private var layerAt:int = 0;
        private var page:Object = null;
        private var pages:Array = [];
        private var drawPage:int = 0;
        private var drawAt:int = 0;
        private var colorPage:int = 0;
        private var colorAt:int = 0;
        private var lost:Boolean = false;
        private var timer:Timer;
        private var stat:Object;
        private var reported:Number = 0;
        private var registering:Boolean = false;

        private static function cls(name:String):Class {
            return Class(resolver != null ? resolver(name) : getDefinitionByName(name));
        }

        public static function start(svc:*, name0:String):Boolean {
            try {
                if (!enabled || svc == null || svc.gachaId != null) return false;
                var dev:* = svc.devConfig;
                if (dev != null && (dev.opaqueBackgroundRenderTexture || dev.repalceAutoPackingTexture || dev.previewTexturePacking)) return false;
                var job:BattlePackSlicer = new BattlePackSlicer(svc, name0);
                running.push(job);
                job.timer.start();
                return true;
            } catch (e:*) {
                last = {started: false, error: String(e)};
            }
            return false;
        }

        public function BattlePackSlicer(svc:*, name0:String) {
            this.svc = svc;
            asset = svc.view.asset;
            stat = {started: true, ticks: 0, maxTickMs: 0, totalMs: 0, workMs: 0, items: 0, pages: [], spilled: 0, lost: 0,
                    fallback: false, aborted: false, completed: false, error: null, t0: getTimer()};
            last = stat;
            var tl:int = getTimer();
            layers = [layer(name0, svc.packingTarget0, 0xFF0000),
                      layer("layer1_" + String(svc.gachaId), svc.packingTarget1, 0xFFFF00)];
            stat.collectMs = getTimer() - tl;
            stat.items = layers[0].items.length + layers[1].items.length;
            timer = new Timer(intervalMs);
            timer.addEventListener(TimerEvent.TIMER, tick);
        }

        private function layer(name:String, target:Object, color:uint):Object {
            var items:Array = [];
            var byName:Object = {};
            for each (var kind:String in ["image", "dynamicTexture", "spriteSheet"]) {
                var list:Array = target[kind] as Array;
                if (list == null) continue;
                for (var i:int = 0; i < list.length; i++) {
                    var n:String = list[i];
                    var tex:* = asset.getTexture(n);
                    var it:Object = {name: n, kind: kind, texture: tex,
                                     w: int(Math.ceil(tex.frameWidth)), h: int(Math.ceil(tex.frameHeight))};
                    items.push(it);
                    byName["$" + n] = it;
                }
            }
            return {name: name, target: target, color: color, items: items, byName: byName, pages: [], todo: items};
        }

        private function newPage(L:Object, items:Array):void {
            var P:Class = cls("packing.core.MaxRectsPacker");
            var packer:* = new P(pageSize, pageSize, 2);
            for (var i:int = 0; i < items.length; i++) packer.addRectangle(items[i].name, items[i].w, items[i].h);
            packer.pendingRectangles.sort(cls("packing.core._MaxRectsPacker.PendingRectangle").compareArea);
            var index:int = L.pages.length;
            page = {layer: L, name: index == 0 ? L.name : L.name + "#" + (index + 1), packer: packer,
                    placed: [], overflow: [], rt: null, atlas: null, color: L.color};
            L.pages.push(page);
        }

        private function tick(event:TimerEvent = null):void {
            var t0:int = getTimer();
            stat.ticks++;
            try {
                if (svc.assetCache == null || svc.assetCache.disposed) { abort(); return; }
                var S:* = cls("starling.core.Starling");
                if (S.current != null && !S.current.contextValid) return;
                if (lost) {
                    if (asset.isRestoring()) return;
                    lost = false; stat.lost++;
                    for each (var p:Object in pages) p.rt.clear();
                    drawPage = 0; drawAt = 0; colorPage = 0; colorAt = 0; phase = "draw";
                }
                var deadline:int = t0 + budgetMs;
                if (phase == "pack") packStep(deadline);
                else if (phase == "draw") drawStep(deadline);
                else if (phase == "color") colorStep(deadline);
                if (phase == "finish") { finish(); return; }
                progress();
            } catch (e:*) {
                if (registering) throw e;   // same failure surface as the original synchronous registerTextureAtlas
                fallback(e);
            } finally {
                var dt:int = getTimer() - t0;
                stat.workMs += dt;
                if (dt > stat.maxTickMs) stat.maxTickMs = dt;
            }
        }

        private function progress():void {
            var f:Number = phase == "pack" ? 0.1 : phase == "draw" ? 0.4 + 0.4 * drawPage / Math.max(1, pages.length)
                         : 0.8 + 0.15 * colorPage / Math.max(1, pages.length);
            if (f <= reported) return;   // monotonic, also across a context-loss redraw
            reported = f;
            try { svc.progressHandler(f); } catch (e:*) {}
        }

        private function packStep(deadline:int):void {
            do {
                if (page == null) {
                    if (layerAt >= layers.length) { build(); phase = "draw"; return; }
                    var L:Object = layers[layerAt];
                    newPage(L, L.todo);
                }
                var packer:* = page.packer;
                var pending:Array = packer.pendingRectangles;
                while (pending.length > 0) {
                    var pr:* = pending.pop();
                    try {
                        packer.packRectangle(pr);
                        page.placed.push(page.layer.byName["$" + pr.name]);
                    } catch (e:*) {
                        if (String(e).indexOf("size exceeded") < 0) throw e;
                        page.overflow.push(page.layer.byName["$" + pr.name]);
                    }
                    if (getTimer() >= deadline) return;
                }
                if (page.overflow.length > 0) {
                    if (page.placed.length == 0) throw new Error("BattlePackSlicer: sub texture larger than a page");
                    stat.spilled += page.overflow.length;
                    page.layer.todo = page.overflow;
                    page = null;
                    newPage(layers[layerAt], layers[layerAt].todo);
                } else {
                    layerAt++;
                    page = null;
                }
            } while (getTimer() < deadline);
        }

        private function build():void {
            var RT:Class = cls("starling.textures.RenderTexture");
            var TA:Class = cls("starling.textures.TextureAtlas");
            for each (var L:Object in layers) {
                for each (var p:Object in L.pages) {
                    var w:int = 0, h:int = 0, i:int;
                    var rects:Array = [];
                    for (i = 0; i < p.placed.length; i++) {
                        var r:* = p.packer.getPackedRectangle(p.placed[i].name);
                        rects.push(r);
                        if (r.x + r.width > w) w = r.x + r.width;
                        if (r.y + r.height > h) h = r.y + r.height;
                    }
                    p.rects = rects;
                    p.rt = new RT(Math.max(1, w), Math.max(1, h), true, 1);
                    p.atlas = new TA(p.rt);
                    for (i = 0; i < rects.length; i++)
                        p.atlas.addRegion(p.placed[i].name, new Rectangle(rects[i].x, rects[i].y, rects[i].width, rects[i].height), null, rects[i].rotated);
                    p.rt.root.onRestore = markLost;
                    pages.push(p);
                    stat.pages.push({name: p.name, w: w, h: h, n: rects.length});
                }
            }
        }

        private function markLost():void { lost = true; }

        private function drawStep(deadline:int):void {
            var SP:Class = cls("starling.display.Sprite");
            while (drawPage < pages.length) {
                var p:Object = pages[drawPage];
                var yieldNow:Boolean = false;
                p.rt.drawBundled(function ():void {
                    var count:int = 0;
                    while (drawAt < p.placed.length) {
                        var it:Object = p.placed[drawAt];
                        if (it.texture != null && it.texture.root != null && it.texture.root.dataUploaded === false) { yieldNow = true; return; }
                        var r:* = p.rects[drawAt];
                        var s:* = new SP();
                        s.addChild(asset.getImage(it.name));
                        if (r.rotated) { s.rotation = Math.PI / 2; s.x = r.x + r.width; s.y = r.y; }
                        else { s.x = r.x; s.y = r.y; }
                        p.rt.draw(s);
                        s.dispose();
                        drawAt++; count++;
                        if (count >= drawsPerTick || getTimer() >= deadline) { yieldNow = true; return; }
                    }
                });
                if (drawAt >= p.placed.length) { drawPage++; drawAt = 0; }
                if (yieldNow || getTimer() >= deadline) return;
            }
            phase = "color";
        }

        private function map(items:Array):* {
            var M:Class = cls("haxe.ds.StringMap");
            var m:* = new M();
            for each (var it:Object in items) m.set(it.name, it.texture);
            return m;
        }

        private function colorStep(deadline:int):void {
            var CC:Class = cls("pinball.loading.battle._BattleStartProductionViewService.ColorChanger");
            var changes:* = svc.assetCache.colorChanges;
            while (colorPage < pages.length) {
                var p:Object = pages[colorPage];
                if (changes == null) { colorPage++; continue; }
                var chunk:Array = p.placed.slice(colorAt, colorAt + colorSheetsPerBatch);
                var cc:* = new CC(asset, p.rt, p.atlas, map(chunk), changes);
                p.rt.drawBundled(cc.apply);
                colorAt += chunk.length;
                if (colorAt >= p.placed.length) { colorPage++; colorAt = 0; }
                if (getTimer() >= deadline) return;
            }
            phase = "finish";
        }

        private function finish():void {
            stop();
            registering = true;
            var CC:Class = cls("pinball.loading.battle._BattleStartProductionViewService.ColorChanger");
            var RC:Class = cls("pinball.loading.battle._BattleStartProductionViewService.RestoreContext");
            var changes:* = svc.assetCache.colorChanges;
            for each (var L:Object in layers) {
                for (var k:int = 0; k < L.pages.length; k++) {
                    var p:Object = L.pages[k];
                    var full:* = map(p.placed);
                    var rc:* = new RC(p.rt, p.atlas, full, asset, svc.devConfig, p.color, new CC(asset, p.rt, p.atlas, full, changes));
                    p.rt.root.onRestore = rc.restoreHandler;
                    var sub:Object = {image: [], dynamicTexture: [], spriteSheet: [],
                                      bitmapFont: k == L.pages.length - 1 && L.target.bitmapFont != null ? L.target.bitmapFont : []};
                    for each (var it:Object in p.placed) sub[it.kind].push(it.name);
                    svc.registerTextureAtlas(p.name, sub, p.atlas);
                }
            }
            stat.completed = true;
            stat.totalMs = getTimer() - stat.t0;
            dumpStat();
            try { svc.progressHandler(1); } catch (e:*) {}
            svc.completeHandler();
        }

        private function stop():void {
            if (timer != null) { timer.stop(); timer.removeEventListener(TimerEvent.TIMER, tick); }
            var i:int = running.indexOf(this);
            if (i >= 0) running.splice(i, 1);
        }

        private function disposeAll():void {
            for each (var L:Object in layers)
                for each (var p:Object in L.pages)
                    if (p.rt != null) { try { p.rt.dispose(); } catch (e:*) {} p.rt = null; }
        }

        private function abort():void {
            stop(); disposeAll();
            stat.aborted = true;
            dumpStat();
            try { svc.gear.removeFromParent(); } catch (e:*) {}
        }

        private function fallback(error:*):void {
            stop(); disposeAll();
            stat.fallback = true; stat.error = String(error);
            dumpStat();
            var changes:* = svc.assetCache.colorChanges;
            svc.setupTextureAtlas(layers[0].name, svc.packingTarget0, 0xFF0000, changes);
            svc.setupTextureAtlas(layers[1].name, svc.packingTarget1, 0xFFFF00, changes);
            svc.completeHandler();
        }

        /** Diagnostics: last job summary to <app storage>/pack-slicer.json (one small write per battle load). */
        public static var statFile:String = "pack-slicer.json";
        private function dumpStat():void {
            try {
                if (statFile == null) return;
                var f:File = File.applicationStorageDirectory.resolvePath(statFile);
                var fs:FileStream = new FileStream();
                fs.open(f, FileMode.WRITE);
                fs.writeUTFBytes(JSON.stringify(stat));
                fs.close();
            } catch (e:*) {}
        }

        /** Number of jobs still running (tests). */
        public static function active():int { return running.length; }
    }
}
