import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background, Controls, Handle, MiniMap, Position, addEdge,
  applyEdgeChanges, applyNodeChanges,
  type Edge, type Node, type NodeProps, type Connection,
  type NodeChange, type EdgeChange
} from "@xyflow/react";

type InputSpec = [string | string[], Record<string, unknown>?];
type Definition = {
  input: {required?: Record<string, InputSpec>, optional?: Record<string, InputSpec>};
  output?: string[];
};
type Catalog = Record<string, Definition>;
type GraphNode = Node<{label: string, nodeKind: string, definition: Definition, inputs: Record<string, unknown>}, "comfy">;
type Engine = {state: string, pid: number | null, failure: string | null};
type Result = {job_id: string, queue_number: number | null};
type ErrorData = {detail?: unknown, error?: string};

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  const result = await fetch(url, {headers: {"Content-Type": "application/json"}, ...init});
  let json: unknown;
  try { json = await result.json(); }
  catch { throw new Error("Geçersiz backend yanıtı."); }
  if (!result.ok) {
    const info = json as ErrorData;
    throw new Error(typeof info.detail === "string" ? info.detail : (info.error || "İşlem başarısız."));
  }
  return json as T;
}

function NodeCard({data, selected}: NodeProps<GraphNode>) {
  const inputNames = Object.keys({
    ...(data.definition.input?.required || {}),
    ...(data.definition.input?.optional || {})
  });
  const outputs = data.definition.output || [];
  return <div className={"node-card " + (selected ? "selected" : "")}>
    <strong>{data.label}</strong>
    <small>{data.nodeKind}</small>
    <div className="port-columns">
      <div>{inputNames.map(name=><div className="port" key={name}>
        <Handle type="target" position={Position.Left} id={name} style={{top: "auto", position: "relative", left: -11}} />
        <span>{name}</span>
      </div>)}</div>
      <div>{outputs.map((type, index)=><div className="port output" key={index}>
        <span>{type} #{index}</span>
        <Handle type="source" position={Position.Right} id={String(index)} style={{top: "auto", position: "relative", right: -11}} />
      </div>)}</div>
    </div>
  </div>;
}
const nodeTypes = {comfy: NodeCard};

export default function App() {
  const [engine, setEngine] = useState<Engine>({state:"unconfigured",pid:null,failure:null});
  const [catalog, setCatalog] = useState<Catalog>({});
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [parameters, setParameters] = useState("{}");
  const [notice, setNotice] = useState("Motorun gerçek durumu backend üzerinden okunur.");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Result | null>(null);
  const [history, setHistory] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try { setEngine(await callApi<Engine>("/api/engine")); }
    catch { setNotice("Backend erişilemiyor. Yerel servisi başlat."); }
  },[]);
  useEffect(()=>{ void refresh(); const timer = setInterval(()=>{void refresh()},2000); return ()=>clearInterval(timer)},[refresh]);
  useEffect(()=>{
    if(engine.state !== "ready") {setCatalog({});return;}
    void callApi<Catalog>("/api/workflow/nodes").then(c=>{
      setCatalog(c);
      setKind(previous => previous && c[previous] ? previous : (Object.keys(c)[0] || ""));
    }).catch(e=>setNotice(String(e)));
  },[engine.state]);

  const chosen = nodes.find(n=>n.id===selected);
  useEffect(()=>{ setParameters(chosen ? JSON.stringify(chosen.data.inputs, null, 2) : "{}"); },[chosen?.id]);
  const kinds = useMemo(()=>Object.keys(catalog).filter(k=>k.toLowerCase().includes(query.toLowerCase())).slice(0,100),[catalog,query]);

  const engineAction = async (action:"start"|"stop")=>{
    setBusy(true);
    try {setEngine(await callApi<Engine>("/api/engine/"+action,{method:"POST"}));setNotice("Motor: "+action+" isteği kabul edildi.");}
    catch(e){setNotice(String(e));}
    finally{setBusy(false);}
  };

  const addNode = ()=>{
    if (!kind || !catalog[kind]) return;
    const id = crypto.randomUUID().slice(0,8);
    setNodes(old=>[...old,{id,type:"comfy",position:{x:100+(old.length%4)*260,y:80+Math.floor(old.length/4)*200},
      data:{label:kind,nodeKind:kind,definition:catalog[kind],inputs:{}}}]);
    setSelected(id);
  };
  const saveParams = ()=>{
    if(!selected) return;
    try{
      const value: unknown = JSON.parse(parameters);
      if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("JSON nesnesi gerekli.");
      setNodes(previous=>previous.map(n=>n.id===selected?{...n,data:{...n.data,inputs:value as Record<string,unknown>}}:n));
      setNotice("Parametreler grafiğe işlendi; sunucu doğrulaması için Kontrol et.");
    }catch(e){setNotice("Geçersiz parametre JSON: "+String(e))}
  };

  const compiledGraph = ()=>({
    nodes:nodes.map(n=>({id:n.id,type:n.data.nodeKind,inputs:n.data.inputs})),
    edges:edges.map(e=>({source:e.source,sourceHandle:Number(e.sourceHandle),target:e.target,targetHandle:e.targetHandle}))
  });
  const run = async (submit:boolean)=>{
    setBusy(true); setHistory(null);
    try{
      if(submit){
        const value = await callApi<Result>("/api/generations",{method:"POST",body:JSON.stringify(compiledGraph())});
        setJob(value);setNotice("İş ComfyUI kuyruğuna alındı: "+value.job_id);
      }else{
        const result=await callApi<{prompt:unknown}>("/api/workflows/compile",{method:"POST",body:JSON.stringify(compiledGraph())});
        setNotice("Graph kabul edildi. Derlenen API prompt: "+Object.keys(result.prompt as object).length+" node.");
      }
    }catch(e){setNotice(String(e))}
    finally{setBusy(false)}
  };
  const pollJob=async()=>{
    if (!job)return;
    try{setHistory(await callApi<unknown>("/api/generations/"+encodeURIComponent(job.job_id)));}
    catch(e){setNotice(String(e))}
  };
  const cancelJob=async()=>{
    if (!job)return;
    try{const result=await callApi<{cancelled:boolean}>("/api/generations/"+encodeURIComponent(job.job_id)+"/cancel",{method:"POST"});
      setNotice(result.cancelled?"İptal istendi.":"İş zaten bitmiş veya kuyrukta bulunamadı.");
    }catch(e){setNotice(String(e))}
  };
  const onConnect=useCallback((link:Connection)=>setEdges(old=>addEdge(link,old)),[]);
  const onNodesChange=useCallback((changes:NodeChange<GraphNode>[])=>setNodes(old=>applyNodeChanges(changes,old) as GraphNode[]),[]);
  const onEdgesChange=useCallback((changes:EdgeChange<Edge>[])=>setEdges(old=>applyEdgeChanges(changes,old)),[]);
  return <div className="app">
    <aside className="side">
      <div className="brand"><span>◈</span> bellekpad <small>EFSS · WEB AI CORE</small></div>
      <div className="nav active">◆ Workflow Studio</div>
      <div className="nav disabled">Sohbet · R3</div>
      <div className="nav disabled">Notlar · R5</div>
      <div className="nav disabled">Projeler · R6</div>
      <div className="spacer"/>
      <p className="caption">Backend yönetiminde</p>
      <div className={"engine "+engine.state}><b>● {engine.state.toUpperCase()}</b><small>{engine.pid? "PID "+engine.pid : engine.failure || "Kendi motorumuz"}</small></div>
      <div className="actions">
        <button onClick={()=>void engineAction("start")} disabled={busy||!["stopped","failed"].includes(engine.state)}>Başlat</button>
        <button onClick={()=>void engineAction("stop")} disabled={busy||!["starting","ready","failed"].includes(engine.state)}>Durdur</button>
      </div>
    </aside>
    <main className="workspace">
      <header><div><strong>Workflow Studio</strong><small>React Flow → BellekPad validator → ComfyUI Engine</small></div>
        <div className="actions">
          <button disabled={busy||engine.state!=="ready"||!nodes.length} onClick={()=>void run(false)}>Kontrol et</button>
          <button className="primary" disabled={busy||engine.state!=="ready"||!nodes.length} onClick={()=>void run(true)}>▶ Üret</button>
        </div>
      </header>
      <div className="work-body">
        <section className="canvas">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_,node)=>setSelected(node.id)} onPaneClick={()=>setSelected(null)}
            fitView colorMode="dark"><Background gap={20} color="#26383f" /><Controls /><MiniMap pannable zoomable /></ReactFlow>
        </section>
        <aside className="inspector">
          <h3>Özellikler</h3>
          <label>Node ara</label>
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Comfy node adı" />
          <label>Node tipi</label>
          <select value={kind} onChange={e=>setKind(e.target.value)} disabled={engine.state!=="ready"}>
            {kinds.includes(kind) ? null : (kind ? <option value={kind}>{kind}</option> : null)}
            {kinds.map(k=><option key={k} value={k}>{k}</option>)}
          </select>
          <button disabled={engine.state!=="ready"||!kind} onClick={addNode}>+ Node ekle</button>
          <hr />
          {chosen?<div><h4>{chosen.data.nodeKind}</h4>
            <label>Node girdileri (JSON)</label>
            <textarea spellCheck={false} rows={10} value={parameters} onChange={e=>setParameters(e.target.value)}/>
            <button onClick={saveParams}>Girdileri uygula</button>
            <small>Girdiler canlı node kataloğuyla backend tarafından doğrulanır. Bağlantılar için portları sürükle.</small>
          </div>:<p className="hint">Özelliklerini düzenlemek için bir node seç.</p>}
          <hr />
          <label>Çalıştırma</label>
          <p className="hint">{job ? job.job_id : "Henüz iş gönderilmedi."}</p>
          <button onClick={()=>void pollJob()} disabled={!job}>Sonucu sorgula</button>
          <button onClick={()=>void cancelJob()} disabled={!job}>İşi iptal et</button>
        </aside>
      </div>
      <footer><span role="status">{notice}</span>{history ? <details><summary>Comfy iş geçmişi</summary><pre>{JSON.stringify(history,null,2)}</pre></details>:null}</footer>
    </main>
  </div>;
}
