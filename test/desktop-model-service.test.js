import test from "node:test";
import assert from "node:assert/strict";
import {
  createDesktopModelService, LOCAL_MODEL_ENDPOINT
} from "../desktop/local-model-service.js";

test("AI-0.1 local discovery makes no request before explicit list and never sends documents", async () => {
  const calls = [];
  const service = createDesktopModelService({
    fetchImpl: async (url, options) => {
      calls.push({url,options});
      return Response.json({data:[
        {id:"qwen3-vl-8b",owned_by:"lmstudio"},
        {id:"gguf-local",owned_by:"local"},
        {id:"qwen3-vl-8b",owned_by:"duplicate"}
      ]});
    }
  });
  assert.equal(calls.length,0);
  assert.equal(LOCAL_MODEL_ENDPOINT,"http://127.0.0.1:1234/v1");
  const response = await service.list();
  assert.equal(response.endpoint,LOCAL_MODEL_ENDPOINT);
  assert.equal(response.checked,true);
  assert.deepEqual(response.models, [
    {id:"qwen3-vl-8b",ownedBy:"lmstudio"},
    {id:"gguf-local",ownedBy:"local"}
  ]);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"http://127.0.0.1:1234/v1/models");
  assert.equal(calls[0].options.method,"GET");
  assert.equal(calls[0].options.redirect,"error");
  assert.equal(calls[0].options.body,undefined);
  assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.equal(typeof service.chat,"function");
  assert.equal(typeof service.cancel,"function");
  assert.equal(Object.hasOwn(service,"readFiles"),false);
});

test("AI-0.1 connection errors never return private response bodies", async () => {
  const privateText="local-user-model-secret-not-shared";
  const service=createDesktopModelService({fetchImpl:async ()=>
    new Response(privateText,{status:503})
  });
  await assert.rejects(service.list(),error =>
    error.message==="PROVIDER_HTTP_ERROR" && !String(error).includes(privateText));
});

test("AI-0.1 rejects untrusted model IDs and excessively large response lists",async()=>{
  const malformed=createDesktopModelService({fetchImpl:async()=>Response.json({
    data:[{id:"unsafe\nname"}]
  })});
  await assert.rejects(malformed.list(),/BAD_MODEL/);
  const oversized=createDesktopModelService({fetchImpl:async()=>Response.json({
    data:Array.from({length:129},(_,i)=>({id:"model-"+i}))
  })});
  await assert.rejects(oversized.list(),/MODEL_LIST_TOO_LARGE/);
});

test("AI-0.1 does not expose a way to override endpoint, model paths or remote access",async()=>{
  const seen=[];
  const service=createDesktopModelService({fetchImpl:async(url)=>{
    seen.push(url);
    return Response.json({data:[]});
  }});
  await service.list({endpoint:"https://external.invalid/v1",path:"/etc"});
  assert.deepEqual(seen,["http://127.0.0.1:1234/v1/models"]);
});


test("AI-0.2 only explicitly submitted user text reaches selected discovered local model", async () => {
  const calls=[];
  const service=createDesktopModelService({fetchImpl:async(url,options)=>{
    calls.push({url,options});
    return url.endsWith("/models") ?
      Response.json({data:[{id:"selected-qwen",owned_by:"local"}]}) :
      Response.json({model:"different-provider-alias",
        choices:[{message:{content:"Merhaba 🌿"}}]});
  }});
  await assert.rejects(service.chat({
    requestId:"req1",model:"selected-qwen",prompt:"Hello"
  }),/INVALID_CHAT_REQUEST/);
  assert.equal(calls.length,0);
  await service.list();
  assert.equal(calls.length,1);
  const response=await service.chat({
    requestId:"req2",model:"selected-qwen",
    prompt:"Bana yardım et, belge ekleme."
  });
  assert.deepEqual(response,{model:"selected-qwen",content:"Merhaba 🌿"});
  assert.equal(calls.length,2);
  assert.equal(calls[1].url,"http://127.0.0.1:1234/v1/chat/completions");
  assert.equal(calls[1].options.method,"POST");
  assert.equal(calls[1].options.redirect,"error");
  assert.equal(calls[1].options.headers.Authorization,undefined);
  const payload=JSON.parse(calls[1].options.body);
  assert.deepEqual(payload.messages,[{
    role:"user",content:"Bana yardım et, belge ekleme."
  }]);
  assert.equal(payload.model,"selected-qwen");
  assert.equal(payload.stream,false);
  assert.equal(payload.max_tokens,1024);
  assert.equal(Object.hasOwn(payload,"document"),false);
  assert.equal(Object.hasOwn(payload,"system"),false);
  assert.equal(Object.hasOwn(payload,"tools"),false);
  assert.deepEqual(service.cancel({requestId:"req2"}),{cancelled:false});
});

test("AI-0.2 validates request identifiers, prompt lengths and chosen model", async () => {
  let count=0;
  const service=createDesktopModelService({fetchImpl:async(url)=>{
    count++;
    return Response.json(url.endsWith("/models") ? {
      data:[{id:"one"}]} : {choices:[{message:{content:"ok"}}]});
  }});
  await service.list();
  for(const request of [
    {requestId:"../escape",model:"one",prompt:"x"},
    {requestId:"req",model:"unknown",prompt:"x"},
    {requestId:"req",model:"one",prompt:"  "},
    {requestId:"req",model:"one",prompt:"a".repeat(8193)},
    {requestId:"req",model:"one",prompt:"\0"},
    {requestId:null,model:"one",prompt:"hello"}
  ]) await assert.rejects(service.chat(request),/INVALID_CHAT_REQUEST/);
  assert.equal(count,1);
  await assert.rejects(async()=>service.cancel({requestId:"%"}),/INVALID_CHAT_REQUEST/);
  assert.deepEqual(service.cancel({requestId:"none"}),{cancelled:false});
});

test("AI-0.2 enforces a single in-flight request and real abort cancellation", async () => {
  let pendingSignal,chatCalls=0;
  const service=createDesktopModelService({fetchImpl:async(url,options)=>{
    if(url.endsWith("/models"))return Response.json({data:[{id:"one"}]});
    chatCalls++;
    pendingSignal=options.signal;
    return new Promise((_,reject)=>{
      options.signal.addEventListener("abort",
        ()=>reject(Object.assign(new Error("aborted"),{name:"AbortError"})),{once:true});
    });
  }});
  await service.list();
  const promise=service.chat({requestId:"first",model:"one",prompt:"Long reply"});
  await assert.rejects(service.chat({
    requestId:"second",model:"one",prompt:"other"
  }),/MODEL_BUSY/);
  await assert.rejects(service.list(),/MODEL_BUSY/);
  assert.equal(chatCalls,1);
  assert.equal(pendingSignal.aborted,false);
  assert.deepEqual(service.cancel({requestId:"wrong"}),{cancelled:false});
  assert.deepEqual(service.cancel({requestId:"first"}),{cancelled:true});
  assert.equal(pendingSignal.aborted,true);
  await assert.rejects(promise,/CANCELLED/);
  assert.deepEqual(service.cancel({requestId:"first"}),{cancelled:false});
  service.dispose();
});

test("AI-0.2 caps response length and rejects malformed responses without echoing content",async()=>{
  const content="x".repeat(16001);
  const huge=createDesktopModelService({fetchImpl:async(url)=>
    Response.json(url.endsWith("/models") ? {data:[{id:"one"}]} :
      {choices:[{message:{content}}]})
  });
  await huge.list();
  await assert.rejects(huge.chat({
    requestId:"huge",model:"one",prompt:"hey"
  }),/BAD_CHAT_RESPONSE/);
  const bad=createDesktopModelService({fetchImpl:async(url)=>
    Response.json(url.endsWith("/models") ? {data:[{id:"one"}]} :
      {choices:[{message:{content:null}}]})
  });
  await bad.list();
  await assert.rejects(bad.chat({
    requestId:"bad",model:"one",prompt:"hey"
  }),/BAD_CHAT_RESPONSE/);
});
