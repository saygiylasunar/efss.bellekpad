import { useEffect, useState } from "react";

type Config = {
  configured: boolean;
  comfy_root: string | null;
  python_executable: string | null;
  port: number;
};
const errorLabels: Record<string,string> = {
  COMFY_ROOT_REQUIRED:"ComfyUI klasörü gerekli.",
  COMFY_ROOT_MUST_BE_ABSOLUTE:"Tam klasör yolunu gir.",
  COMFY_INSTALLATION_NOT_FOUND:"Bu klasörde ComfyUI main.py bulunamadı.",
  COMFY_INSTALLATION_NOT_RECOGNIZED:"Geçerli bir ComfyUI kurulumu bulunamadı.",
  COMFY_PYTHON_REQUIRED:"Python yolu bulunamadı. Python çalıştırıcısını belirt.",
  COMFY_PYTHON_MUST_BE_ABSOLUTE:"Python çalıştırıcısının tam yolunu gir.",
  COMFY_PYTHON_INVALID:"Python çalıştırıcısı bulunamadı veya desteklenmiyor.",
  ENGINE_BUSY:"Motor çalışırken kurulum değiştirilemez."
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const result = await fetch(path,{
    headers: {"Content-Type":"application/json"},cache:"no-store",...options
  });
  const raw = await result.text();
  let body: Record<string,unknown>;
  try {body=JSON.parse(raw) as Record<string,unknown>;}
  catch {throw Error("Sunucu yanıtı geçersiz (HTTP "+result.status+").")}
  if(!result.ok) {
    const code=String(body.detail||body.error||"HTTP "+result.status);
    throw Error(errorLabels[code]||code);
  }
  return body as T;
}

export default function EngineSettings({
  state,onConfigured
}: {state:string;onConfigured:()=>Promise<void>}) {
  const [root,setRoot] = useState("");
  const [python,setPython] = useState("");
  const [configured,setConfigured] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [logs,setLogs] = useState<string[]>([]);

  useEffect(()=>{
    let active=true;
    void request<Config>("/api/runtime/config").then(config=>{
      if(!active)return;
      setConfigured(config.configured);
      setRoot(config.comfy_root||"");
      setPython(config.python_executable||"");
    }).catch(e=>{if(active)setMessage(String(e))});
    return ()=>{active=false};
  },[]);

  const save = async()=>{
    if(busy || ["starting","ready","stopping"].includes(state))return;
    setBusy(true);
    try {
      const config=await request<Config>("/api/runtime/config",{
        method:"PUT",body:JSON.stringify({
          comfy_root:root.trim(),
          python_executable:python.trim()||null
        })
      });
      setConfigured(config.configured);
      setPython(config.python_executable||"");
      setRoot(config.comfy_root||"");
      setMessage("Motor kaydedildi.");
      await onConfigured();
    }catch(e){setMessage(String(e))}
    finally{setBusy(false)}
  };
  const readLogs=async()=>{
    try {
      const result=await request<{lines:string[]}>("/api/runtime/logs");
      setLogs(result.lines);
    }catch(e){setMessage(String(e))}
  };
  const locked=["starting","ready","stopping"].includes(state);

  return <details className="engine-settings" open={!configured||undefined}>
    <summary>Motor ayarları</summary>
    <label htmlFor="engine-folder">ComfyUI klasörü</label>
    <input id="engine-folder" value={root} disabled={locked||busy}
      placeholder="D:\\AI\\ComfyUI"
      onChange={e=>setRoot(e.target.value)}/>
    <label htmlFor="engine-python">Python yolu</label>
    <input id="engine-python" value={python} disabled={locked||busy}
      placeholder="Otomatik bul veya python.exe yolu"
      onChange={e=>setPython(e.target.value)}/>
    <button disabled={busy||locked||!root.trim()} onClick={()=>void save()}>
      {busy?"Kaydediliyor…":"Motoru kaydet"}
    </button>
    {message?<p role="status" className="engine-config-message">{message}</p>:null}
    {configured?<details className="engine-output">
      <summary>Motor kayıtları</summary>
      <button onClick={()=>void readLogs()}>Yenile</button>
      <pre>{logs.length?logs.join("\n"):"Kayıt yok."}</pre>
    </details>:null}
  </details>;
}
