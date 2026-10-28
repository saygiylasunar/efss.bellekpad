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
      String(node.attrs.raw || "")];
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
      content:block.text?[{type:"text",text:block.text}]:[]};
  })};
}
type DraftLine = {id: string | null; hash: string | null;
  kind: "paragraph" | "heading" | "opaque"; text: string; level: number | null};

function makeDraft(content: JSONContent): DraftLine[] {
  const seen = new Set<string>();
  return (content.content || []).map(node => {
    if (node.type!=="paragraph" && node.type!=="heading" && node.type!=="efssOpaque")
      throw Error("Desteklenmeyen not bloğu.");
    const opaque = node.type === "efssOpaque";
    if (!opaque && node.content?.some(n => n.type!=="text" || (n.marks?.length||0)>0))
      throw Error("Desteklenmeyen biçimlendirme.");
    const id = typeof node.attrs?.lineId === "string" ? node.attrs.lineId : null;
    // ProseMirror may copy attributes while splitting a paragraph with Enter.
    // Only the first fragment retains its original source identity.
    const original = id !== null && !seen.has(id);
    if (id && opaque && seen.has(id))
      throw Error("Korunan EFSS bloğu çoğaltılamaz.");
    if (id) seen.add(id);
    const level = node.type === "heading" ? node.attrs?.level : null;
    if (node.type === "heading" && (!Number.isInteger(level) || level<1 || level>6))
      throw Error("Geçersiz başlık seviyesi.");
    return {
      id:original ? id : null,
      hash:original && typeof node.attrs?.sourceHash==="string"
        ? node.attrs.sourceHash : null,
      kind:opaque ? "opaque" as const : node.type as "heading"|"paragraph",
      level:node.type === "heading" ? level as number : null,
      text:opaque ? String(node.attrs?.raw??"")
        : (node.content||[]).map(n=>n.text||"").join("")
    };
  });
}

function unchanged(doc: Note, draft: DraftLine[]): boolean {
  return draft.length === doc.projection.blocks.length &&
    draft.every((line, i) => {
      const original=doc.projection.blocks[i];
      return line.id===original.id && line.hash===original.hash &&
        line.kind===original.kind && line.text===original.text &&
        line.level===original.level;
    });
}

async function api<T>(url:string,init?:RequestInit):Promise<T>{
  const response = await fetch(url,{headers:{"Content-Type":"application/json"},...init});
  const body = await response.json() as {detail?:string; error?:string};
  if(!response.ok)throw Error(body.detail || body.error || ("HTTP " + response.status));
  return body as T;
}

export default function Notes(){
  const [list,setList]=useState<Item[]>([]);
  const [doc,setDoc]=useState<Note|null>(null);
  const [notice,setNotice]=useState("");
  const [pending,setPending]=useState(false);
  const editor=useEditor({extensions, content:{type:"doc",content:[{type:"paragraph"}]}});
  const reload=async()=>setList(await api<Item[]>("/api/notes"));
  useEffect(()=>{void reload().catch(e=>setNotice(String(e)))},[]);
  useEffect(()=>{
    if(editor && doc)editor.commands.setContent(toEditor(doc),{emitUpdate:false});
  },[editor,doc]);

  const open=async(id:string)=>{
    if(pending)return;
    try{setDoc(await api<Note>("/api/notes/"+encodeURIComponent(id)));setNotice("");}
    catch(e){setNotice(String(e))}
  };
  const create=async()=>{
    if(pending)return;
    const title=window.prompt("Yeni not başlığı");
    if(!title?.trim())return;
    setPending(true);
    try{const n=await api<{id:string}>("/api/notes",{method:"POST",
      body:JSON.stringify({title:title.trim(),source:""})});
      await reload();setDoc(await api<Note>("/api/notes/"+encodeURIComponent(n.id)));
      setNotice("Yeni not oluşturuldu.");
    }catch(e){setNotice(String(e))}finally{setPending(false)}
  };
  const save=async()=>{
    if(!doc||!editor||pending)return;
    setPending(true);
    try{
      const draft=makeDraft(editor.getJSON());
      if(unchanged(doc,draft)){setNotice("Değişiklik yok.");return;}
      await api("/api/notes/"+encodeURIComponent(doc.id),{method:"PATCH",
        body:JSON.stringify({revision:doc.revision,source_sha:doc.projection.revision,draft})});
      setDoc(await api<Note>("/api/notes/"+encodeURIComponent(doc.id)));
      await reload();
      setNotice("Kaydedildi.");
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
        </div>
        <button disabled={!doc||pending} onClick={()=>void save()}>Kaydet</button>
      </div>
      {doc?<div className="note-paper"><EditorContent editor={editor}/></div>:<div className="note-paper placeholder">Bir not seç veya yenisini oluştur.</div>}
      <div role="status" className="note-status">{notice}</div>

    </section>
  </div>;
}
