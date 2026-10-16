package cn.admission {
    import flash.desktop.NativeApplication;
    import flash.utils.getTimer;
    import flash.display.DisplayObject;
    import flash.display.Sprite;
    import flash.display.Stage;
    import flash.events.Event;
    import flash.events.MouseEvent;
    import flash.events.TouchEvent;
    import flash.events.IOErrorEvent;
    import flash.events.SecurityErrorEvent;
    import flash.events.TimerEvent;
    import flash.net.URLLoader;
    import flash.net.URLRequest;
    import flash.net.URLRequestHeader;
    import flash.text.TextField;
    import flash.text.TextFormat;
    import flash.utils.ByteArray;
    import flash.utils.Dictionary;
    import flash.utils.Timer;
    import flash.utils.getDefinitionByName;

    public final class ClientAdmission {
        private static var lifecycle:AdmissionSession;
        private static var heartbeat:Timer;
        private static var lastTick:uint=0, elapsed:Number=0;
        private static var queues:Dictionary=new Dictionary(true), attempts:Dictionary=new Dictionary(true);
        private static var connects:Dictionary=new Dictionary(true), loads:Dictionary=new Dictionary(true);
        private static var panel:Sprite, stageRef:Stage, retryAction:Function;
        private static const FALLBACK:String="当前客户端版本已停止支持，请到群聊下载新版安装包。";
        private static function now():Number {
            var value:uint=uint(getTimer());elapsed+=uint(value-lastTick);lastTick=value;return elapsed;
        }
        private static function state():AdmissionSession {
            if(!lifecycle) {
                lifecycle=new AdmissionSession(transport,now);
                heartbeat=new Timer(10000);heartbeat.addEventListener(TimerEvent.TIMER,function(e:TimerEvent):void {lifecycle.background();});heartbeat.start();
                NativeApplication.nativeApplication.addEventListener(Event.ACTIVATE,function(e:Event):void {
                    if(lifecycle.token && lifecycle.session)lifecycle.ensure(function(r:Object):void {},true,true);
                });
            }
            return lifecycle;
        }
        private static function observe(headers:Array):void {
            for each(var h:Object in headers)if(String(h.name).toLowerCase()=="x-sp-session")state().observe(String(h.value));
        }
        private static function refreshSession():void {
            var setting:Object={basePath:BuildConfig.ORIGIN+"/api/index.php",headers:[]};
            getDefinitionByName("cn.account.PlayerLogin").attach(setting);observe(setting.headers);
        }
        private static function hold(queue:Object):void {queue.requestState=getDefinitionByName("pinball.context.remote.RequestState").Requesting;}
        private static function failQueue(queue:Object,setting:Object,r:Object):void {
            hold(queue);var marker:Object={};queues[queue]=marker;
            show(String(r.message || FALLBACK),function():void {
                if(queues[queue]!==marker || (queue.gear && queue.gear.isDisposed()))return;
                delete queues[queue];state().allowRetry();delete attempts[setting];queue.startRequest(setting,0,0);
            });
        }
        public static function beforeQueue(queue:Object, setting:Object, retry:int, started:int):Boolean {
            if(String(setting.basePath).replace(/\/$/, "")!=BuildConfig.ORIGIN+"/api/index.php")return true;
            observe(setting.headers || []);
            if(queues[queue])return false;
            if(state().usable()) {attach(setting);return true;}
            hold(queue);var marker:Object={};queues[queue]=marker;
            state().ensure(function(r:Object):void {
                if(queues[queue]!==marker)return;
                delete queues[queue];
                if(queue.gear && queue.gear.isDisposed())return;
                if(r.ok)queue.startRequest(setting,retry,started);else failQueue(queue,setting,r);
            });return false;
        }
        public static function queueCanceled(queue:Object):void {delete queues[queue];}
        private static function attach(setting:Object):void {
            var h:Array=setting.headers as Array;if(!h)h=[];
            for(var i:int=h.length-1;i>=0;i--)if(String(h[i].name).toLowerCase()=="x-sp-admission")h.splice(i,1);
            h.push(new URLRequestHeader("X-SP-ADMISSION",state().token));setting.headers=h;
        }
        public static function beforeSocketConnect(connection:Object):Boolean {
            refreshSession();
            if(state().usable())return true;
            if(connects[connection])return false;
            var marker:Object={};connects[connection]=marker;
            state().ensure(function(r:Object):void {
                if(connects[connection]!==marker || connection.gear.isDisposed())return;
                if(r.ok) {delete connects[connection];connection.socketConnect();}
                else show(String(r.message || FALLBACK),function():void {
                    if(connects[connection]!==marker || connection.gear.isDisposed())return;
                    delete connects[connection];state().allowRetry();connection.socketConnect();
                });
            });return false;
        }
        public static function socketClosed(connection:Object):void {delete connects[connection];}
        public static function socket(connection:Object):void {
            if(connection && connection.handshakeCommand)connection.handshakeCommand.sp_admission=state().token;
        }
        public static function inspect(queue:Object,setting:Object,raw:Object):Boolean {
            var r:Object=raw && raw.data_headers?raw.data_headers.client_admission:null;
            if(!r || r.ok!==false) {delete attempts[setting];return true;}
            // Only this explicit pre-handler rejection can replay the same business request.
            var count:int=int(attempts[setting]);attempts[setting]=count+1;
            if(count>=2 || r.action=="update") {failQueue(queue,setting,r);return false;}
            hold(queue);var marker:Object={};queues[queue]=marker;
            state().ensure(function(result:Object):void {
                if(queues[queue]!==marker)return;
                delete queues[queue];
                if(queue.gear && queue.gear.isDisposed())return;
                if(result.ok)queue.startRequest(setting,0,0);else failQueue(queue,setting,result);
            },true,true,String(r.action));return false;
        }
        public static function forwardAdmission(raw:Object,success:Function):Boolean {
            var r:Object=raw && raw.data_headers?raw.data_headers.client_admission:null;
            if(!r || r.ok!==false)return true;
            success(raw);return false;
        }
        public static function cancelLoad(loader:URLLoader):void {
            var job:Object=loads[loader];
            if(job){job.active=false;if(job.listener!=null)loader.removeEventListener(Event.COMPLETE,job.listener);delete loads[loader];}
        }
        public static function load(loader:URLLoader,req:URLRequest):void {
            if(req.url.indexOf(BuildConfig.ORIGIN+"/player-auth/")!==0){loader.load(req);return;}
            cancelLoad(loader);state().allowRetry();
            var job:Object={active:true,tries:0,listener:null};loads[loader]=job;
            function deliver(r:Object):void {
                if(!job.active)return;
                cancelLoad(loader);loader.data=JSON.stringify(r);loader.dispatchEvent(new Event(Event.COMPLETE));
            }
            function attempt():void {
                if(!job.active)return;
                var h:Array=req.requestHeaders || [];
                for(var i:int=h.length-1;i>=0;i--)if(String(h[i].name).toLowerCase()=="x-sp-admission")h.splice(i,1);
                h.push(new URLRequestHeader("X-SP-ADMISSION",state().token));req.requestHeaders=h;
                try{loader.load(req);}catch(error:*){cancelLoad(loader);loader.dispatchEvent(new IOErrorEvent(IOErrorEvent.IO_ERROR));}
            }
            job.listener=function(e:Event):void {
                if(!job.active)return;
                var r:Object;try{r=JSON.parse(String(loader.data));}catch(error:*){cancelLoad(loader);return;}
                if(r.ok && r.data && r.data.token)state().observe(String(r.data.token),true);
                if(r.ok && req.url==BuildConfig.ORIGIN+"/player-auth/logout")state().observe("");
                if(r.ok===false && r.action && /^CLIENT_|^RATE_LIMITED$/.test(String(r.code)) && job.tries<2 && r.action!="update") {
                    e.stopImmediatePropagation();job.tries++;
                    state().ensure(function(a:Object):void {if(a.ok)attempt();else deliver(a);},true,false,String(r.action));
                } else cancelLoad(loader);
            };
            loader.addEventListener(Event.COMPLETE,job.listener,false,1000);
            state().ensure(function(r:Object):void {if(r.ok)attempt();else deliver(r);},false,false);
        }
        private static function transport(path:String,body:Object,ticket:String,session:String,done:Function):void {
            if(path=="handshake") {
                sendAbsolute(BuildConfig.ORIGIN+"/client-admission/challenge",{protocol:1,build:BuildConfig.ID,platform:"android"},"","",function(r:Object):void {
                    if(!r.ok){done(r);return;}
                    try{
                        var c:Object=r.data, proof:String=hmac(BuildConfig.KEY,"SP-ADMISSION-1\n"+BuildConfig.ID+"\n"+c.challenge+"\n"+c.nonce);
                        sendAbsolute(BuildConfig.ORIGIN+"/client-admission/prove",{challenge:c.challenge,proof:proof},"","",done);
                    }catch(error:*){done({ok:false,action:"retry",message:"服务器校验响应无效，请稍后重试。"});}
                });return;
            }
            sendAbsolute(BuildConfig.ORIGIN+(path=="resume"?"/player-auth/resume":"/client-admission/"+path),body,ticket,session,done);
        }
        private static function sendAbsolute(url:String,body:Object,ticket:String,session:String,done:Function):void {
            var req:URLRequest=new URLRequest(url);req.method="POST";req.contentType="application/json";req.data=JSON.stringify(body);
            var headers:Array=[];if(ticket)headers.push(new URLRequestHeader("X-SP-ADMISSION",ticket));if(session)headers.push(new URLRequestHeader("X-SP-SESSION",session));req.requestHeaders=headers;
            var loader:URLLoader=new URLLoader(), timer:Timer=new Timer(4000,1), complete:Boolean=false;
            function finishRequest(r:Object):void {
                if(complete)return;complete=true;timer.stop();timer.removeEventListener(TimerEvent.TIMER_COMPLETE,failure);
                loader.removeEventListener(Event.COMPLETE,loaded);loader.removeEventListener(IOErrorEvent.IO_ERROR,failure);loader.removeEventListener(SecurityErrorEvent.SECURITY_ERROR,failure);
                try{loader.close();}catch(error:*){}done(r);
            }
            function failure(e:Event):void {finishRequest({ok:false,action:"retry",message:"暂时无法连接服务器，请检查网络后重试。"});}
            function loaded(e:Event):void {try {var r:Object=JSON.parse(String(loader.data));}catch(error:*){failure(e);return;}finishRequest(r);}
            loader.addEventListener(Event.COMPLETE,loaded);loader.addEventListener(IOErrorEvent.IO_ERROR,failure);loader.addEventListener(SecurityErrorEvent.SECURITY_ERROR,failure);
            timer.addEventListener(TimerEvent.TIMER_COMPLETE,failure);timer.start();try{loader.load(req);}catch(error:*){failure(null);}
        }
        public static function hmac(keyHex:String,message:String):String {
            var inner:ByteArray=new ByteArray(),outer:ByteArray=new ByteArray(),key:ByteArray=new ByteArray();
            for(var i:int=0;i<keyHex.length;i+=2)key.writeByte(parseInt(keyHex.substr(i,2),16));
            for(i=0;i<64;i++){var b:int=i<key.length?key[i]:0;inner.writeByte(b^0x36);outer.writeByte(b^0x5c);}
            inner.writeUTFBytes(message);outer.writeBytes(sha(inner));
            var result:ByteArray=sha(outer),hex:String="";
            for(i=0;i<result.length;i++)hex+=("0"+uint(result[i]).toString(16)).substr(-2);
            return hex;
        }
        private static function sha(bytes:ByteArray):ByteArray {
            var hash:Object=getDefinitionByName("haxe.crypto.Sha256"),type:Object=getDefinitionByName("haxe.io.Bytes");
            bytes.position=0;return hash.make(type.ofData(bytes)).b as ByteArray;
        }
        private static function show(text:String,retry:Function):void {
            try {
                var lib:Object=getDefinitionByName("flash.Lib");stageRef=(lib.current as DisplayObject).stage;
                if(panel && panel.parent)panel.parent.removeChild(panel);
                panel=new Sprite();retryAction=retry;
                panel.graphics.beginFill(0x132C29,0.92);panel.graphics.drawRect(0,0,stageRef.stageWidth,stageRef.stageHeight);panel.graphics.endFill();
                var width:Number=580,left:Number=0,top:Number=0,card:Sprite=new Sprite();
                var scale:Number=Math.min(stageRef.stageWidth*0.90/width,stageRef.stageHeight*0.80/280);
                card.scaleX=card.scaleY=scale;card.x=(stageRef.stageWidth-width*scale)/2;card.y=(stageRef.stageHeight-280*scale)/2;
                card.graphics.beginFill(0xF5FAF8);card.graphics.drawRoundRect(0,0,width,280,24,24);card.graphics.endFill();panel.addChild(card);
                var field:TextField=new TextField();field.embedFonts=true;field.defaultTextFormat=new TextFormat("SY",22,0x294943,false,null,null,null,null,"center");
                field.x=left+24;field.y=top+30;field.width=width-48;field.height=155;field.multiline=true;field.wordWrap=true;field.selectable=false;
                field.text="客户端接入提示\n\n"+text;card.addChild(field);
                var button:Sprite=new Sprite();button.graphics.beginFill(0x20B9AA);button.graphics.drawRoundRect(0,0,width-80,52,12,12);button.graphics.endFill();
                button.x=left+40;button.y=top+205;button.buttonMode=true;
                var label:TextField=new TextField();label.embedFonts=true;label.defaultTextFormat=new TextFormat("SY",21,0xFFFFFF,false,null,null,null,null,"center");label.width=width-80;label.height=42;label.y=10;label.text="重试";label.mouseEnabled=false;button.addChild(label);card.addChild(button);
                button.addEventListener(MouseEvent.CLICK,function(e:MouseEvent):void {e.stopImmediatePropagation();var next:Function=retryAction;stageRef.removeEventListener(Event.ENTER_FRAME,raise);if(panel && panel.parent)panel.parent.removeChild(panel);panel=null;if(next!=null)next();});
                panel.addEventListener(MouseEvent.CLICK,block);panel.addEventListener(MouseEvent.MOUSE_DOWN,block);panel.addEventListener(MouseEvent.MOUSE_UP,block);
                panel.addEventListener(TouchEvent.TOUCH_BEGIN,block);panel.addEventListener(TouchEvent.TOUCH_END,block);
                stageRef.addChild(panel);stageRef.addEventListener(Event.ENTER_FRAME,raise);
            }catch(error:*){}
        }
        private static function block(e:Event):void {e.stopPropagation();}
        private static function raise(e:Event):void {if(panel && panel.parent && stageRef.getChildIndex(panel)!=stageRef.numChildren-1)stageRef.setChildIndex(panel,stageRef.numChildren-1);}
    }
}
