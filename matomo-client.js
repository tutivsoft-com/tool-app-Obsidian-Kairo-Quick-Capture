/* Matomo tracking only. No prompts, settings UI or changes to existing preferences. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TutivSoftMatomo=api;})(globalThis,function(){
  'use strict';
  const actions={feature:['started','completed','failed'],onboarding:['started','completed'],ai:['completed','failed'],billing:['checkout_opened'],error:['operation_failed'],game:['level_started','level_completed','level_failed']};
  class MatomoClient {
    constructor(config,dependencies={}){this.config=config;this.enabled=config.enabled!==false;this.storage=dependencies.storage;this.send=dependencies.send;this.visitor='';this.lastScreen='';this.busy=false;this.initializing=null;this.transportPending=false;}
    get configured(){return this.enabled&&Number.isInteger(this.config.siteId)&&this.config.siteId>1&&/^[a-z][a-z0-9_]{0,63}$/.test(this.config.product);}
    initialize(){if(!this.initializing)this.initializing=this.initializeOnce();return this.initializing;}
    async initializeOnce(){
      if(!this.configured)return;
      try{const key='matomo.v1.'+this.config.product;this.visitor=await this.storage?.get(key)||'';
        if(!/^[a-f0-9]{16}$/.test(this.visitor)){const bytes=new Uint8Array(8);crypto.getRandomValues(bytes);this.visitor=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');await this.storage?.set(key,this.visitor);}}
      catch(_){this.enabled=false;}
    }
    screen(name){if(!this.configured||!this.visitor)return Promise.resolve();if(!(this.config.screens||['home','settings','login','onboarding']).includes(name)||name===this.lastScreen)return Promise.resolve();this.lastScreen=name;return this.track({action_name:name},name);}
    event(category,action,name,value){
      if(!Object.prototype.hasOwnProperty.call(actions,category)||!actions[category].includes(action)||!(this.config.features||[]).includes(name))return Promise.resolve();
      if(value!==undefined&&(!Number.isFinite(value)||value<0||value>86400000))return Promise.resolve();
      return this.track({e_c:category,e_a:action,e_n:name,...(value===undefined?{}:{e_v:String(value)})},'feature');
    }
    async track(fields,screen){
      if(!this.configured||!this.visitor||this.busy||this.transportPending)return;
      this.busy=true;
      const body=new URLSearchParams({idsite:String(this.config.siteId),rec:'1',apiv:'1',_id:this.visitor,url:'https://tutivsoft.com/analytics/apps/'+this.config.product+'/'+(this.config.platform||'web')+'/'+screen,...fields}).toString();
      const controller=new AbortController();let timer;
      try{
        let request;
        if(this.send){
          // requestUrl cannot be cancelled: retain one outstanding transport even
          // after the caller deadline. Late settlement never owns the send gate.
          this.transportPending=true;
          request=Promise.resolve().then(()=>this.send(body));
          request=request.then(()=>{this.transportPending=false;},()=>{this.transportPending=false;});
        }else request=fetch('https://atcdn.cyou/matomo.php',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded'},credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal});
        await Promise.race([request,new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve();},5000);})]);
      }catch(_){}finally{clearTimeout(timer);this.busy=false;}
    }
  }
  function localStorageAdapter(storage){return{get:async k=>storage.getItem(k),set:async(k,v)=>storage.setItem(k,v)};}
  return{MatomoClient,localStorageAdapter};
});
