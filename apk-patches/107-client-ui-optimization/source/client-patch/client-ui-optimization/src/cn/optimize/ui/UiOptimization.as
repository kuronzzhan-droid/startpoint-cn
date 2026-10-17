package cn.optimize.ui {
    import flash.utils.Dictionary;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;

    /** Android UI-only helpers. Original methods retain ownership and error paths. */
    public final class UiOptimization {
        private static var listStates:Dictionary = new Dictionary(true);
        private static var pageStates:Dictionary = new Dictionary(true);
        private static const UNKNOWN:Object = {};
        private static var optionClass:Object;
        private static var kindClass:Object;
        private static var stringMapClass:Object;

        public static function bucketHasRemainder(pool:Object, path:String):Boolean {
            if (stringMapClass == null) stringMapClass = getDefinitionByName("haxe.ds.StringMap");
            var map:Object = pool.map;
            var values:Array = path in stringMapClass.reserved ? map.getReserved(path) : map.h[path];
            return values != null && values.length != 0;
        }
        public static function clearAnimationBuckets(pool:Object):void {
            var keys:Array=[];
            for(var key:String in pool.map.h) keys.push(key);
            for(key in pool.map.rh) keys.push(key);
            for each(key in keys) pool.map.remove(key);
        }

        private static function copy(value:*, depth:int, budget:Array):* {
            if (++budget[0] > 4096 || depth > 16) return UNKNOWN;
            if (value === null) return ["null"];
            if (value === undefined) return ["undefined"];
            if (value is String || value is Boolean) return [typeof value, value];
            if (value is Number) return isFinite(Number(value)) ? ["number", value] : UNKNOWN;
            var result:Array = [], child:*, name:String;
            if (value is Array) {
                for each (child in value) {
                    var part:* = copy(child,depth+1,budget);
                    if (part === UNKNOWN) return UNKNOWN;
                    result.push(part);
                }
                return ["array",result];
            }
            if ("__enum__" in value && value.__enum__ === true) {
                part = copy(value.params,depth+1,budget);
                return part === UNKNOWN ? UNKNOWN : ["enum",getQualifiedClassName(value),value.tag,value.index,part];
            }
            if (getQualifiedClassName(value) != "Object") return UNKNOWN;
            var names:Array = [];
            var fields:Dictionary = new Dictionary();
            for (name in value) {
                part = copy(value[name],depth+1,budget);
                if (part === UNKNOWN) return UNKNOWN;
                names.push(name); fields[name] = part;
            }
            return ["object",names,fields];
        }
        private static function same(snapshot:*, value:*, depth:int, budget:Array):Boolean {
            if (++budget[0] > 4096 || depth > 16 || snapshot === UNKNOWN) return false;
            var type:String = snapshot[0];
            if (type == "null") return value === null;
            if (type == "undefined") return value === undefined;
            if (type == "string" || type == "boolean") return typeof value == type && value === snapshot[1];
            if (type == "number") return value is Number && value === snapshot[1];
            if (value === null || value === undefined) return false;
            var i:int, name:String;
            if (type == "array") {
                if (!(value is Array) || value.length != snapshot[1].length) return false;
                for(i=0;i<value.length;i++) if(!same(snapshot[1][i],value[i],depth+1,budget)) return false;
                return true;
            }
            if(type == "enum") return "__enum__" in value && value.__enum__ === true &&
                getQualifiedClassName(value) == snapshot[1] && value.tag === snapshot[2] && value.index === snapshot[3] &&
                same(snapshot[4],value.params,depth+1,budget);
            if(getQualifiedClassName(value) != "Object") return false;
            var count:int=0;
            for(name in value) {
                count++;
                if(!(name in snapshot[2]) || !same(snapshot[2][name],value[name],depth+1,budget)) return false;
            }
            return count == snapshot[1].length;
        }

        /** Preflight before changing views; opaque items always take the original binding path. */
        public static function present(view:Object, data:Array):Boolean {
            if(data == null) { delete listStates[view]; return false; }
            var state:Object = listStates[view];
            var planned:Dictionary = new Dictionary();
            var order:Array = [];
            var budget:Array=[0];
            var entry:Object, item:Object, id:int, old:Object, snapshot:*;
            for each(item in data) {
                if(item == null || !("key" in item)) { delete listStates[view]; return false; }
                id=int(item.key);
                if(id in planned) { delete listStates[view]; return false; }
                old=state == null ? null : state[id];
                var physical:Object = view.cells.h[id];
                budget[0]=0;
                var unchanged:Boolean=old != null && physical === old.cell && same(old.snapshot,item,0,budget);
                budget[0]=0;
                snapshot=unchanged ? old.snapshot : copy(item,0,budget);
                // Opaque Lazy badges cannot be compared safely across refreshes.
                // Keep this row dirty, without evaluating it or recycling every
                // other view. same(UNKNOWN, ...) always returns false.
                planned[id]=unchanged ? old : {cell:physical,snapshot:snapshot,item:item,unchanged:false};
                order.push(id);
            }
            // Collect before removing: no iterator observes a mutated IntMap.
            var removed:Array=[];
            for(var key:* in view.cells.h) if(!(int(key) in planned)) removed.push(int(key));
            // A failed binding must never leave an earlier snapshot eligible
            // to skip a later retry after partial view mutations.
            delete listStates[view];
            for each(id in removed) {
                view.cellPool.pool(view.cells.h[id]);
                view.cells.remove(id);
            }
            if(optionClass == null) optionClass=getDefinitionByName("haxe.ds.Option");
            if(kindClass == null) kindClass=getDefinitionByName("pinball.scene.character.cell.CharacterCellViewDataSourceKind");
            var next:Dictionary = new Dictionary();
            for each(id in order) {
                entry=planned[id];
                if(entry.cell == null) {
                    entry.cell=view.cellPool.getOrCreate(0,0);
                    view.cells.h[id]=entry.cell;
                }
                if(!entry.unchanged) entry.cell.apply(kindClass.List(optionClass.Some(entry.item)));
                entry.cell.showsPedestalShadow=true;
                entry.item=null;entry.unchanged=true;
                next[id]=entry;
            }
            listStates[view]=next;
            return true;
        }
        public static function invalidatePatch(view:Object, data:Array):void {
            var state:Object=listStates[view];
            if(state == null) return;
            for each(var item:Object in data) delete state[int(item.key)];
        }
        public static function disposeList(view:Object):void { delete listStates[view]; }

        /** Preserve all completion-sensitive states, even when the cell is hidden. */
        public static function shouldUpdateCell(table:Object, cell:Object):Boolean {
            // isWithInScreen is the narrower scroll-focus test, not the draw
            // clipping test. Match CharacterCellView.isWithinScreen exactly,
            // including the partially visible 96px edges and safeArea origin.
            var screenX:Number=(Number(cell.x)-Number(table.getScrollX())/6)*6;
            var area:Object=cell.safeArea;
            if(cell.visible && table.wholeAlpha > 0 &&
                Number(area.x)<=screenX+96 && screenX-96<=Number(area.x)+Number(area.width)) return true;
            if(cell.isJoinOrRemoving() || cell.playKachidokiAfterFall || cell.darkenTween.index != 0) return true;
            if(!cell.motionPlayhead.isInSequence("usual") || cell.motionPlayhead.delayFrame.index == 0) return true;
            if(cell.thumbnailBalloonPlayhead.isPlaying || cell.thumbnailBalloonPlayhead.delayFrame.index == 0) return true;
            return false;
        }

        private static function stablePage(page:Object, state:Object):Boolean {
            return state != null && state.hidden && !page.thumbnailLayer.visible &&
                state.fade === page.carouselPeek.getLargeThumbnailFadingRate();
        }
        public static function skipPage(page:Object):Boolean {
            if(!stablePage(page,pageStates[page])) return false;
            // Shared cell layers are not descendants of thumbnailLayer.
            for each(var cell:Object in page.mainCharacterCells) if(cell.visible) return false;
            for each(cell in page.unisonCharacterCells) if(cell.visible) return false;
            for each(var soul:Object in page.abilitySouls)
                if(soul.abilitySoul.visible || soul.pedestal.visible || soul.hitQuad.visible) return false;
            // CarouselView moves every page during a scroll. A page that stays
            // hidden with all shared layers hidden needs no geometry redraw;
            // set_visible(true) always restores the original draw first.
            return true;
        }
        public static function afterPageDraw(page:Object):void {
            var hidden:Boolean=!page.thumbnailLayer.visible;
            if(hidden) {
                for each(var soul:Object in page.abilitySouls) {
                    soul.abilitySoul.visible=false;
                    soul.pedestal.visible=false;
                    soul.hitQuad.visible=false;
                }
            }
            var state:Object=pageStates[page];
            if(state == null) { state={}; pageStates[page]=state; }
            state.hidden=hidden; state.x=page.thumbnailLayer.x; state.y=page.thumbnailLayer.y;
            state.rate=page.positionRate; state.width=page.pageWidth;
            state.fade=page.carouselPeek.getLargeThumbnailFadingRate();
        }
        public static function disposePage(page:Object):void { delete pageStates[page]; }
    }
}
