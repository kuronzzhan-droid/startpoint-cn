package cn.admission {
    /** Credential lifecycle shared by login, HTTP, TCP and background renewal. */
    public final class AdmissionSession {
        private var transport:Function, clock:Function;
        private var waiters:Array=[];
        private var running:Boolean=false, mustBind:Boolean=false, epoch:int=0;
        private var grant:String="", account:String="", bound:String="";
        private var validUntil:Number=0, renewAt:Number=0, retryAt:Number=0;
        private var stopped:Object;
        public function AdmissionSession(send:Function, now:Function) { transport=send;clock=now; }
        public function get token():String { return grant; }
        public function get session():String { return account; }
        public function get busy():Boolean { return running; }
        public function observe(value:String, authenticated:Boolean=false):void {
            if(value!=account) { account=value;epoch++; }
            if(authenticated)bound=value;
        }
        public function usable(binding:Boolean=true):Boolean {
            return stopped==null && grant!="" && clock()+60000<validUntil && (!binding || account==bound);
        }
        public function allowRetry():void { stopped=null; }
        public function background():void {
            if(!running && stopped==null && grant && account && clock()>=renewAt && clock()>=retryAt)
                ensure(function(r:Object):void {},true,true);
        }
        public function ensure(done:Function, force:Boolean=false, binding:Boolean=true, action:String=""):void {
            if(!force && usable(binding)) { done({ok:true});return; }
            if(stopped!=null) { done(stopped);return; }
            if(clock()<retryAt) { done({ok:false,action:"retry",code:"CLIENT_RETRY_LATER",message:"连接暂时不可用，请稍后重试。"});return; }
            if(waiters.length>=32) { done({ok:false,action:"retry",message:"连接请求较多，请稍后重试。"});return; }
            waiters.push(done);mustBind=mustBind || binding;
            if(running)return;
            running=true;
            var revision:int=epoch;
            if(action=="handshake")clearGrant();
            if(action=="login") { bound=""; }
            if(grant && (!mustBind || account==bound)) renew(revision);
            else if(grant && mustBind && account) rebind(revision);
            else handshake(revision);
        }
        private function clearGrant():void { grant="";validUntil=0;renewAt=0;bound=""; }
        private function changed(revision:int):Boolean {
            if(revision==epoch)return false;
            finish({ok:false,action:"retry",message:"账号状态已变化，请重试。"});return true;
        }
        private function issued(r:Object, started:Number):Boolean {
            if(!r || r.ok!==true || !r.data || !r.data.token)return false;
            var d:Object=r.data, ttl:Number=Number(d.expires_in_ms);
            if(!isFinite(ttl))ttl=Number(d.expires_at)-Number(d.server_time);
            if(!isFinite(ttl) || ttl<=0)return false;
            var remaining:Number=Math.max(0,Math.min(ttl,1800000)-(clock()-started));
            grant=String(d.token);validUntil=clock()+remaining;
            var after:Number=Number(d.renew_after_ms);
            if(!isFinite(after))after=Math.max(0,ttl-300000);
            renewAt=clock()+Math.max(1000,Math.min(remaining,after-(clock()-started)));
            return true;
        }
        private function renew(revision:int):void {
            var started:Number=clock();
            transport("renew",{},grant,account,function(r:Object):void {
                if(changed(revision))return;
                if(issued(r,started)) { finish({ok:true});return; }
                if(r && (r.action=="handshake" || r.action=="renew")) { clearGrant();handshake(revision); }
                else if(r && r.action=="login" && account) { bound="";rebind(revision); }
                else finish(r && r.ok===true ? {ok:false,action:"retry",message:"服务器校验响应无效，请稍后重试。"} : r);
            });
        }
        private function handshake(revision:int):void {
            // The transport performs the single challenge/proof pair; never a game mutation.
            var started:Number=clock();
            transport("handshake",{},"","",function(r:Object):void {
                if(changed(revision))return;
                if(!issued(r,started)) { finish(r && r.ok===true ? {ok:false,action:"retry",message:"服务器校验响应无效，请稍后重试。"} : r);return; }
                bound="";
                if(mustBind && account)rebind(revision);
                else finish({ok:true});
            });
        }
        private function rebind(revision:int):void {
            if(!account) { finish({ok:false,action:"login",message:"请返回标题重新登录。"});return; }
            transport("resume",{token:account},grant,account,function(r:Object):void {
                if(changed(revision))return;
                if(r && r.ok===true && r.data && r.data.token==account) { bound=account;finish({ok:true}); }
                else if(r && r.action=="handshake") { clearGrant();finish(r); }
                else finish(r && r.action ? r : {ok:false,action:"login",message:r && r.message ? r.message : "登录状态已过期，请返回标题重新登录。"});
            });
        }
        private function finish(r:Object):void {
            if(!r || r.ok!==true) {
                if(!r || !r.action)r={ok:false,action:"retry",message:"暂时无法连接服务器，请稍后重试。"};
                if(r.action=="update") { clearGrant();stopped=r; }
                else if(r.action=="login") { bound="";stopped=r; }
                else {
                    var delay:Number=Number(r.retry_after_ms);
                    if(!isFinite(delay) || delay<1000)delay=10000;
                    retryAt=clock()+Math.min(delay,300000);
                    // A transient background failure retains a still-valid ticket and live TCP.
                    renewAt=retryAt;
                }
            } else { retryAt=0;stopped=null; }
            var callbacks:Array=waiters;waiters=[];running=false;mustBind=false;
            for each(var callback:Function in callbacks)callback(r);
        }
    }
}
