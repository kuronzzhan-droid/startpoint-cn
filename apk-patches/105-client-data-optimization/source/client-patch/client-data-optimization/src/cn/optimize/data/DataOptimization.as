package cn.optimize.data {
    import flash.utils.Dictionary;
    import flash.utils.getDefinitionByName;

    public final class DataOptimization {
        private static var sortVersions:Dictionary = new Dictionary(true);
        private static var detailVersions:Dictionary = new Dictionary(true);
        private static var nodeScopes:Array = [];
        public static var sortHits:int = 0;
        public static var sortMisses:int = 0;
        public static var nodeBuilds:int = 0;
        public static var nodeHits:int = 0;

        // Capture creation-time player/time and character identity. Only the
        // existing per-row Lazy controls evaluation and successful-result reuse.
        public static function deferredQuestBadge(repository:Object,characterId:int,player:Object,time:Number):Function {
            return function():Object {
                return repository.getCharacterQuestGroup(characterId).containsNotClearedAndSelectableCharacterQuests(player,time);
            };
        }

        public static function ranks(order:Array):Object {
            var result:Object = {};
            for(var i:int=0;i<order.length;i++) {
                var key:String=String(int(order[i]));
                if(!result.hasOwnProperty(key))result[key]=i;
            }
            return result;
        }
        public static function rank(ranks:Object,key:int):int {
            var name:String=String(key);
            return ranks.hasOwnProperty(name)?int(ranks[name]):-1;
        }
        public static function rankComparator(ranks:Object):Function {
            return function(a:int,b:int):int { return rank(ranks,a)-rank(ranks,b); };
        }

        private static function primary(c:Object,criteria:int):Number {
            switch(criteria) {
                case 0:return Number(getDefinitionByName('pinball.common.time._AppTime.AppTime_Impl_').getTime(c.get_useDate()));
                case 1:return c.get_rarity();
                case 2:return c.get_level();
                case 3:return c.get_hp();
                case 4:return c.get_atk();
                case 5:return c.get_actionSkillLevel();
                case 6:return Number(getDefinitionByName('pinball.common.time._AppTime.AppTime_Impl_').getTime(c.get_joinDate()));
                case 7:return c.get_element();
                case 8:return c.get_stack();
            }
            throw new Error('Unsupported sort criterion');
        }
        private static function sortSnapshot(list:Array,criteria:int,direction:int):Array {
            var result:Array=[criteria,direction,list.length];
            var Element:Object=getDefinitionByName('pinball.common.data.general.ElementKindTools');
            for each(var c:Object in list) {
                var element:int=int(Element.getIndex(c.get_element()));
                var rarity:int=int(c.get_rarity());
                var value:Number=criteria==1?rarity:criteria==7?-element:primary(c,criteria);
                result.push(int(c.id),value,element,rarity);
            }
            return result;
        }
        private static function equals(a:Array,b:Array):Boolean {
            if(a==null||b==null||a.length!=b.length)return false;
            for(var i:int=0;i<a.length;i++)if(a[i]!==b[i])return false;
            return true;
        }
        public static function sortIfChanged(repository:Object,list:Array,setting:Object,comparator:Function):void {
            if(list.length<2){delete sortVersions[repository];return;}
            var snapshot:Array;
            try { snapshot=sortSnapshot(list,int(setting.orderCriteria),int(setting.orderDirection)); }
            catch(snapshotError:*) { delete sortVersions[repository];list.sort(comparator);sortMisses++;return; }
            if(equals(sortVersions[repository] as Array,snapshot)){sortHits++;return;}
            delete sortVersions[repository];
            // Evaluate the actual selected sort getters once, including the
            // fixed element/rarity/id tie-breakers. Integer wrap and primary-only
            // descending order match the original comparator wrappers.
            var byCharacter:Dictionary=new Dictionary();
            var safe:Boolean=true;
            for(var i:int=3;i<snapshot.length;i+=4) {
                byCharacter[list[(i-3)/4]]=snapshot.slice(i,i+4);
                if(isNaN(Number(snapshot[i+1])))safe=false;
            }
            if(safe)list.sort(function(a:Object,b:Object):int {
                var x:Array=byCharacter[a],y:Array=byCharacter[b];
                var cmp:int=(int(setting.orderCriteria)==0||int(setting.orderCriteria)==6)?
                    (x[1]==y[1]?0:x[1]>y[1]?1:-1):int(Number(x[1])-Number(y[1]));
                if(int(setting.orderDirection)==1)cmp=-cmp;
                if(cmp==0)cmp=int(x[2])-int(y[2]);
                if(cmp==0)cmp=-(int(x[3])-int(y[3]));
                if(cmp==0)cmp=int(x[0])-int(y[0]);
                return cmp;
            });
            else list.sort(comparator);
            sortMisses++;
            var ordered:Array=snapshot.slice(0,3);
            for each(var item:Object in list) {
                var row:Array=byCharacter[item];
                if(row==null){delete sortVersions[repository];return;}
                ordered.push(row[0],row[1],row[2],row[3]);
            }
            sortVersions[repository]=ordered;
        }
        public static function forgetSort(repository:Object):void { delete sortVersions[repository]; }

        private static function details(carousel:Object):Object {
            var state:Object=detailVersions[carousel];
            var group:int=int(carousel.store.partyGroupId);
            if(state==null){state={group:group,revision:0,versions:[]};detailVersions[carousel]=state;}
            else if(state.group!==group){state.group=group;state.revision++;state.versions=[];}
            return state;
        }
        public static function acceptParty(carousel:Object,index:int):void {
            var state:Object=details(carousel);state.versions[index]=state.revision;
        }
        public static function partyData(carousel:Object,index:int):Object {
            var state:Object=details(carousel);
            var old:Object=carousel.partiesData[index];
            if(old==null||state.versions[index]!==state.revision) {
                var result:Object=carousel.useCase.getPartyAt(int(carousel.store.partyGroupId),index,carousel.detailSetting);
                // Getters are called from the synchronous view-command dispatcher.
                // Publishing a new view command here re-enters that dispatcher.
                // The caller presents the returned data; keep publication silent,
                // matching the original getPartyData/applyDetailSetting methods.
                carousel.partiesData[index]=result;
                state.versions[index]=state.revision;
                return result;
            }
            return old;
        }
        public static function ensureParty(carousel:Object,index:int):void { partyData(carousel,index); }
        public static function applyDetails(carousel:Object,setting:Object):void {
            carousel.detailSetting=setting;
            var state:Object=details(carousel);state.revision++;
            var n:int=int(carousel.partiesData.length);
            var current:int=int(carousel.currentIndex);
            // Include the scroll endpoints so pages still on screen during an
            // animation are refreshed before the next drawing update.
            var positions:Array=[current];
            if(carousel.tracker!=null)positions.push(Math.floor(Number(carousel.tracker.current)),Math.ceil(Number(carousel.tracker.current)),
                Math.floor(Number(carousel.tracker.destination)),Math.ceil(Number(carousel.tracker.destination)));
            var wanted:Object={};
            for each(var p:int in positions)for(var delta:int=-1;delta<=1;delta++) {
                var index:int=p+delta;
                if(index>=0&&index<n)wanted[String(index)]=true;
            }
            for(var i:int=0;i<n;i++)if(wanted.hasOwnProperty(String(i))&&carousel.partiesData[i]!=null)partyData(carousel,i);
        }

        public static function beginNodes():Object {
            var context:Object={nodes:new Dictionary()};nodeScopes.push(context);return context;
        }
        public static function endNodes(context:Object):void {
            var index:int=nodeScopes.lastIndexOf(context);
            if(index>=0)nodeScopes.length=index;
        }
        public static function scopeDepth():int { return nodeScopes.length; }
        private static function nodeSignature(character:Object):Array {
            var h:Object=character.get_learnedAbilities().h;
            var Keys:Class=getDefinitionByName('haxe.ds._IntMap.IntMapKeysIterator') as Class;
            var keys:Object=new Keys(h);var result:Array=[];
            while(keys.hasNext()){var id:int=int(keys.next());result.push(id,int(h[id]));}
            return result;
        }
        public static function nodes(character:Object):Array {
            var signature:Array=nodeSignature(character);
            var context:Object=nodeScopes.length?nodeScopes[nodeScopes.length-1]:null;
            var cached:Object=context!=null?context.nodes[character]:null;
            if(cached!=null&&cached.assets===character.logicAssets&&equals(cached.signature,signature)) {
                var intact:Boolean=true;
                for(var j:int=0;j<cached.values.length;j++) {
                    var node:Object=cached.values[j];
                    if(node.id!==signature[2*j]||node.awakeLevel!==signature[2*j+1]||node.generalCharacter!==character||node.logicAssets!==character.logicAssets){intact=false;break;}
                }
                if(intact){nodeHits++;return cached.values.concat();}
            }
            var Node:Class=getDefinitionByName('pinball.common.data.ability.GeneralManaNodeLogic') as Class;
            var result:Array=[];
            for(var i:int=0;i<signature.length;i+=2){result.push(new Node(signature[i],signature[i+1],character,character.logicAssets));nodeBuilds++;}
            if(context!=null)context.nodes[character]={assets:character.logicAssets,signature:signature,values:result};
            return result.concat();
        }
    }
}
