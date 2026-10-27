import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {EventEmitter} from "node:events";
import {createOwnedModelRunner, OWNED_MODEL_URL} from "../desktop/owned-model-runner.js";
import {createDesktopModelService} from "../desktop/local-model-service.js";

async function files(t) {
  const root=await mkdtemp(join(tmpdir(),"bp-owned-runner-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const executable=join(root,"llama-server.exe");
  const model=join(root,"Deneme.Q4_K_M.gguf");
  await writeFile(executable,"binary-test-fixture");
  await writeFile(model,"gguf-test-fixture");
  return {executable,model};
}
function fakeProcess() {
  const proc=new EventEmitter();proc.exitCode=null;proc.killed=false;
  proc.kill=()=>{
    proc.killed=true;proc.exitCode=0;queueMicrotask(()=>proc.emit("exit",0));
    return true;
  };
  return proc;
}
test("owned runtime accepts only user-selected GGUF and llama-server, no disk scanning",async t=>{
  const {executable,model}=await files(t);
  const runner=createOwnedModelRunner({platform:"win32"});
  assert.equal(runner.status().phase,"idle");
  assert.equal(runner.status().engine,null);
  await assert.rejects(runner.start(),/MODEL_RUNNER_NOT_CONFIGURED/);
  await assert.rejects(runner.choose("not-allowed",model),/MODEL_RUNNER_INVALID_PATH/);
  await assert.rejects(runner.choose("engine",model),/MODEL_RUNNER_BAD_ENGINE/);
  await assert.rejects(runner.choose("model",executable),/MODEL_RUNNER_BAD_MODEL/);
  assert.deepEqual(Object.keys(await runner.choose("engine",executable)),
    ["phase","engine","model","ready","failure"]);
  await runner.choose("model",model);
  assert.equal(runner.status().engine,"llama-server.exe");
  assert.equal(runner.status().model,"Deneme.Q4_K_M.gguf");
  assert.equal("path" in runner.status(),false);
  assert.equal("token" in runner.status(),false);
});
test("owned runtime starts only fixed loopback auth-protected llama.cpp process and can stop it",async t=>{
  const {executable,model}=await files(t);
  let launch,process;
  const token="a".repeat(48);
  const runner=createOwnedModelRunner({
    platform:"win32",tokenImpl:()=>token,
    spawnImpl:(bin,args,opts)=>{launch={bin,args,opts};process=fakeProcess();return process;},
    fetchImpl:async(url,opts)=>{
      assert.equal(url,OWNED_MODEL_URL+"/models");
      assert.equal(opts.headers.Authorization,"Bearer "+token);
      assert.equal(opts.redirect,"error");
      return Response.json({data:[{id:"bellekpad-local"}]});
    },
    delay:async()=>{}
  });
  await runner.choose("engine",executable);
  await runner.choose("model",model);
  const ready=await runner.start();
  assert.equal(ready.ready,true);
  assert.equal(ready.apiKey,token);
  assert.equal(ready.endpoint,OWNED_MODEL_URL);
  assert.deepEqual(launch.args,["--model",model,"--host","127.0.0.1",
    "--port","12883","--ctx-size","4096","--n-gpu-layers","auto",
    "--alias","bellekpad-local","--api-key",token,"--no-webui"]);
  assert.equal(launch.opts.shell,false);
  assert.equal(launch.opts.windowsHide,true);
  assert.equal(launch.opts.stdio,"ignore");
  assert.equal(launch.bin,executable);
  assert.equal(runner.status().ready,true);
  await assert.rejects(runner.choose("model",model),/MODEL_RUNNER_BUSY/);
  runner.stop();
  assert.equal(process.killed,true);
  assert.equal(runner.status().phase,"idle");
  assert.equal("apiKey" in runner.status(),false);
});
test("owned runtime switches chat to its own loopback without cloud or other application",async()=>{
  const requests=[];
  const service=createDesktopModelService({fetchImpl:async(url,opts)=>{
    requests.push({url,opts});
    if(url.endsWith("/models"))return Response.json({data:[{id:"bellekpad-local"}]});
    return Response.json({choices:[{message:{content:"Kendi motorumuzdan selam."}}]});
  }});
  assert.throws(()=>service.useOwned({
    endpoint:"https://other.invalid/v1",token:"b".repeat(48)
  }),/INVALID_CHAT_REQUEST/);
  service.useOwned({endpoint:OWNED_MODEL_URL,token:"c".repeat(48)});
  const listed=await service.list();
  assert.equal(listed.endpoint,OWNED_MODEL_URL);
  const answer=await service.chat({requestId:"owned_one",model:"bellekpad-local",prompt:"Merhaba"});
  assert.equal(answer.content,"Kendi motorumuzdan selam.");
  assert.equal(requests.length,2);
  assert.ok(requests.every(x=>x.url.startsWith(OWNED_MODEL_URL)));
  assert.ok(requests.every(x=>x.opts.headers.Authorization==="Bearer "+"c".repeat(48)));
  service.useExternal();
  assert.equal((await service.list()).endpoint,"http://127.0.0.1:1234/v1");
  assert.equal(requests[2].opts.headers.Authorization,undefined);
});
test("owned runtime cannot be ready if authenticated model alias never responds",async t=>{
  const {executable,model}=await files(t);let tick=0,process;
  const runner=createOwnedModelRunner({
    platform:"win32",tokenImpl:()=>"d".repeat(48),
    spawnImpl:()=>{process=fakeProcess();return process;},
    now:()=>++tick*91000,
    delay:async()=>{},
    fetchImpl:async()=>Response.json({data:[]})
  });
  await runner.choose("engine",executable);
  await runner.choose("model",model);
  await assert.rejects(runner.start(),/MODEL_RUNNER_TIMEOUT/);
  assert.equal(process.killed,true);
  assert.equal(runner.status().ready,false);
});
