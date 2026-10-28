import { useCallback, useEffect, useState } from "react";

type ModelRoot = {
  id:string; path:string; indexed_at:string|null; file_count:number
};
type ModelRecord = {
  id:string;root_id:string;relative_path:string;name:string;format:string;
  component_hint:string;size_bytes:number;modified_ns:number
};
type ModelPage = {total:number;items:ModelRecord[];limit:number;offset:number};

async function api<T>(url:string,init?:RequestInit):Promise<T> {
  const response=await fetch(url,{cache:"no-store",
    headers:{"Content-Type":"application/json"},...init});
  const raw=await response.text();
  let data:Record<string,unknown>;
  try{data=JSON.parse(raw) as Record<string,unknown>}
  catch{throw Error("Sunucu yanıtı geçersiz (HTTP "+response.status+").")}
  if(!response.ok)throw Error(String(data.detail||data.error||"HTTP "+response.status));
  return data as T;
}

const formatSize=(n:number)=>{
  if(n<1024)return n+" B";
  const units=["KB","MB","GB","TB"];
  let num=n;
  let index=-1;
  do{num/=1024;index++}while(num>=1024&&index<units.length-1);
  return num.toFixed(num<10?2:1)+" "+units[index];
};
const componentNames:Record<string,string>={
  unknown:"—",checkpoint:"Checkpoint",diffusion:"Diffusion",
  lora:"LoRA",vae:"VAE",text_encoder:"Encoder",controlnet:"ControlNet",
  adapter:"Adapter",embedding:"Embedding",upscaler:"Upscaler"
};

export default function Models(){
  const [roots,setRoots]=useState<ModelRoot[]>([]);
  const [rootInput,setRootInput]=useState("");
  const [selected,setSelected]=useState("");
  const [query,setQuery]=useState("");
  const [format,setFormat]=useState("");
  const [page,setPage]=useState<ModelPage>({total:0,items:[],limit:100,offset:0});
  const [offset,setOffset]=useState(0);
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);

  const loadRoots=useCallback(async()=> {
    setRoots(await api<ModelRoot[]>("/api/models/roots"));
  },[]);
  const loadModels=useCallback(async()=>{
    const params=new URLSearchParams({limit:"100",offset:String(offset)});
    if(selected)params.set("root_id",selected);
    if(query.trim())params.set("query",query.trim());
    if(format)params.set("format",format);
    const data=await api<ModelPage>("/api/models?"+params.toString());
    setPage(data);
  },[selected,query,format,offset]);
  useEffect(()=>{void loadRoots().catch(e=>setNotice(String(e)))},[loadRoots]);
  useEffect(()=>{let cancelled=false;
    const load=async()=>{try{
      const params=new URLSearchParams({limit:"100",offset:String(offset)});
      if(selected)params.set("root_id",selected);
      if(query.trim())params.set("query",query.trim());
      if(format)params.set("format",format);
      const result=await api<ModelPage>("/api/models?"+params.toString());
      if(!cancelled)setPage(result);
    }catch(e){if(!cancelled)setNotice(String(e))}};
    void load();
    return()=>{cancelled=true};
  },[selected,query,format,offset]);
  const add=async()=>{
    if(busy||!rootInput.trim())return;
    setBusy(true);
    try{
      const root=await api<ModelRoot>("/api/models/roots",
        {method:"POST",body:JSON.stringify({path:rootInput.trim()})});
      setRootInput("");
      setSelected(root.id);setOffset(0);
      await loadRoots();
      setNotice("Klasör eklendi. Taramayı başlat.");
    }catch(e){setNotice(String(e))}
    finally{setBusy(false)}
  };
  const scan=async()=>{
    if(busy||!selected)return;
    setBusy(true);setNotice("Taranıyor…");
    try{
      const root=await api<ModelRoot>(
        "/api/models/roots/"+encodeURIComponent(selected)+"/scan",{method:"POST"});
      await loadRoots();
      await loadModels();
      setNotice(root.file_count+" model dosyası dizine alındı.");
    }catch(e){setNotice("Tarama tamamlanamadı: "+String(e))}
    finally{setBusy(false)}
  };
  const remove=async()=>{
    if(busy||!selected)return;
    const item=roots.find(r=>r.id===selected);
    if(!window.confirm((item?.path||"Klasör")+
      "\nBu klasör yalnızca BellekPad model dizininden çıkarılacak. Diskteki dosyalar silinmez. Devam edilsin mi?"))return;
    setBusy(true);
    try{
      await api("/api/models/roots/"+encodeURIComponent(selected),{method:"DELETE"});
      setSelected("");setOffset(0);
      await loadRoots();
      setPage({total:0,items:[],limit:100,offset:0});
      setNotice("Klasör dizinden kaldırıldı. Dosyalara dokunulmadı.");
    }catch(e){setNotice(String(e))}
    finally{setBusy(false)}
  };
  return <div className="models-workspace">
    <header className="models-header"><h2>Modeller</h2>
      <span>{page.total} dosya</span></header>
    <div className="models-controls">
      <label htmlFor="models-add-root">Model klasörü</label>
      <div className="models-row">
        <input id="models-add-root" placeholder="D:\AI\Models"
          value={rootInput} onChange={e=>setRootInput(e.target.value)}/>
        <button className="primary" disabled={busy||!rootInput.trim()}
          onClick={()=>void add()}>Klasör ekle</button>
      </div>
      <label htmlFor="models-root">Dizin</label>
      <div className="models-row">
        <select id="models-root" value={selected} disabled={busy}
          onChange={e=>{setSelected(e.target.value);setOffset(0)}}>
          <option value="">Tüm eklenen klasörler</option>
          {roots.map(r=><option value={r.id} key={r.id}>{r.path} ({r.file_count})</option>)}
        </select>
        <button onClick={()=>void scan()} disabled={busy||!selected}>Tara</button>
        <button onClick={()=>void remove()} disabled={busy||!selected}>Kaldır</button>
      </div>
      <div className="models-row">
        <input aria-label="Model ara" placeholder="Dosya adıyla ara"
          value={query} onChange={e=>{setQuery(e.target.value);setOffset(0)}}/>
        <select aria-label="Dosya biçimi" value={format}
          onChange={e=>{setFormat(e.target.value);setOffset(0)}}>
          <option value="">Tüm biçimler</option>
          {["gguf","safetensors","ckpt","pt","pth","onnx","bin"].map(s=>
            <option value={s} key={s}>{s.toUpperCase()}</option>)}
        </select>
      </div>
    </div>
    {notice?<p role="status" className="models-status">{notice}</p>:null}
    <div className="models-table-wrap">
      <table className="models-table">
        <thead><tr><th>Dosya</th><th>Biçim</th><th>Grup*</th><th>Boyut</th></tr></thead>
        <tbody>{page.items.map(model=><tr key={model.id}>
          <td title={model.relative_path}><strong>{model.name}</strong>
            <small>{model.relative_path}</small></td>
          <td>{model.format.toUpperCase()}</td>
          <td>{componentNames[model.component_hint]||model.component_hint}</td>
          <td>{formatSize(model.size_bytes)}</td>
        </tr>)}</tbody>
      </table>
      {page.items.length===0?<div className="models-empty">
        Henüz indekslenmiş model yok.</div>:null}
    </div>
    <div className="models-footer">
      <small>* Grup bilgisi klasör adına dayalı ipucudur, model doğrulaması değildir.</small>
      <div className="models-row">
        <button disabled={offset===0}
          onClick={()=>setOffset(Math.max(0,offset-100))}>Önceki</button>
        <span>{page.total?offset+1:0}–{Math.min(offset+100,page.total)} / {page.total}</span>
        <button disabled={offset+100>=page.total}
          onClick={()=>setOffset(offset+100)}>Sonraki</button>
      </div>
    </div>
  </div>;
}
