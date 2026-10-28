import { useCallback, useEffect, useMemo, useState } from "react";
import Notes from "./Notes";
import WorkspaceBackupPanel from "./WorkspaceBackupPanel";
import GenerationPanel from "./GenerationPanel";
import {restoreDraft, serializeDraft,
  type Catalog, type GraphNode, type SavedWorkflow, type WorkflowSummary
} from "./workflowLibrary";
import { ReactFlow,
  Background, Controls, Handle, MiniMap, Position, addEdge,
  applyEdgeChanges, applyNodeChanges,
  type Edge, type NodeProps, type Connection,
  type NodeChange, type EdgeChange
} from "@xyflow/react";

type Engine = {state: string, pid: number | null, failure: string | null};
type Result = {id: string, engine_job_id: string | null, state: string};
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
  const [mode, setMode] = useState<"workflow"|"notes">("workflow");
  const [engine, setEngine] = useState<Engine>({state:"unconfigured",pid:null,failure:null});
  const [catalog, setCatalog] = useState<Catalog>({});
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [savedWorkflows, setSavedWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowRef, setWorkflowRef] = useState<{id: string, revision: number} | null>(null);
  const [workflowName, setWorkflowName] = useState("Yeni workflow");
  const [pickedWorkflow, setPickedWorkflow] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [parameters, setParameters] = useState("{}");
  const [notice, setNotice] = useState("Motorun gerçek durumu backend üzerinden okunur.");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Result | null>(null);

  const refresh = useCallback(async () => {
    try { setEngine(await callApi<Engine>("/api/engine")); }
    catch { setNotice("Backend erişilemiyor. Yerel servisi başlat."); }
  },[]);
  useEffect(()=>{ void refresh(); const timer = setInterval(()=>{void refresh()},2000); return ()=>clearInterval(timer)},[refresh]);
  const refreshLibrary = useCallback(async () => {
    setSavedWorkflows(await callApi<WorkflowSummary[]>("/api/workflows"));
  }, []);
  useEffect(() => {
    void refreshLibrary().catch(e => setNotice(String(e)));
  }, [refreshLibrary]);
  useEffect(()=>{
    if(engine.state !== "ready") {setCatalog({});return;}
    void callApi<Catalog>("/api/workflow/nodes").then(c=>{
      setCatalog(c);
      // Replace offline port previews with authoritative live definitions.
      setNodes(old => old.map(n => c[n.data.nodeKind]
        ? {...n, data: {...n.data, definition: c[n.data.nodeKind]}} : n));
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
    setDraftDirty(true);
  };
  const saveParams = ()=>{
    if(!selected) return;
    try{
      const value: unknown = JSON.parse(parameters);
      if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("JSON nesnesi gerekli.");
      setNodes(previous=>previous.map(n=>n.id===selected?{...n,data:{...n.data,inputs:value as Record<string,unknown>}}:n));
      setDraftDirty(true);
      setNotice("Parametreler grafiğe işlendi; sunucu doğrulaması için Kontrol et.");
    }catch(e){setNotice("Geçersiz parametre JSON: "+String(e))}
  };

  const hasUnappliedInputs = () => !!chosen &&
    parameters.trim() !== JSON.stringify(chosen.data.inputs, null, 2);
  const compiledGraph = () => serializeDraft(nodes, edges);
  const newWorkflow = () => {
    if (draftDirty && !window.confirm("Kaydedilmemiş değişiklikler var. Yeni workflow açılsın mı?")) return;
    setNodes([]); setEdges([]); setSelected(null); setJob(null);
    setWorkflowRef(null); setPickedWorkflow(""); setWorkflowName("Yeni workflow");
    setDraftDirty(false); setNotice("Yeni boş workflow hazır.");
  };
  const openWorkflow = async () => {
    if (!pickedWorkflow || busy) return;
    if (draftDirty && !window.confirm("Kaydedilmemiş değişiklikler var. Seçilen workflow yüklensin mi?")) return;
    setBusy(true);
    try {
      const saved = await callApi<SavedWorkflow>("/api/workflows/" + encodeURIComponent(pickedWorkflow));
      const restored = restoreDraft(saved.graph, catalog);
      setNodes(restored.nodes); setEdges(restored.edges); setSelected(null); setJob(null);
      setWorkflowRef({id:saved.id, revision:saved.revision});
      setWorkflowName(saved.name); setDraftDirty(false);
      setNotice("Workflow açıldı: " + saved.name + " · rev " + saved.revision);
    } catch(e) { setNotice(String(e)); }
    finally { setBusy(false); }
  };
  const saveWorkflow = async () => {
    if (busy) return;
    if (hasUnappliedInputs()) {
      setNotice("Node girdilerinde uygulanmamış değişiklik var. Önce 'Girdileri uygula' seç.");
      return;
    }
    if (!workflowName.trim()) { setNotice("Workflow adı boş olamaz."); return; }
    setBusy(true);
    try {
      const body = {name: workflowName.trim(), graph: serializeDraft(nodes, edges)};
      const saved = workflowRef
        ? await callApi<SavedWorkflow>("/api/workflows/" + encodeURIComponent(workflowRef.id),
            {method:"PUT", body:JSON.stringify({...body, expected_revision:workflowRef.revision})})
        : await callApi<SavedWorkflow>("/api/workflows",
            {method:"POST", body:JSON.stringify(body)});
      setWorkflowRef({id:saved.id, revision:saved.revision});
      setPickedWorkflow(saved.id); setWorkflowName(saved.name); setDraftDirty(false);
      await refreshLibrary();
      setNotice("Workflow kaydedildi · rev " + saved.revision + ". Çalıştırılabilirlik Comfy üzerinden ayrıca doğrulanır.");
    } catch(e) { setNotice("Kayıt başarısız: " + String(e)); }
    finally { setBusy(false); }
  };
  const run = async (submit:boolean)=>{
    if (hasUnappliedInputs()) {
      setNotice("Node girdilerini önce uygula; ekrandaki henüz işlenmemiş değerlerle çalıştırma yapılamaz.");
      return;
    }
    setBusy(true);
    try{
      if(submit){
        const value = await callApi<Result>("/api/generations",{method:"POST",body:JSON.stringify(compiledGraph())});
        setJob(value);setNotice("İş kimliği kaydedildi: "+value.id+" · durum: "+value.state);
      }else{
        const result=await callApi<{prompt:unknown}>("/api/workflows/compile",{method:"POST",body:JSON.stringify(compiledGraph())});
        setNotice("Graph kabul edildi. Derlenen API prompt: "+Object.keys(result.prompt as object).length+" node.");
      }
    }catch(e){setNotice(String(e))}
    finally{setBusy(false)}
  };
  const onConnect=useCallback((link:Connection)=>{
    setEdges(old=>addEdge(link,old)); setDraftDirty(true);
  },[]);
  const onNodesChange=useCallback((changes:NodeChange<GraphNode>[])=>{
    setNodes(old=>applyNodeChanges(changes,old) as GraphNode[]);
    if (changes.some(c=>["position","add","remove","dimensions"].includes(c.type))) setDraftDirty(true);
  },[]);
  const onEdgesChange=useCallback((changes:EdgeChange<Edge>[])=>{
    setEdges(old=>applyEdgeChanges(changes,old));
    if (changes.some(c=>["add","remove","replace"].includes(c.type))) setDraftDirty(true);
  },[]);
  return <div className="app">
    <aside className="side">
      <div className="brand"><span>◈</span> bellekpad <small>EFSS · WEB AI CORE</small></div>
      <button className={"nav " + (mode==="workflow"?"active":"")} onClick={()=>setMode("workflow")}>◆ Workflow Studio</button>
      <div className="nav disabled">Sohbet · R3</div>
      <button className={"nav " + (mode==="notes"?"active":"")} onClick={()=>setMode("notes")}>◈ Notlar · EFSS</button>
      <div className="nav disabled">Projeler · R6</div>
      <div className="spacer"/>
      <WorkspaceBackupPanel />
      <p className="caption">Backend yönetiminde</p>
      <div className={"engine "+engine.state}><b>● {engine.state.toUpperCase()}</b><small>{engine.pid? "PID "+engine.pid : engine.failure || "Kendi motorumuz"}</small></div>
      <div className="actions">
        <button onClick={()=>void engineAction("start")} disabled={busy||!["stopped","failed"].includes(engine.state)}>Başlat</button>
        <button onClick={()=>void engineAction("stop")} disabled={busy||!["starting","ready","failed"].includes(engine.state)}>Durdur</button>
      </div>
    </aside>
    <main className="workspace">
      {mode==="notes" ? <Notes /> : <>
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
          <h3>Workflow / Preset</h3>
          <label htmlFor="workflow-name">Ad</label>
          <input id="workflow-name" maxLength={160} value={workflowName}
            onChange={e=>{setWorkflowName(e.target.value);setDraftDirty(true)}} />
          <div className="actions">
            <button disabled={busy} onClick={newWorkflow}>Yeni</button>
            <button disabled={busy||!draftDirty} onClick={()=>void saveWorkflow()}>Kaydet</button>
          </div>
          <label htmlFor="workflow-saved">Kayıtlı workflow'lar</label>
          <select id="workflow-saved" value={pickedWorkflow}
            onChange={e=>setPickedWorkflow(e.target.value)}>
            <option value="">Workflow seç</option>
            {savedWorkflows.map(w=><option key={w.id} value={w.id}>{w.name} (rev {w.revision})</option>)}
          </select>
          <button disabled={!pickedWorkflow||busy} onClick={()=>void openWorkflow()}>Seçileni aç</button>
          <p className="hint">{workflowRef ? "Revizyon "+workflowRef.revision : "Yeni taslak"} ·
            {draftDirty ? " Kaydedilmemiş değişiklikler" : " Kaydedildi / değişiklik yok"}</p>
          <hr />
          <h3>Node özellikleri</h3>
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
          <GenerationPanel activeId={job?.id||null} />
        </aside>
      </div>
      <footer><span role="status">{notice}</span></footer>
      </>}
    </main>
  </div>;
}
