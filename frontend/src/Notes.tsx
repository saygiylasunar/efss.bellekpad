import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Node as TiptapNode, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Paragraph from "@tiptap/extension-paragraph";
import Heading from "@tiptap/extension-heading";

type Block = { id: string; kind: "heading" | "paragraph" | "opaque"; text: string;
  level: number | null; editable: boolean; hash: string; ending: string };
type Projection = {revision: string; blocks: Block[]};
type Note = {id: string; title: string; source: string; revision: number; projection: Projection};
type Item = {id: string; title: string; revision: number};

const attrs = {
  lineId: {default: null, rendered: false},
  sourceHash: {default: null, rendered: false}
};
const EFSSParagraph = Paragraph.extend({addAttributes() {return {...this.parent?.(), ...attrs}}});
const EFSSHeading = Heading.extend({addAttributes() {return {...this.parent?.(), ...attrs}}});
const Opaque = TiptapNode.create({
  name:"efssOpaque",group:"block",atom:true, selectable:false, draggable:false,
  addAttributes(){return {lineId: {default:null, rendered:false},sourceHash:{default:null,rendered:false},
    raw:{default:"",rendered:false}}},
  parseHTML(){return [{tag:"div[data-efss-opaque]"}]},
  renderHTML({node}){
    return ["div", {"data-efss-opaque":"true",contenteditable:"false",class:"efss-opaque"},
      "Korunan EFSS kaynağı · " + String(node.attrs.raw || "")];
  }
});

const extensions = [
  StarterKit.configure({paragraph:false, heading:false, bold:false, italic:false,
    strike:false, code:false, codeBlock:false, blockquote:false,
    bulletList:false, orderedList:false, listItem:false, horizontalRule:false}),
  EFSSParagraph, EFSSHeading, Opaque
];

function toEditor(doc: Note): JSONContent {
  return {type:"doc",content:doc.projection.blocks.map(block=>{
    const base = {lineId:block.id,sourceHash:block.hash};
    if (block.kind==="opaque")
      return {type:"efssOpaque",attrs:{...base,raw:block.text}};
    return {type:block.kind, attrs:{...base,...(block.level?{level:block.level}:{})},
      content:[{type:"text",text:block.text}]};
  })};
}
function makeChanges(doc: Note, content: JSONContent): Array<{id:string;hash:string;text:string}>{
  const blocks = content.content || [];
  if (blocks.length!==doc.projection.blocks.length)throw Error("Yapı değişti: satır ekleme/silme bu EFSS kesitinde desteklenmiyor.");
  const changes: Array<{id:string;hash:string;text:string}> = [];
  blocks.forEach((node,index)=>{
    const original=doc.projection.blocks[index];
    if (node.attrs?.lineId!==original.id || node.attrs?.sourceHash!==original.hash ||
        node.type!==(original.kind==="opaque"?"efssOpaque":original.kind))
      throw Error("EFSS kaynak blokları değiştirilemez veya yeniden sıralanamaz.");
    if (original.kind==="opaque"){
      if(node.attrs?.raw!==original.text)throw Error("Bilinmeyen EFSS içeriği değiştirilemez.");
      return;
    }
    if(original.kind==="heading" && node.attrs?.level!==original.level)
      throw Error("Başlık yapısı bu aşamada değiştirilemez.");
    if(node.content?.some(n=>n.type!=="text" || (n.marks?.length||0)>0))
      throw Error("Desteklenmeyen biçim işlemi: kaynak korunarak reddedildi.");
    const text = (node.content||[]).map(n=>n.text||"").join("");
    if(text!==original.text)changes.push({id:original.id,hash:original.hash,text});
  });
  return changes;
}

async function api<T>(url:string,init?:RequestInit):Promise<T>{
  const response = await fetch(url,{headers:{"Content-Type":"application/json"},...init});
  const body = await response.json() as {detail?:string};
  if(!response.ok)throw Error(body.detail||"Not kaydedilemedi.");
  return body as T;
}

export default function Notes(){
  const [list,setList]=useState<Item[]>([]);
  const [doc,setDoc]=useState<Note|null>(null);
  const [notice,setNotice]=useState("Bilinmeyen EFSS blokları kayıpsız, salt okunur korunur.");
  const [pending,setPending]=useState(false);
  const editor=useEditor({extensions, content:{type:"doc",content:[{type:"paragraph"}]}});
  const reload=async()=>setList(await api<Item[]>("/api/notes"));
  useEffect(()=>{void reload().catch(e=>setNotice(String(e)))},[]);
  useEffect(()=>{
    if(editor && doc)editor.commands.setContent(toEditor(doc),{emitUpdate:false});
  },[editor,doc]);

  const open=async(id:string)=>{
    if(pending)return;
    try{setDoc(await api<Note>("/api/notes/"+encodeURIComponent(id)));setNotice("Kaynak yüklendi. Güvenli düz satırlar düzenlenebilir.");}
    catch(e){setNotice(String(e))}
  };
  const create=async()=>{
    if(pending)return;
    const title=window.prompt("Yeni not başlığı");
    if(!title?.trim())return;
    setPending(true);
    try{const n=await api<{id:string}>("/api/notes",{method:"POST",
      body:JSON.stringify({title:title.trim(),source:"Yeni not\n"})});
      await reload();await open(n.id);
    }catch(e){setNotice(String(e))}finally{setPending(false)}
  };
  const save=async()=>{
    if(!doc||!editor||pending)return;
    setPending(true);
    try{
      const changes=makeChanges(doc,editor.getJSON());
      if(!changes.length){setNotice("Değişiklik bulunamadı.");return;}
      await api("/api/notes/"+encodeURIComponent(doc.id),{method:"PATCH",
        body:JSON.stringify({revision:doc.revision,source_sha:doc.projection.revision,changes})});
      setDoc(await api<Note>("/api/notes/"+encodeURIComponent(doc.id)));
      await reload();
      setNotice("EFSS kaynak korundu; revizyon kaydedildi.");
    }catch(e){setNotice(String(e))}finally{setPending(false)}
  };
  return <div className="note-workspace">
    <aside className="note-list">
      <button className="primary" onClick={()=>void create()}>+ Yeni not</button>
      {list.map(item=><button key={item.id} className={"note-link "+(doc?.id===item.id?"picked":"")}
        onClick={()=>void open(item.id)}>{item.title}<small>rev {item.revision}</small></button>)}
    </aside>
    <section className="note-body">
      <div className="note-toolbar"><div><h2>{doc?.title||"Not seç"}</h2>
        <p>EFSS · Kayıpsız düzenleme kesiti (R5 hazırlığı)</p></div>
        <button disabled={!doc||pending} onClick={()=>void save()}>Kaydet</button>
      </div>
      {doc?<div className="note-paper"><EditorContent editor={editor}/></div>:<div className="note-paper placeholder">Bir not seç veya yenisini oluştur.</div>}
      <div role="status" className="note-status">{notice}</div>
      <small className="note-warning">Bu ilk kesit yalnızca mevcut güvenli tek satır/paragraf metinlerini değiştirir. Yeni blok, karma biçim ve tablo düzenleme henüz etkin değildir; kaynak sessizce kaybedilmez.</small>
    </section>
  </div>;
}
