import { useEffect, useState } from "react";

type Generation = {
  id: string;
  engine_job_id: string | null;
  state: "submitting" | "submission_unknown" | "queued" | "running"
      | "completed" | "failed" | "cancelled";
  created_at: string;
  failure_code: string | null;
  engine_reachable?: boolean;
  images?: {index: number; node_id: string; filename: string; url: string}[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const result = await fetch(url, {cache:"no-store", ...init});
  const data = await result.json() as {detail?: string};
  if (!result.ok) throw new Error(data.detail || "Üretim sorgusu başarısız.");
  return data as T;
}

const labels: Record<Generation["state"], string> = {
  submitting: "Gönderiliyor",
  submission_unknown: "Gönderim doğrulanamadı",
  queued: "Kuyrukta",
  running: "Üretiliyor",
  completed: "Tamamlandı",
  failed: "Hata",
  cancelled: "İptal edildi"
};
const terminal = new Set(["completed","failed","cancelled","submission_unknown"]);

export default function GenerationPanel({activeId}: {activeId: string | null}) {
  const [jobs, setJobs] = useState<Generation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(activeId);
  const [detail, setDetail] = useState<Generation | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (activeId) setSelectedId(activeId); }, [activeId]);
  useEffect(() => {
    let closed = false;
    const refresh = async () => {
      try {
        const entries = await api<Generation[]>("/api/generations");
        if (!closed) setJobs(entries);
      } catch(e) {if (!closed) setNotice(String(e))}
    };
    void refresh();
    const timer = setInterval(()=>{void refresh()},5000);
    return ()=>{closed=true;clearInterval(timer)};
  }, [activeId]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let closed=false;
    const check=async()=>{
      try {
        const current=await api<Generation>("/api/generations/"+encodeURIComponent(selectedId));
        if (!closed) setDetail(current);
      } catch(e){if(!closed)setNotice(String(e))}
    };
    void check();
    const timer=setInterval(()=>{void check()},2000);
    return ()=>{closed=true;clearInterval(timer)};
  }, [selectedId]);

  const cancel=async()=>{
    if (!selectedId||busy)return;
    setBusy(true);
    try {
      const response=await api<{accepted:boolean;state:string}>(
        "/api/generations/"+encodeURIComponent(selectedId)+"/cancel", {method:"POST"});
      setNotice(response.accepted
        ? "İptal talebi motora iletildi. Son durum doğrulanıyor."
        : "İptal gönderilmedi; görev bitmiş veya motor zaten iptal ediyor.");
    }catch(e){setNotice(String(e))}
    finally{setBusy(false)}
  };

  return <div className="generation-panel">
    <div className="generation-title">Üretim geçmişi <small>Kalıcı görev kayıtları</small></div>
    <select aria-label="Üretim görevi seç" value={selectedId||""}
      onChange={e=>setSelectedId(e.target.value||null)}>
      <option value="">Görev seç</option>
      {jobs.map(j=><option value={j.id} key={j.id}>
        {labels[j.state]} · {j.id.slice(0,8)}
      </option>)}
      {selectedId&&!jobs.some(j=>j.id===selectedId)
        ? <option value={selectedId}>{selectedId.slice(0,8)}</option>:null}
    </select>
    {detail ? <div className="job-summary">
      <span className={"job-state "+detail.state}>{labels[detail.state]}</span>
      <small>{detail.id}</small>
      {detail.engine_reachable===false
        ? <p className="hint">ComfyUI erişilemiyor veya bu çalıştırma henüz eşleşmedi. Bilinen görev kaydı korunuyor.</p>
        : null}
      {detail.failure_code ? <p className="hint">{detail.failure_code}</p> : null}
      <button disabled={busy||terminal.has(detail.state)||!detail.engine_reachable}
        onClick={()=>void cancel()}>Görevi iptal et</button>
      <div className="generation-images">
        {(detail.images||[]).map(img=><a key={img.index} target="_blank" rel="noreferrer" href={img.url}
            aria-label={img.filename} title={img.filename}>
          <img loading="lazy" src={img.url} alt={img.filename}/>
        </a>)}
      </div>
      {detail.state==="completed" && detail.images?.length===0
        ? <p className="hint">Motor görev tamamlandı dedi; kayıtlı görsel çıktısı bulunamadı.</p>:null}
    </div> : <p className="hint">Henüz seçilmiş üretim yok.</p>}
    {notice?<p role="status" className="job-notice">{notice}</p>:null}
  </div>;
}
