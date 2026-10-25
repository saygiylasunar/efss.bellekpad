# BellekPad — Blok Sözleşmesi ve Görsel Davranış Matrisi (G0.6B)

Durum: **tasarım karar taslağı / kısmi uygulama**. Son ürün davranışını kullanıcı onaylar. Uygulanmış davranışlar kaynak ve testlere karşı denetlenir; bu dosya tek başına bir yetenek garantisi değildir.

## 1. Temel kural: görsel blok, gerçek bir nesne davranışı taşır

Her blok yalnızca Markdown sözdiziminin renklendirilmiş hali değildir. Bir tipin **kimliği, semantik rolü, giriş/çıkış eylemleri, hiyerarşisi, görünümü, klavye davranışı, veri modeli ve Inspector alanları** tek sözleşmeye bağlanır. Görsel Flow ile gelecekteki Layout aynı EFSS kaynağını paylaşır. DOM ayrı belge kaynağı değildir.

### Ortak nitelik katmanları

| Katman | Temsil / alanlar | Saklama sözleşmesi |
| --- | --- | --- |
| Kimlik | `id`, `type`, `parentId`, `order`, `version` | Şu anda ID oturumluk; kalıcı kimlik daha sonra |
| İçerik | `sourceStart`, `sourceEnd`, `inlineRuns`, `children` | Kaynak EFSS Markdown otorite |
| İşlev | `editable`, `readOnlyReason`, Enter/Backspace/Tab, split/merge | Saf transaction planner; undo tek adım |
| Tipografi | font family, size, weight, italic, tracking, line-height, alignment | Temel B/I/S Markdown; ileri stiller için versioned EFSS extension **taslak** |
| Yerleşim | padding, margin, width, min/max, alignment, overflow | Flow için uygulama tema tokenları; Layout için gelecekte geometry extension |
| Görsel | icon/marker, background, border, radius, hover, focus | UI skin; içeriği değiştirmez |
| Erişilebilirlik | role/label, keyboard order, focus ring, live errors | DOM/ARIA; kaynak dizini korunur |
| Genişletme | `attributes`, `schemaVersion`, extension güvenliği | Tanınmayan EFSS byte'ları hiçbir durumda silinmez |

**İki ayrı eksen:** **semantik blok tipi** (liste, başlık, alıntı...) ile **görsel stil** (renk, hizalama, aralık...) aynı özellik değildir. “Başlığı mavi göster” yeni heading türü oluşturmaz. Sıralı liste ile madde işaretli liste ise semantik olarak ayrışır.

## 2. Blok tipleri — önerilen kayıt kartları

### A. Paragraph — paragraf

- **Semantik:** normal metin; düz satırda varsayılan `type=paragraph`.
- **Görünüm taslağı:** 15–16 px temel metin; line-height 1.65; blok arası yaklaşık 8–12 px; font UI yerine document font.
- **Nitelikler:** alignment left/center/right/justify; spacingBefore/After; indentation; text marks; future line spacing; language.
- **Enter:** yeni paragraf; seçimin ortasında metni iki paragrafa ayırır. **İlk G0.6B kesiti:** tek satırlı, biçimsiz blok; iki satır Markdown paragrafın tek read-only AST bloğuna dönüşmemesi için boş satır üretir.
- **Shift+Enter:** aynı paragrafta soft break; **henüz kodlanmadı**.
- **Backspace başlangıcı:** üst blokla güvenli birleşme; başlık/liste sınırlarında dönüşüm politikası ayrıca belirlenmeli.
- **Inspector:** yazı tipi, boyut, satır yüksekliği, hizalama, giriş/girinti, boşluk.
- **Test kapısı:** Unicode/IME, büyük içerik, metin seçimi, Undo/Redo, CRLF, veri koruma.

### B. Heading — H1–H6

- **Semantik:** `#` ... `######`; `level=1..6`. Belge ana başlığı ayrı metadata alanı olabilir, H1'den otomatik türetilmemeli.
- **Görünüm taslağı:** H1 30, H2 25, H3 21, H4 18, H5 16, H6 15 px; weight ve spacing seviyeye göre; sol gutter H1…H6.
- **Nitelikler:** level, anchor/slug (**kaynak silmeden türetilmiş**), collapsible (öneri), alignment, typography override.
- **Enter:** başlık metninden sonra normal paragraf; ortadan bölünürse ilk kısım başlık, ikinci kısım paragraf. İlk kesit biçimsiz tek satırla sınırlı.
- **Boş heading + Enter:** düz paragrafa çıkış önerisi; henüz uygulama yok.
- **Inspector:** level, outline indent, weight/size, spacing, anchor, collapse state.
- **Test:** outline tutarlılığı, başlık içi B/I/S, Undo, kaynak roundtrip.

### C. List item — bulleted / ordered

- **Semantik:** `- + *` veya `1. 2)`; marker türü, delimiter, ordinal ve ileride depth, listId, checked alanları ayrılır.
- **Görünüm:** nokta/ordinal **gerçek marker'dan** türetilmeli. Sol gutter'da ordinal göster, metinle hizası tutarlı; nesting olduğunda derinliğe göre girinti.
- **Enter:** dolu satırda **aynı marker türüyle yeni madde**; imleç ortasında iki maddeye böl. **Boş maddede Enter:** liste sonlandır, normal paragraf oluştur. **G0.6B.1 uygulandı:** tek satırlı biçimsiz maddeler; `-/+/*`, numaralı son satır. Bir sonraki sıralı kardeşi olan numaralı liste şimdilik atomik yeniden numaralandırma olmadığı için güvenle reddedilir.
- **Tab/Shift+Tab:** bir seviye indent/outdent; çocukların tamamının gruplu taşınması (öneri, henüz yok). Backspace başta outdent/paragraph geçişi; Delete sonda sonraki öğeyle birleşme (henüz yok).
- **Ordered:** sayı başlangıcı, delimiter `.` veya `)`, yeniden numaralama modu ve manuel başlangıç davranışı ayrı state. 999999999 üzerini reddet.
- **Checkbox ayrı varyant:** unchecked/checked/indeterminate; tamamlanma tarihi opsiyonel metadata; `- [ ]` / `- [x]` lossless kalmalı. Önce parser ve görsel sözleşmesi.
- **Inspector:** listKind, marker, level, startNumber, restartNumbering, spacing, checkbox style.
- **Test:** Enter/end/middle/empty, CRLF, ordered sibling reindex, Undo/Redo, nesting, rich runs, keyboard focus.

### D. Quote — alıntı

- **Semantik:** `>` prefix; gelecekte çok satır/yinelenen quote depth.
- **Görünüm:** solda 2–3 px dikey vurgu çizgisi, iç padding ve ölçülü italik; tüm quote metnini zorla italik biçime dönüştürme.
- **Enter:** dolu tek satırda quote devam eder; boş `>` öğesi Enter ile çıkar. **İlk G0.6B kesiti:** basit tek satırlı quote.
- **Inspector:** quote accent/border/padding, depth, attribution/citation (öneri).
- **Test:** prefiks çiftlenmesi, çok satır, seçim ve nested source.

### E. Callout — bilgi kutusu

- **Semantik:** `:::efss.callout` içindeki variant, icon, title, body. Bu üçü bağımsız alanlar; bir variant değiştirmek body'yi silmez.
- **Variety:** info / tip / warning / success / error. Icon bundled SVG veya doğrulanmış içerik; başlık tekil metin.
- **Görünüm:** varyanta bağlı border/surface/accent; icon ve başlık hiyerarşisi; kompakt/geniş spacing.
- **Enter:** başlık veya body bağlamına göre; body içinde çok satırlı paragraf, gerektiğinde nested list. **Henüz yapılmadı**: mevcut body tek satırda Flow-editable.
- **Inspector:** variant, icon, title, border, background, radius, padding, nested child blocks, collapse state.
- **Test:** özel EFSS söz dizimi, nested Markdown, bilinmeyen attrs, icon yetkisi, lossless save.

### F. Code / code fence

- **Semantik:** fenced ```language veya ~~~, gerçek code text; Markdown inline işaretleri kodda yorumlanmaz.
- **Görünüm:** monospace font, language chip, copy control, overflow x-scroll, focus ring; kodun içine UI düğmesi veri olarak girmez.
- **Enter:** fence içinde gerçek newline, otomatik liste/başlık komutlarına dönüşmez.
- **Inspector:** language, wrap, tabSize, lineNumbers, theme, copy action.
- **Durum:** source/read-only Flow; özgün kod editörünün ayrıca yapılması gerekir.
- **Test:** closing fence, backticks, literal EFSS, CRLF, escape, clipboard.

### G. Divider — yatay ayırıcı

- **Semantik:** Markdown thematic break `---` / `***` / `___`; metin değil.
- **Görünüm:** İnce yatay çizgi; tutamak, seçili outline; gereksiz kart yüksekliği yok.
- **Enter:** içerik yazmak yerine yeni paragraf oluşturma komutu; Backspace seçiliyken silme.
- **Inspector:** thickness, color, width, spacing, style.
- **Durum:** AST tipi var, Flow şu anda read-only; UI sözleşmesi önerisi.

### H. Checklist — yapılacak öğe

- **Semantik:** liste üstüne `task.checked` state; `- [ ]` / `- [x]`, sadece metnin içinde `[ ]` göstererek taklit edilmez.
- **Enter:** dolu öğeden sonra **unchecked** yeni görev; boş öğede liste çıkış; Space/checkbox click tek transaction ile sadece marker günceller.
- **Inspector:** checked, priority (opsiyonel), due-date (opsiyonel EFSS attr; standart Markdown'a sızdırma), indentation.
- **Durum:** önerilen ayrı list variant; henüz Flow kontrolü yok.

### I. Table — tablo

- **Semantik:** satır/sütun/hücre ağacı; hücre metni inline edit; kimlikler, header row, alignment.
- **Görünüm:** satır/sütun ekleme tutamakları, hücre hover/focus, scroll/overflow uyarısı.
- **Enter:** hücre içinde paragraf/soft break sözleşmesi ayrı; Tab bir sonraki hücre, son hücrede satır ekleme **önerisi**.
- **Inspector:** columns, header, width, minWidth, alignment, cell padding, border, per-cell style.
- **Durum:** G0.7; henüz hazır değil. Markdown table ile ileri merged cells metadata ayırt edilmeli.

### J. Media / link / icon / reference

- **Semantik:** inline link ve referans hedefi; image/icon asset pointer'ı, alt text, caption, source metadata; yetki ve local path doğrulaması.
- **Görünüm:** boyut kilidi, intrinsic aspect ratio, cropping sadece açık komutla, alt-text uyarısı.
- **Enter:** metin taşıyan caption içinde normal paragraf; resim frame'inde doğrudan metin mutasyonu yok.
- **Inspector:** src/target, alt, caption, fit, aspectRatio, dimensions, alignment, license provenance.
- **Durum:** ileride artboard/layout ve rich blocks. Dosyayı kullanıcıdan habersiz kopyalama veya dış URL çağırma yok.

### K. Opaque EFSS extension

- **Semantik:** bilinmeyen `:::efss.*` uzantısını **byte-for-byte** sakla.
- **Görünüm:** okunur read-only kart, kaynak görünümüne geçiş ve güvenli hata durumu.
- **Enter / düzenleme:** Flow üzerinden içerik değiştirme yok.
- **Inspector:** type/raw length/diagnostics read-only; gizli/kişisel payload'ı loglama yok.

## 3. Ortak klavye davranış matrisi

| Girdi | Paragraph | Heading | List | Quote | Callout | Table |
| --- | --- | --- | --- | --- | --- | --- |
| Enter (dolu, caret) | Yeni paragraf | Yeni paragraf | Sonraki madde | Sonraki alıntı | Body satırı (gelecek) | Hücre davranışı (gelecek) |
| Enter (boş) | Yeni paragraf | Çıkış (öneri) | Listeden çık | Alıntıdan çık | Body paragrafı (gelecek) | Politika belirlenecek |
| Enter (seçim) | Güvenli split/replace (gelecek) | Aynısı | Aynısı | Aynısı | Aynısı | Aynısı |
| Shift+Enter | Soft break (gelecek) | Soft break | Aynı madde yeni satır | Aynı alıntı | Body soft break | Hücre içi soft break |
| Backspace @ start | Öncekine merge | Normal metne dön | Outdent veya paragraf | Quote'yi kaldır | Kutuyu koruyarak içten çık | Hücre içi |
| Tab / Shift+Tab | Normal focus | Normal focus | Indent / outdent | Depth (öneri) | Focus navigation | Hücreler arası |

**G0.6B.1 kapsama sınırı:** *collapsed caret + tek satırlı biçimsiz blok*. Zengin seçili metin, SoftBreak, numaralı kardeşler, çapraz blok seçim ve biçimli marker split şimdilik açık eksiklerdir. `Enter` bu durumlarda sessiz veri kaybı üretmez.

## 4. Görsel katman sırası ve tasarım ilkeleri

**Önerilen ilk hiyerarşi:**
`Workspace Sidebar → Document Header → Document Surface → Block Gutter / Inline Text → Floating Context Tools → Inspector`.

- Gutter blok kimliğini değil **semantik tipini** işaret eder. Ordered list gerçek ordinal kullanır; heading gerçek seviyesini gösterir.
- Liste için 22–28px marker alanı; responsive metin hizası sabit ve rakamlar tabular; 10+ sıra numarası hizalama hesabına dahil.
- Heading 1–6 birbiriyle görsel karışmayacak; fontlar Türkçe karakteri kapsayan fallback ile çalışacak.
- Seçim sırasında metin yer değiştirmemeli; hover/focus sadece decoration, kaynağa yazılacak content mutasyonu değil.
- Tablo, callout ve kod bloğunun araçları **bağlamsal** olmalı; Word ribbon tarzı her şeyi aynı anda gösterme.
- Gelecekte sağ inspector sayısal X/Y, width/height, spacing ve typography için; Flow'da sabit metin akışını etkilemeyecek.
- Görsellerin renk kontrastı, Tab erişimi ve seçimin klavye ile işlemesi WCAG hedefleri doğrultusunda gerçek GUI kabul testlerine bağlanmalı.

## 5. İlk gerçek uygulama kesiti ve test kapıları

**G0.6B.1 — kaynak güdümlü basit Enter**: listeler `- + *` marker devamı, basit numaralı listenin son öğesi için `N+1`, boş liste/alıntıdan çıkış; basit quote devamı ve paragraph/heading yeni paragraf. Her biri `TextEditorSession` üzerinden **tek replaceRange + selectionAfter**; Flow DOM yeni bloğa odaklanır. Bilinmeyen EFSS dışındaki source değiştirilmez. UI list ordinal'ı gerçek kaynak marker'dan gösterir.

**Bağlayıcı kabul:** Core testleri, yeni liste odak/Enter/Undo/Redo Electron GUI smoke, CRLF/Unicode, no-opaque-mutation, öncekilerde regresyon yok. Kaynak marker ve görünür marker eşleşmesi şart.

## 6. Kullanıcı onayı gerektiren tasarım kararları

Bu belgede tipografi ölçüleri, inspector alanlarının sırası, list nesting / ordered auto-renumber ve task-checklist varyantlarının UI tasarımı **öneridir**. Çekirdek kaynak sözleşmesi ve kayıpsız düzenleme zorunludur. Hangi blokların öncelikle görselleştirileceği, hangi kontrolün sürekli/gizli olacağı ve ileri metadata'nın versioned EFSS söz dizimi kullanıcıyla doğrulanacak; varsayımsal bir migration uygulanmayacak.

## G0.6B.2 — Atomic numbered-list Enter and visual heading levels

**Implementation slice (accept only after CI on final commit):** A collapsed caret in a simple ordered list item can split/continue that item and renumber all immediately adjacent, ascending ordered siblings of the same indentation and delimiter. It is one TextEditorSession replaceRange transaction and one Undo/Redo entry. Source caret placement follows the inserted prefix, preserving CRLF, `)` markers, leading-zero ordinals such as `001.`, and modest indentation. Blank lines, different delimiters, bullet items and unknown EFSS extensions are never traversed. Nonsequential ordinals or overflow are rejected rather than guessed.

Headings H1–H6 now have six distinct typography tiers via the semantic data-heading-level and CSS, not by altering Markdown source. Ordered list markers are derived from the source's real ordinal.

**CI correction:** Previous Windows/Linux Electron smoke runs emitted `DESKTOP GUI SMOKE PASSED` and then stayed alive until the job timed out. The smoke success path now exits via `app.exit(0)`, while failed assertions still call `app.exit(1)`. This modifies the CI test runner, not the production application lifecycle.

**Not yet supported:** Nested ordered trees, arbitrary Tab/Shift+Tab reparenting, discontinuous/manual numbered lists, normalizing an entire list, rich inline Enter, selected-range Enter, cross-block Backspace/Delete and soft breaks.

### G0.6B.2 kabul kaydı — 22 Ekim 2026

Kaynak commit `c045a1a`: 259/259 Node testi, sanity/check, Windows Electron ve Ubuntu/Xvfb Electron smoke **başarılı**. [Core workflow](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39812554275) · [Desktop workflow](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39812554366). Daha önce başarısız olan iki regresyon (CRLF içeren replaceRange ve eski numaralı-liste-ret beklentisi) düzeltilmiş ve bu SHA'da yeniden doğrulanmıştır.

G0.6B devam ediyor: görsel blok şemalarının Inspector üzerinden gerçek düzenlenmesi, Tab/Shift+Tab iç içe liste, Backspace/Delete blok birleşimi ve karma zengin metin Enter henüz yapılmadı.

## G0.6B.3 — verified one-level Tab/Shift+Tab and structural Backspace

**Durum:** Uygulandı ve doğrulandı; kapsam **tek liste seviyesi** ile sınırlı. Kaynak commit: `cd661ad2b2aeee2e81c7d699815986924a1f0dc1`. 265/265 Node + sanity/check; Windows ve Linux gerçek Electron smoke başarılı. [Core](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39817449098) · [Desktop](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39817449258).

- **Tab:** `- Ebeveyn` ardından `- Çocuk` → `  - Çocuk` (iki boşluk). Yerel EFSS AST en fazla üç başlangıç boşluğunu liste olarak kabul ettiği için ikinci nested depth **bilerek desteklenmez**. İki listenin marker türü eşleşmeli ve madde hemen önceki ebeveynle bitişik olmalı. Alt öğelerin geride kalacağı tehlikeli yeniden ebeveynleme reddedilir.
- **Shift+Tab:** İki boşluk girintili `-`, `+` veya `*` listesini orijinal düzeye indirir; metne ait Markdown kaynak byte'ları değiştirilmez. Kaynak offseti (+2/-2) ve Undo/Redo history aynı transaction içindedir. CRLF, tekil CR, Türkçe metin ve Unicode grapheme koruma testlidir.
- **Backspace @ başlangıç:** Üst düzey bullet / quote / heading kaynak prefix'ini çıkararak normal paragrafa döner. Nested bullet önce bir üst düzeye çıkar. Sıralı liste marker'ının silinmesi (yanlış renumber tehlikesi) ve cursor başlangıcından farklı konumlar bu planner'da fail-closed'dur.
- **Görsel:** `data-list-depth=1` gerçek kaynak girintisinden türetilir. Derinlik farkı margin, gutter tonu ve ince dikey vurgu ile gösterilir. Klavye odak noktası kaynak offsetine geri bağlanır; DOM ayrı belge sahibi değildir.
- **Sonraki iş (G0.6B devamı):** gerçek çok seviyeli AST nesting, Tab ile çoklu seçim/dal taşınması, Backspace/Delete çapraz blok birleşimi, paragraflarda soft break ve zengin metin Enter; ardından Inspector'ın gerçek blok attribute işlemleri. Bunlar bu turda bitmedi.

## G0.6B.4 — Visual Flow Enter and terminal prose typing, verified

**Bug root cause:** For a terminal ordinary paragraph, Enter created a trailing blank source line but the next character was inserted *before* that blank's EOL. Adjacent lines then became one multiline Markdown AST paragraph and Flow showed a read-only 'Kaynağı düzenle' action. The **terminal blank** now uses the source position *after* its trailing EOL as its editable caret, and Enter targets that exact offset. The next typed character is a second, independently editable paragraph. Blank lines inside a document still need a more general multi-block solution.

**Rich Enter:** Safe single-line strong/emphasis/strike edits can now split a mark into balanced fragments before inserting the new paragraph/list/quote, checked against identical visible text and per-character style signatures. Example: `- **kalın**` with caret after `kal` becomes two editable items `- **kal**` and `- **ın**`. Full boundary Enter is supported, including CRLF, and unknown EFSS extensions remain unchanged. Ambiguous nested asterisk interactions still fail-closed; ordered-list rich continuation is explicitly deferred.

**Verified code:** `91fa27ddc804a2333bdac1c9e7817b247aa04e25`; **269/269 Node**, sanity, Windows Electron and Linux/Xvfb Electron smoke all pass. [Core](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39834712654) · [Desktop](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39834711885). Earlier code `c0c8cc` passed too; it did not include the terminal blank focus/typing fix.

**Open:** Internal blank lines surrounded by blocks, multiline paragraph editing, selected text + Enter, physical IME, rich numbered list reindex, and cross-block Backspace/Delete. The product must not claim all visual editing issues are resolved.

## G0.6B.5 — Plain paragraph Backspace/Delete joining (verified)

**Scope:** On a collapsed caret at the start of the **second ordinary unmarked paragraph**, Backspace joins it with the first; Delete at the end of the **first paragraph** does the exact same thing. Example `Birinci\\n\\nİkinci` → `Birinciİkinci` (the notation here shows two actual Markdown source line endings). The pure planner `planFlowParagraphJoin` rejects stale documents, modified source spans, unsupported neighbors, rich B/I/S marks and anything other than **exactly one implicit blank separator**. Candidate source is reparsed with the EFSS block model and must resolve to **one editable paragraph** before mutation is allowed.

One `replaceRange` command owns both the separator deletion and the new caret; Undo/Redo restores the precise prior source and selection. LF, CRLF, lone-CR, Unicode, opaque EFSS neighbors and real desktop input events are covered. Deliberately added extra blank lines are not consumed.

**Accepted code:** `6482537c151c732d8f081a91fd4989c01fbae0b9`: **275/275 Node**, sanity gate, native Windows Electron and Ubuntu/Xvfb Electron smoke passed. [Core CI](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39844095282) · [Desktop CI](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39844095301).

**Not covered:** rich/mixed-style paragraph joining, heading-to-paragraph conversion, other block boundaries, multiple deliberate blank lines, Shift+Enter and general multiline paragraph DOM↔source selection mapping.


## G0.6B.6 — Plain multiline Flow projection and guarded Shift+Enter (first slice)

**Verified code:** `af31760f592e16e28a873e135c84bf308d220fe8` — **280/280 Node**, sanity gate and real Windows/Linux Electron GUI smoke. [Core](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39884333666) · [Desktop](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39884333685).

- A contiguous *plain* multiline Markdown paragraph (`Birinci\\nİkinci`) now has a single editable Flow projection, not a read-only source detour. Inline display is a single source-identical text run; CRLF/CR and Unicode grapheme lengths are handled via source-aware offsets. A genuine B/I/S or unsupported EFSS marker spanning lines remains fail-closed.
- `planFlowSoftBreak` inserts exactly **one local EOL** using one `TextEditorSession` source transaction when the caret has text to its right. Candidate EFSS parse must be **one editable paragraph**; a heading, list, extension, nested style collision or new syntax classification is rejected.
- `planFlowMultilineEdit` supports safe typing/removal within that one paragraph. A Backspace removing the only soft-break EOL restores a plain single-line paragraph; Undo/Redo restores source and caret. Normal Enter next to an existing internal newline inserts only the *missing* separator (not a third newline).
- **Explicit limitations:** Shift+Enter at end of line / an empty trailing soft line, multi-run rich-styled paragraphs, cross-block selections, paste with embedded newlines, and real physical IME are **not accepted**. Do not advertise all multiline editing as complete.


## Early G0.9 slice — real contextual block Inspector (25.10.2026)

**Verified code:** `fbb0ab4956eedcf8bc8b3b588af221cb63c5d6df`; **285/285 Node**, sanity and real Windows/Linux Electron smoke green. [Core](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/40196926785) · [Desktop](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/40196926766).

New right sidebar responds to selected visual block and currently exposes only three **persistable, source-backed** properties: heading H1–H6, bullet `-/+/*` source marker and callout category (info/tip/warning/success/error). Changes pass through the pure `planFlowBlockAttribute` source rewrite planner, reparse as the intended block type, and enter one Undo/Redo transaction. Unknown EFSS blocks untouched. Callout's default icon/title follow a changed category, but customized icon/title are retained. Source and Preview modes hide this panel; unsupported blocks do not expose fake editable controls.

**Not yet implemented:** arbitrary font family/size/spacing/colors, numbered list starting ordinal, table Inspector, artboard position and geometry, layer styles, persisted custom object attrs. These require versioned EFSS semantics and/or their own renderers, not merely extra HTML sliders.


## G0.7A — Editable Markdown pipe table contract (verified)

**Scope:** A source-backed pipe table must have outer `|` boundaries, 2–12 columns, a matching GFM alignment divider (`---`, `:---:`, `---:` accepted), a header, and at least one body row. First insertion uses **three columns and three visible rows** (header + two body). Escaped pipes, nested code and rich inline markers are not rewritten as plain cell values. Unknown/unparseable table dialects remain viewable in source/read-only form rather than silently normalized.

**Data path:** `src/pipe-table-parser.js` is the platform-neutral offset-aware parser; `src/ast.js` recognizes contiguous table rows without a second database. `src/editor-table-model.js` validates candidate cell and appended-row replacements against a new complete EFSS parse; all other cell text must remain equal. Flow DOM creates `contenteditable=plaintext-only` cells only as interaction views. All edits commit to `TextEditorSession` with atomic Undo/Redo. The right Inspector reports row/column count and a real **Add row** button. Tab advances through cells; Tab from final cell appends a new row. Native protocol serves only explicit bundled assets.

**Acceptance:** First step `955ab4f`, allowlist fix `b56c803`, save/reopen GUI regression `7ff3c39`. **291/291 Node + Windows/Linux Electron GUI smoke passed**, including actual vault roundtrip. [Core](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/40234791607) · [Desktop](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/40234791537).

**Not accepted:** multi-cell selection, spreadsheet-like paste, GFM escaped pipe/content syntax, row/column deletion, column insertion, nested content and mixed rich styling, IME physical acceptance, checklist, rich table inspector, general 3×3 grid resizing. Table is a first reliable object slice, not a finished spreadsheet.

