import { useCallback, useEffect, useState } from "react";

type Backup = {name: string; size_bytes: number};
type CreatedBackup = Backup & {valid: boolean; asset_count: number};
type Verification = {valid: boolean; asset_count: number; files: number; format_version: number};

async function localApi<T>(path: string, method: "GET"|"POST"="GET"): Promise<T> {
  const response=await fetch(path,{method,headers:{"Content-Type":"application/json"},cache:"no-store"});
  const raw=await response.text();
  let payload: {detail?:string;error?:string};
  try{payload=JSON.parse(raw) as typeof payload}
  catch{throw Error("Sunucu yanıtı geçersiz (HTTP "+response.status+").")}
  if(!response.ok)throw Error(payload.detail||payload.error||("HTTP "+response.status));
  return payload as T;
}

export default function WorkspaceBackupPanel() {
  const [entries,setEntries]=useState<Backup[]>([]);
  const [selected,setSelected]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const refresh=useCallback(async()=>{
    const result=await localApi<Backup[]>("/api/workspace-backups");
    setEntries(result);
  },[]);
  useEffect(()=>{void refresh().catch(err=>setMessage(String(err)))},[refresh]);

  const create=async()=>{
    if(busy)return;
    setBusy(true);
    try{
      const created=await localApi<CreatedBackup>("/api/workspace-backups","POST");
      await refresh();
      setSelected(created.name);
      setMessage("Yedek oluşturuldu · "+created.asset_count+" görsel");
    }catch(e){setMessage("Yedek oluşturulamadı: "+String(e))}
    finally{setBusy(false)}
  };
  const verify=async()=>{
    if(!selected||busy)return;
    setBusy(true);
    try{
      const answer=await localApi<Verification>(
        "/api/workspace-backups/"+encodeURIComponent(selected)+"/verify","POST");
      setMessage(answer.valid
        ? "Yedek sağlam · "+answer.files+" dosya"
        : "Doğrulama başarısız.");
    }catch(e){setMessage("Yedek doğrulaması başarısız: "+String(e))}
    finally{setBusy(false)}
  };
  return <details className="workspace-backups">
    <summary title="Veri klasöründeki notları, kayıtları ve arşivlenmiş görselleri yedekle">◈ Yedekler</summary>

    <button disabled={busy} onClick={()=>void create()}>{busy?"İşleniyor…":"Tam yedek oluştur"}</button>
    <label htmlFor="workspace-backups-select">Kayıtlı arşiv</label>
    <select id="workspace-backups-select" value={selected}
      onChange={e=>setSelected(e.target.value)}>
      <option value="">Yedek seç</option>
      {entries.map(entry=><option key={entry.name} value={entry.name}>
        {entry.name.slice(0,20)}… ({(entry.size_bytes/1048576).toFixed(1)} MB)
      </option>)}
    </select>
    <button disabled={!selected||busy} onClick={()=>void verify()}>Bütünlüğünü doğrula</button>
    <p role="status" className="backup-status">{message}</p>

  </details>;
}
