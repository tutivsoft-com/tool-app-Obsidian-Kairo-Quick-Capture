/* Fixed Matomo events. Delivery is bounded and acknowledged before removal. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TutivSoftMatomo=api;})(globalThis,function(){
  'use strict';
  const actions={feature:['started','completed','failed'],onboarding:['started','completed'],ai:['completed','failed'],billing:['checkout_opened'],error:['operation_failed'],game:['level_started','level_completed','level_failed']};
  class MatomoClient {
    constructor(config,dependencies={}){
      this.config=config;this.enabled=config.enabled!==false;this.storage=dependencies.storage;this.send=dependencies.send;
      this.visitor='';this.lastScreen='';this.busy=false;this.initializing=null;this.pending=[];this.saving=Promise.resolve();this.retry=null;
    }
    get configured(){return this.enabled&&Number.isInteger(this.config.siteId)&&this.config.siteId>1&&/^[a-z][a-z0-9_]{0,63}$/.test(this.config.product);}
    get queueKey(){return 'matomo.pending.'+this.config.product;}
    initialize(){if(!this.initializing)this.initializing=this.initializeOnce();return this.initializing;}
    async initializeOnce(){
      if(!this.configured)return;
      try{
        const key='matomo.v1.'+this.config.product;this.visitor=await this.storage?.get(key)||'';
        if(!/^[a-f0-9]{16}$/.test(this.visitor)){
          const bytes=new Uint8Array(8);crypto.getRandomValues(bytes);
          this.visitor=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');await this.storage?.set(key,this.visitor);
        }
        try{const saved=JSON.parse(await this.storage?.get(this.queueKey)||'[]');if(Array.isArray(saved))this.pending=saved.filter(s=>typeof s==='string'&&s.length<8192).slice(0,64);}catch(_){}
        void this.flush();
      }catch(_){this.visitor='';this.initializing=null;}
    }
    async screen(name){
      if(!this.configured||!(this.config.screens||['home','settings','login','onboarding']).includes(name))return;
      await this.initialize();if(name===this.lastScreen)return;
      if(this.enqueue({action_name:name},name))this.lastScreen=name;
    }
    async event(category,action,name,value){
      if(!Object.prototype.hasOwnProperty.call(actions,category)||!actions[category].includes(action)||!(this.config.features||[]).includes(name))return;
      if(value!==undefined&&(!Number.isFinite(value)||value<0||value>86400000))return;
      await this.initialize();this.enqueue({e_c:category,e_a:action,e_n:name,...(value===undefined?{}:{e_v:String(value)})},'feature');
    }
    enqueue(fields,screen){
      if(!this.configured||!this.visitor||this.pending.length>=64)return false;
      this.pending.push(new URLSearchParams({idsite:String(this.config.siteId),rec:'1',apiv:'1',send_image:'0',_id:this.visitor,rand:String(Date.now())+Math.random(),url:'https://tutivsoft.com/analytics/apps/'+this.config.product+'/'+(this.config.platform||'web')+'/'+screen,...fields}).toString());
      void this.save();void this.flush();return true;
    }
    save(){const snapshot=JSON.stringify(this.pending);this.saving=this.saving.then(()=>this.storage?.set(this.queueKey,snapshot)).catch(()=>{});return this.saving;}
    dispose(){this.enabled=false;clearTimeout(this.retry);}
    async flush(){
      if(!this.configured||this.busy||!this.visitor)return;
      this.busy=true;clearTimeout(this.retry);
      try{
        await this.saving;
        while(this.configured&&this.pending.length){
          const body=this.pending[0];const controller=new AbortController();let timer;
          try{
            // requestUrl has no cancellation API. Keep the gate until it settles,
            // avoiding overlapping retries and duplicate sends after a deadline.
            const response=this.send?await this.send(body):await (async()=>{
              timer=setTimeout(()=>controller.abort(),5000);
              return fetch('https://atcdn.cyou/matomo.php',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded'},credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal});
            })();
            if(!response||typeof response.status!=='number'||response.status<200||response.status>=300)break;
            this.pending.shift();await this.save();
          }catch(_){break;}finally{clearTimeout(timer);}
        }
      }finally{
        this.busy=false;
        if(this.configured&&this.pending.length)this.retry=setTimeout(()=>{void this.flush();},30000);
      }
    }
  }
  function localStorageAdapter(storage){return{get:async k=>storage.getItem(k),set:async(k,v)=>storage.setItem(k,v)};}
  return{MatomoClient,localStorageAdapter};
});
