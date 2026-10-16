package cn.account {
    import flash.display.DisplayObject;
    import flash.display.Sprite;
    import flash.display.Stage;
    import flash.events.Event;
    import flash.events.MouseEvent;
    import flash.events.FocusEvent;
    import flash.events.KeyboardEvent;
    import flash.events.IOErrorEvent;
    import flash.events.SecurityErrorEvent;
    import flash.events.TimerEvent;
    import flash.events.TouchEvent;
    import flash.events.NetStatusEvent;
    import flash.filters.DropShadowFilter;
    import flash.filesystem.File;
    import flash.filesystem.FileMode;
    import flash.filesystem.FileStream;
    import flash.geom.Matrix;
    import flash.display.GradientType;
    import flash.net.SharedObject;
    import flash.net.URLLoader;
    import flash.net.URLRequest;
    import flash.net.URLRequestHeader;
    import flash.net.URLRequestMethod;
    import flash.text.TextField;
    import flash.text.TextFieldType;
    import flash.text.TextFormat;
    import flash.text.TextFormatAlign;
    import flash.utils.getDefinitionByName;
    import flash.utils.Timer;
    import flash.utils.ByteArray;
    import flash.ui.Keyboard;

    /** Native AIR account panel. Added as its own ABC; no game class is recompiled. */
    public final class PlayerLogin {
        public static const BUILD:String = "CN-LOGIN-20260910-r15";
        private static const INK:uint=0x294943, MUTED:uint=0x849891, TEAL:uint=0x20B9AA;
        private static var stageRef:Stage, root:Sprite, card:Sprite;
        private static var scene:Object, applyLogin:Function, confirmAccount:Function;
        private static var api:String="", origin:String="", page:String="login", message:String="";
        private static var form:Object={}, profile:Object, session:String="", udid:String="";
        private static var expires:Number=0, remembered:Boolean=true, ready:Boolean=false, busy:Boolean=false;
        private static var accountConfirmed:Boolean=false;
        private static var proof:String="", storage:SharedObject, loader:URLLoader, timeout:Timer;
        private static var fields:Object={}, cardHeight:Number=550;
        private static var savedAccounts:Array=[], activeId:String="", listPage:int=0;
        private static var retryEntry:Object, claimProfile:Object, storageNotice:String="";
        private static var removingEntry:Object;
        private static var readLegacy:Function, migration:Object={}, localOutcome:String="";
        private static var claimIsLocal:Boolean=false;

        public static function title(value:Object):void {
            scene=value;
            var lib:Object=getDefinitionByName("flash.Lib");
            var display:DisplayObject=lib.current as DisplayObject;
            var endpoint:String=String(value.devConfig.getServerApiPath());
            var local:Object=value.remote.localStore;
            show(display.stage,endpoint,function(data:Object):void {
                var account:Object=getDefinitionByName("pinball.context.localStore._AccountLocalStore.AccountLocalStore_Impl_");
                var previous:Object=account.get(local.get_account());
                if(previous.index==0 && Number(previous.params[0].viewerId)!=Number(data.profile.viewer_id)) {
                    // Reset account selections, preserving device download mode and preferences.
                    var misc:Object=getDefinitionByName("pinball.context.localStore._MiscLocalStore.MiscLocalStore_Impl_");
                    misc.reset(local.get_misc());
                }
                account.saveAccountData(local.get_account(),{viewerId:Number(data.profile.viewer_id),shortUdid:"0",udid:data.udid,firstViewerId:Number(data.profile.viewer_id)});
            },dispose,function():Object {
                // The trial uses separate game storage; read the original directory without changing it.
                var file:File=value.devConfig.getStorageDirectory().resolvePath("account");
                var original:File=File.applicationStorageDirectory.resolvePath("custom_Release_Android/account");
                if(value.devConfig.getSaveDataKey()=="player_login_trial_v1" && original.exists)file=original;
                if(!file.exists)return null;
                var old:Object=readStoredRecord(file);
                if(!old || !/^[1-9]\d{0,14}$/.test(String(old.viewerId)))return {unreadable:true};
                var hash:Object=getDefinitionByName("haxe.crypto.Sha1");
                var device:Object=readStoredRecord(File.applicationStorageDirectory.resolvePath(hash.encode("device")+"_device"));
                return {viewer_id:String(old.viewerId),udid:String(old.udid || ""),device_id:device?Number(device.deviceId):0};
            });
        }
        private static function readStoredRecord(file:File):Object {
            var stream:FileStream=new FileStream();
            try {
                if(!file.exists || file.isDirectory || file.size>16384)return null;
                stream.open(file,FileMode.READ);
                var bytes:ByteArray=new ByteArray();stream.readBytes(bytes);stream.close();bytes.position=0;
                var compression:Object=getDefinitionByName("pinball.remote.util.CompressUtil");
                bytes=compression.uncompress(bytes);bytes.position=0;
                if(bytes.length>65536)return null;
                return JSON.parse(bytes.readUTFBytes(bytes.length));
            } catch(error:*) {try{stream.close();}catch(closeError:*){}return null;}
        }
        public static function start(sdk:Object,callback:Function):void {
            // Only a fresh native title-button action may continue the game's login callback.
            if(accountConfirmed && ready && session.length>0 && expires>new Date().time){callback("");return;}
            if(!root && sdk.titleScene) title(sdk.titleScene);
        }
        public static function attach(setting:Object):void {
            if(!setting || String(setting.basePath)!=api || !session) return;
            var headers:Array=setting.headers as Array;
            if(!headers) headers=[];
            for(var i:int=headers.length-1;i>=0;i--) if(String(headers[i].name).toLowerCase()=="x-sp-session") headers.splice(i,1);
            headers.push(new URLRequestHeader("X-SP-SESSION",session));setting.headers=headers;
        }
        public static function socket(connection:Object):void {
            if(connection && connection.handshakeCommand && session) connection.handshakeCommand.sp_session=session;
        }
        public static function dispose():void {
            if(root && root.parent)root.parent.removeChild(root);
            if(stageRef)stageRef.removeEventListener(Event.RESIZE,resize);
            detachBackGuard();
            root=null;card=null;scene=null;applyLogin=null;confirmAccount=null;removingEntry=null;readLegacy=null;
            cancelNetwork();
        }
        /** Also used by the standalone AIR visual/integration harness with its own test server. */
        public static function show(stage:Stage,endpoint:String,apply:Function,confirmed:Function,discover:Function=null):void {
            cancelNetwork();
            detachBackGuard();
            if(stageRef)stageRef.removeEventListener(Event.RESIZE,resize);
            if(root && root.parent)root.parent.removeChild(root);
            var nextApi:String=endpoint.replace(/\/$/,"");
            if(api && api!=nextApi){session="";profile=null;expires=0;}
            stageRef=stage;api=nextApi;origin=api.replace(/\/api\/index\.php$/,"");
            applyLogin=apply;confirmAccount=confirmed;ready=false;accountConfirmed=false;message="";proof="";form={};
            readLegacy=discover;claimIsLocal=false;localOutcome="";
            root=new Sprite();root.name="STARPOINT_PLAYER_LOGIN";stageRef.addChild(root);
            root.addEventListener(MouseEvent.CLICK,function(e:MouseEvent):void {e.stopPropagation();});
            root.addEventListener(MouseEvent.MOUSE_DOWN,function(e:MouseEvent):void {e.stopPropagation();});
            root.addEventListener(MouseEvent.MOUSE_UP,function(e:MouseEvent):void {e.stopPropagation();});
            root.addEventListener(TouchEvent.TOUCH_BEGIN,function(e:TouchEvent):void {e.stopPropagation();});
            root.addEventListener(TouchEvent.TOUCH_END,function(e:TouchEvent):void {e.stopPropagation();});
            stageRef.addEventListener(Event.RESIZE,resize);
            // The game also listens on Stage; consume Back before its exit dialog handler.
            // Capture covers focused inputs, non-capture covers events targeting Stage itself.
            stageRef.addEventListener(KeyboardEvent.KEY_DOWN,guardBack,true,10000);
            stageRef.addEventListener(KeyboardEvent.KEY_UP,guardBack,true,10000);
            stageRef.addEventListener(KeyboardEvent.KEY_DOWN,guardBack,false,10000);
            stageRef.addEventListener(KeyboardEvent.KEY_UP,guardBack,false,10000);
            loadAccounts();
            page=savedAccounts.length?"accounts":"login";render();
            var current:Object=session?{token:session,expires_at:expires,profile:profile,remember:findEntry(profile?String(profile.viewer_id):"")!=null}:findEntry(activeId);
            if(current && current.token) resumeEntry(current);
            else if(!savedAccounts.length && readLegacy!=null && !migration.attempted && !migration.completed)detectLocalSave(true);
        }
        private static function detachBackGuard():void {
            if(!stageRef)return;
            stageRef.removeEventListener(KeyboardEvent.KEY_DOWN,guardBack,true);
            stageRef.removeEventListener(KeyboardEvent.KEY_UP,guardBack,true);
            stageRef.removeEventListener(KeyboardEvent.KEY_DOWN,guardBack,false);
            stageRef.removeEventListener(KeyboardEvent.KEY_UP,guardBack,false);
        }
        private static function guardBack(e:KeyboardEvent):void {
            if(!root || !root.parent || e.keyCode!=Keyboard.BACK)return;
            e.preventDefault();e.stopImmediatePropagation();
            if(e.type==KeyboardEvent.KEY_DOWN && stageRef.focus && root.contains(stageRef.focus))stageRef.focus=null;
        }
        private static function clearLiveSession():void {
            session="";udid="";profile=null;expires=0;ready=false;accountConfirmed=false;
        }
        private static function findEntry(id:String):Object {
            for each(var entry:Object in savedAccounts) if(String(entry.profile.viewer_id)==id)return entry;
            return null;
        }
        private static function loadAccounts():void {
            savedAccounts=[];activeId="";storageNotice="";migration={};
            try {
                if(storage)storage.removeEventListener(NetStatusEvent.NET_STATUS,storageStatus);
                storage=SharedObject.getLocal("starpoint_player_login_v1");
                storage.addEventListener(NetStatusEvent.NET_STATUS,storageStatus);
                var saved:Object=storage.data[origin];
                if(saved && saved.legacy_migration)migration=saved.legacy_migration;
                if(saved && saved.version==2 && saved.accounts is Array) {
                    for each(var entry:Object in saved.accounts) {
                        if(entry && entry.profile && entry.profile.viewer_id && !findEntry(String(entry.profile.viewer_id)))savedAccounts.push(entry);
                    }
                    activeId=String(saved.active_id || "");
                } else if(saved && saved.token) {
                    // Preserve the r4 token until the server returns its real UID; offline migration must not erase it.
                    savedAccounts.push({token:saved.token,expires_at:saved.expires_at,profile:{viewer_id:"legacy",name:"原已保存账号",username:""},last_used:0});
                    activeId="legacy";
                }
            } catch(error:*) {storageNotice="本机登录记录暂时无法读取，可用账号密码登录。";}
        }
        private static function persistAccounts():void {
            try {
                if(!storage)throw new Error("storage unavailable");
                storage.data[origin]={version:2,active_id:activeId,accounts:savedAccounts,legacy_migration:migration};
                storageNotice=storage.flush()=="flushed"?"":"正在保存登录记录，请稍候。";
            } catch(error:*) {storageNotice="本机保存失败；关闭后可能需要重新输入密码。";}
        }
        private static function storageStatus(e:NetStatusEvent):void {
            storageNotice=e.info.code=="SharedObject.Flush.Success"?"":"本机保存失败；关闭后可能需要重新输入密码。";
            render();
        }
        private static function resumeEntry(entry:Object):void {
            retryEntry=entry;remembered=entry.remember!==false;ready=false;accountConfirmed=false;
            if(!entry.token || Number(entry.expires_at)<=new Date().time) {
                invalidateEntry(entry);form={username:entry.profile.username || ""};
                page="login";message="此账号需要重新登录，原存档仍然保留。";render();return;
            }
            request("resume",{token:entry.token},accept,function(text:String,code:String):void {
                if(code=="SESSION_INVALID") {
                    invalidateEntry(entry);form={username:entry.profile.username || ""};page="login";
                } else page="retry";
                message=text;render();
            });
        }
        private static function invalidateEntry(entry:Object):void {
            if(session==entry.token)clearLiveSession();
            var saved:Object=findEntry(String(entry.profile.viewer_id));
            if(saved && saved.token==entry.token)saved.token="";
            entry.token="";persistAccounts();
        }
        private static function accept(data:Object):void {
            if(!data || !data.profile || !data.token || !data.udid)throw new Error("invalid login response");
            session=String(data.token);udid=String(data.udid);profile=data.profile;expires=Number(data.expires_at);
            var id:String=String(profile.viewer_id), remaining:Array=[];
            for each(var entry:Object in savedAccounts) if(String(entry.profile.viewer_id)!=id && entry.token!=session)remaining.push(entry);
            savedAccounts=remaining;
            if(remembered)savedAccounts.unshift({token:session,expires_at:expires,profile:profile,last_used:new Date().time});
            activeId=remembered?id:"";migration.completed=true;persistAccounts();
            ready=true;accountConfirmed=false;form={};proof="";message="";page="welcome";render();
        }
        private static function switchAccount():void {
            ready=false;accountConfirmed=false;listPage=0;form={};navigate(savedAccounts.length?"accounts":"login");
        }
        private static function removeEntry():void {
            if(!removingEntry || busy)return;
            var id:String=String(removingEntry.profile.viewer_id), remaining:Array=[];
            for each(var entry:Object in savedAccounts)if(String(entry.profile.viewer_id)!=id)remaining.push(entry);
            savedAccounts=remaining;
            if(profile && String(profile.viewer_id)==id)clearLiveSession();
            if(activeId==id)activeId="";
            if(retryEntry && String(retryEntry.profile.viewer_id)==id)retryEntry=null;
            removingEntry=null;persistAccounts();form={};navigate(savedAccounts.length?"accounts":"login");
        }
        private static function continueGame():void {
            if(!ready || busy || page!="welcome" || accountConfirmed)return;
            if(expires<=new Date().time){resumeEntry({token:session,expires_at:expires,profile:profile,remember:remembered});return;}
            // Confirm the account and close this panel; the native title stays in control of loading.
            try{applyLogin({token:session,udid:udid,expires_at:expires,profile:profile});}
            catch(error:*){message="暂时无法载入账号，请再次点击继续游戏。";render();return;}
            message="";accountConfirmed=true;
            if(confirmAccount!=null)confirmAccount();
        }
        private static function navigate(next:String):void {page=next;message="";render();}
        private static function detectLocalSave(automatic:Boolean=false):void {
            if(busy || readLegacy==null)return;
            var old:Object;
            try{old=readLegacy();}catch(error:*){old={unreadable:true};}
            // Save the attempt before sending. Restarts and unavailable networks never cause polling.
            migration.attempted=true;persistAccounts();
            if(!old && automatic)return;
            proof="";form={};claimIsLocal=false;localOutcome="manual";
            if(!old || old.unreadable){page="local";render();return;}
            page="local";localOutcome="checking";
            request("local-claim-preview",old,function(data:Object):void {
                if(data.status=="claimable" && data.proof && data.profile) {
                    proof=data.proof;claimProfile=data.profile;claimIsLocal=true;remembered=true;navigate("claim");
                } else {
                    localOutcome=data.status=="login_required"?"bound":"manual";
                    navigate("local");
                }
            },function(text:String,code:String):void {localOutcome="retry";page="local";message=text;render();});
        }
        private static function request(path:String,body:Object,success:Function,failure:Function=null):void {
            if(busy)return;
            busy=true;message="";render();
            var req:URLRequest=new URLRequest(origin+"/player-auth/"+path);
            if(path=="resume" || path=="login" || path=="register" || path=="bind")body.previous_token=session;
            req.method=URLRequestMethod.POST;req.contentType="application/json";req.data=JSON.stringify(body);
            loader=new URLLoader();var current:URLLoader=loader;
            var completed:Boolean=false;
            function done(error:String=null,code:String="NETWORK_ERROR"):void {
                if(completed)return;completed=true;cancelNetwork();busy=false;
                if(error){if(failure!=null)failure(error,code);else{message=error;render();}}
            }
            current.addEventListener(Event.COMPLETE,function(e:Event):void {
                if(current!==loader || completed)return;
                try {
                    var data:Object=JSON.parse(String(current.data));
                    if(!data.ok){done(data.message || "暂时无法完成，请稍后重试。",data.code || "SERVER_ERROR");return;}
                } catch(error:*) {done("服务器返回异常，请稍后重试。","SERVER_ERROR");return;}
                done();
                try{success(data.data);}catch(applyError:*){ready=false;message="登录结果处理失败，请返回重试。";render();}
            });
            current.addEventListener(IOErrorEvent.IO_ERROR,function(e:Event):void {if(current===loader)done("暂时连接不上服务器，请稍后重试。");});
            current.addEventListener(SecurityErrorEvent.SECURITY_ERROR,function(e:Event):void {if(current===loader)done("连接被阻止，请检查服务器连接设置。");});
            timeout=new Timer(15000,1);timeout.addEventListener(TimerEvent.TIMER_COMPLETE,function(e:Event):void {done("连接超时，请检查网络后重试。");});timeout.start();
            try{current.load(req);}catch(error:*){done("无法发起请求，请重试。");}
        }
        private static function cancelNetwork():void {
            if(timeout){timeout.stop();timeout=null;}
            if(loader){try{loader.close();}catch(error:*){}loader=null;}
            busy=false;
        }
        private static function submit():void {
            if(page=="login" || page=="register" || page=="claim") {
                if(!form.username || !form.password){message="请填写账号和密码。";render();return;}
                if(!/^[A-Za-z0-9_]{4,24}$/.test(form.username)){message="账号需为 4–24 位字母、数字或下划线。";render();return;}
                if(String(form.password).length<6){message="密码需为 6–64 位字符。";render();return;}
                if(page!="login" && form.password!=form.confirm){message="两次输入的密码不一致。";render();return;}
                request(page=="claim"?"bind":page,{username:form.username,password:form.password,remember:remembered,proof:proof},accept);
            } else if(page=="inherit" || page=="code") {
                request("claim-preview",page=="code"?{code:form.code}:{viewer_id:form.viewer,inherit_password:form.inherit},function(data:Object):void {
                    proof=data.proof;claimProfile=data.profile;claimIsLocal=false;form={};navigate("claim");
                });
            } else if(page=="reset") {
                if(form.password!=form.confirm){message="两次输入的密码不一致。";render();return;}
                request("reset-password",{code:form.code,password:form.password},function(data:Object):void {
                    for each(var entry:Object in savedAccounts)if(entry.profile.username==data.username)entry.token="";
                    if(profile && profile.username==data.username)clearLiveSession();
                    persistAccounts();form={username:data.username};navigate("login");message="密码已重置，请使用新密码登录。";render();
                });
            }
        }
        private static function render():void {
            if(!root)return;
            root.removeChildren();fields={};
            var bg:Sprite=new Sprite();bg.name="login_backdrop";bg.graphics.beginFill(0x103B39,.46);bg.graphics.drawRect(0,0,stageRef.stageWidth,stageRef.stageHeight);bg.graphics.endFill();root.addChild(bg);
            card=new Sprite();card.name="login_card";
            listPage=Math.max(0,Math.min(listPage,Math.max(0,Math.ceil(savedAccounts.length/3)-1)));
            var listOffset:Number=-88*(3-Math.max(1,Math.min(3,savedAccounts.length-listPage*3)));
            var noticeGap:Number=message || storageNotice?44:0;
            var backGap:Number=savedAccounts.length?30:0;
            var noticeY:Number=0;
            var localGap:Number=readLegacy!=null?64:0;
            cardHeight=(page=="accounts"?556+listOffset:page=="remove"?416:page=="retry"?324:page=="local"?382:page=="welcome"?398:page=="bind"?382+localGap:page=="claim"?608:page=="register"?540+backGap:page=="reset"?534:page=="code"?344:page=="inherit"?424:462+backGap)+noticeGap;
            rounded(card,0,0,354,cardHeight,26,0xF8FCF8);
            card.filters=[new DropShadowFilter(12,90,0x123E39,.25,26,26,1,2)];root.addChild(card);
            rounded(card,153,16,48,4,2,0xD8EEE7);
            badge(card,94,32,36);
            label(card,"星点启程",140,30,120,25,INK,true,"center");
            var subtitle:String=page=="accounts"?"选择账号，确认后再进入游戏":page=="remove"?"管理本机记录，云端存档仍会保留":page=="retry"?"稍作停留，冒险仍在等你":page=="welcome"?"登录成功，请确认本次使用的账号":page=="bind"||page=="inherit"||page=="code"||page=="local"?"原来的角色、进度与 UID 都会保留":page=="claim"?(claimIsLocal?"已找到本机旧存档，为它设置登录账号":"确认你的冒险，设置登录账号"):page=="reset"?"找回账号，继续你的旅程":"与伙伴一起，开启下一段冒险";
            label(card,subtitle,22,80,310,12,MUTED,false,"center");
            if(page=="login" || page=="register") {
                tabs();
                input("username","账号", "4–24 位字母、数字或下划线",152,false,24);
                input("password","密码", "请输入密码",230,true,64);
                if(page=="register") {
                    input("confirm","确认密码","再次输入密码",308,true,64);
                    checkbox(28,392);noticeY=416;
                    button("创建新存档并启程",28,428+noticeGap,298,46,submit);
                    link("老玩家请点这里，绑定原存档",28,502+noticeGap,298,function():void{form={};navigate("bind");});
                } else {
                    checkbox(28,314);noticeY=338;
                    link("忘记密码？",230,314,96,function():void{navigate("reset");});
                    button("登  录",28,350+noticeGap,298,46,submit);
                    line(card,28,412+noticeGap,298);
                    link("已有游戏存档？绑定旧存档",28,426+noticeGap,298,function():void{form={};navigate("bind");});
                }
                if(savedAccounts.length)link("返回已保存账号",28,cardHeight-31,298,function():void{form={};navigate("accounts");},MUTED,12);
            } else if(page=="welcome") {
                playerCard(112);
                label(card,remembered?"已保存登录 · "+expiryLabel(expires):"仅本次登录，关闭后需重新输入密码",28,224,298,12,MUTED,false,"center");
                label(card,"确认后回到标题页，再点「点击开始」进入",28,246,298,12,MUTED,false,"center");
                noticeY=274;
                button("继续游戏",28,286+noticeGap,298,46,continueGame);
                link("切换 / 添加账号",28,352+noticeGap,298,switchAccount);
            } else if(page=="accounts") {
                label(card,"本机已保存  "+savedAccounts.length+" 个账号",28,108,240,13,MUTED);
                var pages:int=Math.max(1,Math.ceil(savedAccounts.length/3));
                listPage=Math.max(0,Math.min(listPage,pages-1));
                for(var index:int=listPage*3;index<Math.min(savedAccounts.length,listPage*3+3);index++)accountRow(savedAccounts[index],140+(index-listPage*3)*88);
                if(pages>1) {
                    link("上一页",28,410+listOffset,90,function():void{listPage--;render();},MUTED,13);
                    label(card,(listPage+1)+" / "+pages,128,410+listOffset,98,13,MUTED,false,"center");
                    link("下一页",236,410+listOffset,90,function():void{listPage++;render();},MUTED,13);
                } else label(card,"点选账号后，再确认进入游戏",28,410+listOffset,298,12,MUTED,false,"center");
                noticeY=444+listOffset;
                button("＋  添加账号",28,454+listOffset+noticeGap,298,46,function():void{form={};remembered=true;navigate("login");});
                link("老玩家绑定已有存档",28,518+listOffset+noticeGap,298,function():void{form={};remembered=true;navigate("bind");},MUTED,13);
            } else if(page=="remove") {
                playerCard(112,removingEntry.profile);
                wrappedLabel("仅移除本机账号与免密登录记录。\n角色和进度保留，可用账号密码重新添加。",24,230,306,12,MUTED,42);
                noticeY=284;
                button("确认移除本机记录",28,296+noticeGap,298,46,removeEntry,true);
                link("取消，返回账号列表",28,368+noticeGap,298,function():void{removingEntry=null;navigate("accounts");});
            } else if(page=="retry") {
                label(card,"暂时无法连接",28,110,298,20,INK,true,"center");
                wrappedLabel("登录记录已保留。\n网络恢复后，点击重试继续。",28,150,298,14,MUTED,48);
                noticeY=210;
                button("重新连接",28,222+noticeGap,298,46,function():void{resumeEntry(retryEntry);});
                link("选择其他账号",28,284+noticeGap,298,function():void{navigate(savedAccounts.length?"accounts":"login");});
            } else if(page=="bind") {
                label(card,"绑定已有存档",28,110,298,19,INK,true,"center");
                label(card,"验证原存档 → 确认角色 → 设置账号密码",20,142,314,12,MUTED,false,"center");
                if(readLegacy!=null)button("检测本机旧存档",28,178,298,50,function():void{detectLocalSave();});
                button("使用原 UID 和引继密码",28,178+localGap,298,50,function():void{form={};navigate("inherit");},true);
                button("使用服主提供的绑定码",28,242+localGap,298,50,function():void{form={};navigate("code");},true);
                label(card,"没有原 UID 或密码，可联系服主核验存档。",20,308+localGap,314,12,MUTED,false,"center");
                noticeY=336+localGap;
                link("返回登录",28,342+localGap+noticeGap,298,function():void{form={};navigate("login");});
            } else if(page=="local") {
                label(card,localOutcome=="bound"?"原存档已绑定账号":localOutcome=="retry"?"稍后继续验证":"核验本机旧存档",24,112,306,20,INK,true,"center");
                wrappedLabel(localOutcome=="bound"?"请使用已设置的账号密码登录。\n忘记密码可联系服主重置。":localOutcome=="retry"?"本机原记录已保留。\n网络恢复后，可手动重试。":localOutcome=="checking"?"正在确认原账号对应的冒险存档…":"暂时无法确认本机记录对应的存档。\n可使用原引继密码或服主绑定码。",24,158,306,13,MUTED,52);
                noticeY=222;
                button(localOutcome=="bound"?"前往账号登录":"重新检测本机记录",28,234+noticeGap,298,46,function():void{if(localOutcome=="bound"){form={};navigate("login");}else detectLocalSave();});
                link("使用其他方式绑定存档",28,302+noticeGap,298,function():void{navigate("bind");});
                link("返回登录",28,340+noticeGap,298,function():void{form={};navigate("login");},MUTED,13);
            } else if(page=="inherit") {
                label(card,"验证原存档",28,110,298,20,INK,true,"center");
                input("viewer","玩家 UID","输入原存档的玩家序号",152,false,15);
                input("inherit","原引继密码","输入游戏内设置的引继密码",230,true,64);
                noticeY=310;
                button("验证存档",28,322+noticeGap,298,46,submit);
                link("返回绑定方式",28,384+noticeGap,298,function():void{navigate("bind");});
            } else if(page=="code") {
                label(card,"使用绑定码",28,110,298,20,INK,true,"center");
                input("code","绑定码","输入服主提供的一次性绑定码",152,false,32);
                noticeY=232;
                button("验证存档",28,244+noticeGap,298,46,submit);
                link("返回绑定方式",28,304+noticeGap,298,function():void{navigate("bind");});
            } else if(page=="claim") {
                playerCard(112,claimProfile);
                input("username","设置账号","4–24 位字母、数字或下划线",228,false,24);
                input("password","设置密码","6–64 位字符",306,true,64);
                input("confirm","确认密码","再次输入密码",384,true,64);
                checkbox(28,468);noticeY=492;
                button("确认绑定此存档",28,504+noticeGap,298,46,submit);
                link("返回重新验证",28,568+noticeGap,298,function():void{proof="";navigate("bind");});
            } else if(page=="reset") {
                label(card,"重置登录密码",28,110,298,20,INK,true,"center");
                label(card,"请联系服主核验账号，获取一次性重置码。",24,142,306,12,MUTED,false,"center");
                input("code","重置码","输入服主提供的重置码",178,false,32);
                input("password","新密码","6–64 位字符",256,true,64);
                input("confirm","确认密码","再次输入新密码",334,true,64);
                noticeY=418;
                button("重置密码",28,430+noticeGap,298,46,submit);
                link("返回登录",28,494+noticeGap,298,function():void{navigate("login");});
            }
            if(message || storageNotice) {
                wrappedLabel(message || storageNotice,28,noticeY,298,12,0xC06551,42);
            }
            if(busy) {
                card.mouseChildren=false;
                var veil:Sprite=new Sprite();rounded(veil,0,0,354,cardHeight,26,0xF8FCF8,.76);card.addChild(veil);
                rounded(veil,89,cardHeight/2-34,176,68,16,0xFFFFFF);
                label(veil,"正在连接…",89,cardHeight/2-12,176,18,INK,true,"center");
            }
            resize();
        }
        private static function expiryLabel(value:Number):String {
            var remaining:Number=value-new Date().time;
            if(remaining<=0)return "需要重新登录";
            if(remaining<86400000)return "不到 1 天后需重新登录";
            return Math.ceil(remaining/86400000)+" 天内可直接登录";
        }
        private static function wrappedLabel(text:String,x:Number,y:Number,w:Number,size:Number,color:uint,h:Number):void {
            var field:TextField=label(card,text,x,y,w,size,color,false,"center");field.wordWrap=true;field.multiline=true;field.height=h;
        }
        private static function accountRow(entry:Object,y:Number):void {
            var row:Sprite=new Sprite();row.name="account_"+entry.profile.viewer_id;row.x=28;row.y=y;card.addChild(row);
            var usable:Boolean=Boolean(entry.token) && Number(entry.expires_at)>new Date().time;
            rounded(row,0,0,298,80,15,usable?0xE8F5EF:0xEFF2EF);
            rounded(row,12,18,40,42,12,usable?TEAL:0xAFBDB5);
            label(row,String(entry.profile.username || entry.profile.name || "账号").charAt(0).toUpperCase(),12,24,40,21,0xFFFFFF,true,"center");
            var title:TextField=label(row,entry.profile.username || "原已保存账号",63,9,223,15,INK,true);
            while(title.textWidth>218 && title.text.length>3)title.text=title.text.substr(0,title.text.length-2)+"…";
            var detail:TextField=label(row,String(entry.profile.name || "冒险者"),63,33,155,12,MUTED);
            while(detail.textWidth>150 && detail.text.length>3)detail.text=detail.text.substr(0,detail.text.length-2)+"…";
            label(row,entry.profile.viewer_id=="legacy"?"联网后显示原 UID":"UID  "+entry.profile.viewer_id,63,53,155,12,MUTED);
            row.buttonMode=true;row.mouseChildren=false;
            row.addEventListener(MouseEvent.CLICK,function(e:MouseEvent):void{e.stopImmediatePropagation();if(!busy)resumeEntry(entry);});
            var remove:Sprite=new Sprite();remove.name="remove_"+entry.profile.viewer_id;remove.x=258;remove.y=y+32;card.addChild(remove);
            // Keep the touch area generous while the visible action stays a quiet text link.
            rounded(remove,0,0,58,44,10,0xE8F5EF,0);
            label(remove,"移除",8,21,46,11,MUTED,false,"right");
            remove.buttonMode=true;remove.mouseChildren=false;
            remove.addEventListener(MouseEvent.CLICK,function(e:MouseEvent):void{e.stopImmediatePropagation();if(!busy){removingEntry=entry;navigate("remove");}});
        }
        private static function resize(e:Event=null):void {
            if(!card || !stageRef)return;
            var scale:Number=Math.min(stageRef.stageWidth*.92/354,stageRef.stageHeight*.84/cardHeight);
            card.scaleX=card.scaleY=scale;card.x=(stageRef.stageWidth-354*scale)/2;card.y=(stageRef.stageHeight-cardHeight*scale)/2;
            var bg:Sprite=root.getChildByName("login_backdrop") as Sprite;
            bg.width=stageRef.stageWidth;bg.height=stageRef.stageHeight;
        }
        private static function tabs():void {
            line(card,28,136,298);
            link("登录",28,110,149,function():void{navigate("login");},page=="login"?TEAL:MUTED);
            link("注册",177,110,149,function():void{navigate("register");},page=="register"?TEAL:MUTED);
            rounded(card,page=="login"?67:216,135,72,3,2,TEAL);
        }
        private static function playerCard(y:Number,preview:Object=null):void {
            var shown:Object=preview || profile;
            rounded(card,28,y,298,100,17,0xE8F5EF);
            var avatar:Sprite=new Sprite();card.addChild(avatar);avatar.x=45;avatar.y=y+18;
            avatar.graphics.beginFill(TEAL);avatar.graphics.drawCircle(32,32,31);avatar.graphics.endFill();
            avatar.graphics.lineStyle(2,0xFFFFFF,.9);avatar.graphics.drawCircle(32,25,10);avatar.graphics.drawRoundRect(16,40,32,16,14,14);
            var title:TextField=label(card,shown && shown.username?shown.username:"你的冒险存档",122,y+11,186,shown && String(shown.username).length>16?14:18,INK,true);
            while(title.textWidth>181 && title.text.length>3)title.text=title.text.substr(0,title.text.length-2)+"…";
            var name:TextField=label(card,(shown?shown.name:"冒险者")+"  ·  Lv."+(shown?shown.rank:1),122,y+39,186,13,0x65887B);
            while(name.textWidth>181 && name.text.length>3)name.text=name.text.substr(0,name.text.length-2)+"…";
            label(card,"UID  "+(shown?shown.viewer_id:""),122,y+65,186,13,MUTED);
        }
        private static function input(id:String,title:String,hint:String,y:Number,secret:Boolean,max:int):void {
            label(card,title,28,y,245,14,0x6A8379);
            var box:Sprite=new Sprite();box.name="field_"+id;card.addChild(box);
            rounded(box,28,y+25,298,46,10,0xFFFFFF);
            box.graphics.lineStyle(1,0xDCE9E1);box.graphics.drawRoundRect(28,y+25,298,46,10,10);
            var text:TextField=label(box,String(form[id] || ""),41,y+35,secret?230:271,17,INK);
            text.name=id;text.type=TextFieldType.INPUT;text.selectable=true;text.mouseEnabled=true;text.maxChars=max;text.displayAsPassword=secret;
            text.needsSoftKeyboard=true;text.height=32;
            if(id=="username")text.restrict="A-Za-z0-9_";
            if(id=="viewer")text.restrict="0-9";
            var placeholder:TextField=label(box,hint,41,y+38,secret?221:270,13,0xB2BEB7);
            placeholder.mouseEnabled=false;placeholder.visible=text.text.length==0;
            text.addEventListener(Event.CHANGE,function(e:Event):void {form[id]=text.text;placeholder.visible=text.text.length==0;});
            text.addEventListener(FocusEvent.FOCUS_IN,function(e:Event):void {placeholder.visible=false;});
            text.addEventListener(FocusEvent.FOCUS_OUT,function(e:Event):void {placeholder.visible=text.text.length==0;});
            fields[id]=text;
            if(secret) {
                var toggle:TextField;
                toggle=link("显示",274,y+37,42,function():void {text.displayAsPassword=!text.displayAsPassword;toggle.text=text.displayAsPassword?"显示":"隐藏";},MUTED,12,box);
            }
        }
        private static function checkbox(x:Number,y:Number):void {
            var area:Sprite=new Sprite();card.addChild(area);area.x=x;area.y=y;
            rounded(area,0,1,17,17,4,remembered?TEAL:0xD9E6DF);
            if(remembered){area.graphics.lineStyle(2,0xFFFFFF);area.graphics.moveTo(4,9);area.graphics.lineTo(7,12);area.graphics.lineTo(13,5);}
            label(area,"记住登录 30 天",26,0,150,13,MUTED);
            area.buttonMode=true;area.mouseChildren=false;area.addEventListener(MouseEvent.CLICK,function(e:Event):void {remembered=!remembered;render();});
        }
        private static function button(text:String,x:Number,y:Number,w:Number,h:Number,fn:Function,secondary:Boolean=false):void {
            var b:Sprite=new Sprite();b.name="button_"+text;b.x=x;b.y=y;card.addChild(b);
            if(secondary)rounded(b,0,0,w,h,13,0xFFFFFF);
            else {
                var m:Matrix=new Matrix();m.createGradientBox(w,h,Math.PI/2);
                b.graphics.beginGradientFill(GradientType.LINEAR,[0x31C7B6,0x17B4A8],[1,1],[0,255],m);b.graphics.drawRoundRect(0,0,w,h,15,15);b.graphics.endFill();
                b.graphics.lineStyle(1,0x81DDCC,.7);b.graphics.drawRoundRect(1,1,w-2,h-2,14,14);
            }
            b.filters=[new DropShadowFilter(3,90,secondary?0x7E9F93:0x12897F,.20,4,4)];
            label(b,text,10,(h-25)/2,w-20,18,secondary?0x628078:0xFFFFFF,!secondary,"center");
            b.buttonMode=true;b.mouseChildren=false;b.addEventListener(MouseEvent.CLICK,function(e:MouseEvent):void {e.stopImmediatePropagation();if(!busy)fn();});
        }
        private static function link(text:String,x:Number,y:Number,w:Number,fn:Function,color:uint=0x499B8F,size:Number=14,parent:Sprite=null):TextField {
            var b:Sprite=new Sprite();b.x=x;b.y=y;(parent || card).addChild(b);
            b.graphics.beginFill(0,0);b.graphics.drawRect(0,-6,w,31);b.graphics.endFill();
            var caption:TextField=label(b,text,0,0,w,size,color,false,"center");b.buttonMode=true;b.mouseChildren=false;
            b.addEventListener(MouseEvent.CLICK,function(e:MouseEvent):void {e.stopImmediatePropagation();if(!busy)fn();});
            return caption;
        }
        private static function label(parent:Sprite,text:String,x:Number,y:Number,w:Number,size:Number,color:uint,bold:Boolean=false,align:String="left"):TextField {
            var field:TextField=new TextField();field.embedFonts=true;field.defaultTextFormat=new TextFormat("SY",size,color,bold,null,null,null,null,align);
            field.text=text;field.x=x;field.y=y;field.width=w;field.height=size*1.6+4;field.selectable=false;field.mouseEnabled=false;parent.addChild(field);return field;
        }
        private static function rounded(p:Sprite,x:Number,y:Number,w:Number,h:Number,r:Number,color:uint,alpha:Number=1):void {
            p.graphics.lineStyle();p.graphics.beginFill(color,alpha);p.graphics.drawRoundRect(x,y,w,h,r*2,r*2);p.graphics.endFill();
        }
        private static function line(p:Sprite,x:Number,y:Number,w:Number):void {p.graphics.lineStyle(1,0xE2ECE5);p.graphics.moveTo(x,y);p.graphics.lineTo(x+w,y);p.graphics.lineStyle();}
        private static function badge(p:Sprite,x:Number,y:Number,s:Number):void {
            var b:Sprite=new Sprite();p.addChild(b);b.x=x;b.y=y;b.scaleX=b.scaleY=s/48;s=48;rounded(b,0,0,s,s,16,0xE3F5ED);
            b.graphics.beginFill(TEAL);b.graphics.moveTo(s/2,8);b.graphics.lineTo(s/2+5,s/2-5);b.graphics.lineTo(s-8,s/2);b.graphics.lineTo(s/2+5,s/2+5);b.graphics.lineTo(s/2,s-8);b.graphics.lineTo(s/2-5,s/2+5);b.graphics.lineTo(8,s/2);b.graphics.lineTo(s/2-5,s/2-5);b.graphics.endFill();
        }
    }
}
