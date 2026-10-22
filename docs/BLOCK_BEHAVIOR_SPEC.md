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
