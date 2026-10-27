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
  assert.equal(Object.hasOwn(service,"chat"),false);
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
