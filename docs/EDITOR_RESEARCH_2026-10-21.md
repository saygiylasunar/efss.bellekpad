# BellekPad — Bağımsız Editör Motoru: Araştırma ve Teknik Karar Raporu

**Araştırma tarihi:** 2026-10-21
**Durum:** Literatür ve spesifikasyon araştırması tamamlandı. Tarayıcı üzerinde gerçek kullanıcı girdisi denemeleri ve görsel editör uygulaması henüz yapılmadı.
**Yetki sınırı:** Haricî editor/UI runtime dependency yok; diğer projelerin **mühendislik ilkeleri** incelenir, kaynak kodu kopyalanmaz, veri modelimiz üçüncü taraf formatına bağlanmaz.

## 1. Değerlendirilen örnekler: ne öğrenilir, ne alınmaz?

| Kaynak | Somut ders | BellekPad'e uyarlama | Aktarılmayacak şey |
|---|---|---|---|
| ProseMirror | Değişiklik bir **step/transaction**; ters işlem ve belge konumu haritası oluşturur. | Tek işlem hattı, yerel offset eşleme, undo/redo için inverse step. | ProseMirror schema, node/plug-in ekosistemi ve runtime kodu. |
| Lexical | DOM tek doğruluk kaynağı değil; editör state snapshot'ı ve kontrollü render. | Versiyonlanan belge modeli, dirty subtree render, seçim durumu. | Framework'e özel node sınıfları, command API'si ve serileştirme. |
| Slate | Yapısal invariants ve normalizasyon, kirli içeriği kontrollü onarma. | İç içe blok kuralları, boş blokların seçim adresi, aynı stile sahip komşu run birleştirme. | Kullanıcı içeriğini sessizce silen/otomatik dönüştüren kurallar. |
| CodeMirror | Değişiklik haritalama, editör durumu ile görünür viewport'un ayrılması. | Büyük belgeler için ileride incremental update ve seçime duyarlı görünür alan optimizasyonu. | EditorView veya paket mimarisinin ithali. |
| W3C Input Events | Girdi olayları, IME ile ilişkili istisnalar ve \`getTargetRanges\`. | Native input adaptörü, ayrı composition durumu, unexpected-input reconciling. | \`beforeinput\`'ın her zaman engellenebilir olduğu varsayımı. |
| MDN EditContext | DOM/CSS dışında özelleştirilmiş input kontrolü; OS composition koordinatları yükümlülüğü. | EditContext ayrı deneysel adaptör olabilir. | Tek veya zorunlu platform yolu (genel browser desteği yok). |
| CSS Grid/Flex + Range | Native intrinsic size ve metin ölçümü. | Görünümü native CSS/DOM'da şekillendirip kendi layout modelimizi doğrulama. | CSS'nin tek başına kanonik artboard koordinat motoru sayılması. |
| CommonMark/GFM | Markdown'ın tanımlı taşınabilir altkümesi. | Standart içerik söz dizimi, kaynak koruma ve roundtrip testleri. | Düzen tablosunu spreadsheet veya çakışma motoru sanmak. |

**Kaynaklar:**
- https://prosemirror.net/docs/guide/
- https://lexicaljs.org/docs/concepts/editor-state
- https://docs.slatejs.org/concepts/11-normalizing
- https://codemirror.net/docs/guide/
- https://www.w3.org/TR/2026/WD-input-events-2-20261015/
- https://developer.mozilla.org/en-US/docs/Web/API/Element/beforeinput_event
- https://developer.mozilla.org/en-US/docs/Web/API/EditContext_API
- https://www.w3.org/TR/css-grid/
- https://spec.commonmark.org/
- https://github.github.com/gfm/

## 2. En büyük teknik risk: tarayıcı girdisi

**Üç incelenen native input yolu:**

**A — Kontrol edilmiş contenteditable (ilk araştırma prototipi için öneri):**
- Artboard üzerindeki **aktif metin çerçevesi** bir düzenleme host'u; başka her nesne yalnızca görünüm.
- Model, işlemleri ve history'yi BellekPad yönetir.
- \`beforeinput\` iptal edilebilen işlemleri kontrollü transaction'a çevirir.
- IME composition ve iptal edilemeyen girişlerde native DOM ile **reconciliation** gerekir; DOM değişimini bütünüyle engellemeye çalışma.
- \`compositionstart\` → düzenleme aralığını koru → \`compositionend\` → atomik transaction; input kaybolursa geri kazanım.
- Yapıştırmada varsayılan **plain text**; zengin içerik ancak açık izinli etiket/özellik dönüştürücüsüyle.

**B — Gizli textarea + özel çizilmiş caret (yedek değerlendirme):**
- Metin girişinin native tarafı kolaylaşabilir fakat seçim, çoksatırlı satır kırımı, ekran okuyucu, tıklayarak caret yerleştirme ve IME popup konumu pahalı ve hata riski yüksek.
- Metin ağırlıklı bir uygulamanın varsayılan mimarisi olarak **reddedildi**.

**C — EditContext (opsiyonel feature-detected araştırma):**
- Native IME ile özel görünüm arasındaki ilişkiyi çözer ama limited-availability/experimental.
- **Zorunlu bağımlılık veya ilk sürümün varsayılan adaptörü olamaz.**

**Zorunlu gerçek tarayıcı matrisi:** Chromium/Vivaldi (Windows), Firefox, Safari/WebKit erişilebiliyorsa, mobil dokunmatik/virtual keyboard. Yalnızca Node birim testleri input/IME doğruluğunu ispatlamaz.

**Kaynaklar:**
- https://developer.mozilla.org/en-US/docs/Web/API/Element/beforeinput_event
- https://developer.mozilla.org/en-US/docs/Web/API/Selection_API
- https://developer.mozilla.org/en-US/docs/Web/API/EditContext_API
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/contenteditable
- https://github.com/web-platform-tests/wpt

## 3. Veri modeli, seçim, işlem ve geçmiş

**Tek doğruluk kaynağı:** Düzenleme oturumunda **BellekPad belge modeli**. DOM onun görünümüdür, Markdown dosyası kaydedilen taşınabilir kaynaktır. İkisi rakip canlı modeller değildir.

Önerilen yapı:
- Document: sabit belge kimliği, revision, sayfa kimliklerinin sırası, stil kataloğu, asset referansları.
- Artboard: preset, gerçek boyut/birim, margin/bleed ve çocuk layout frame'leri.
- Frame: id, parentId, flow/row/column/grid/free strategy, constraints, readingOrder, zIndex.
- Block: paragraph/heading/callout/table/code/icon/image vb. tür ve stable id.
- TextRun: string + stil öznitelikleri; görsel DOM span veya CSS serializasyonunun kendisi değil.
- Selection: \`{anchor:{nodeId,offset,affinity},focus:{...}}\`; cursor yönünü sakla.

**Offset disiplinimiz:**
- Mevcut EFSS AST UTF-16 source aralıkları üretir.
- Görünür karakter bakımından kullanıcı hareketi Unicode **grapheme cluster** sınırına kilitlenir (Intl.Segmenter).
- DOM Selection/Range UTF-16 text node offset'lerini modelin node-local UTF-16 offset'ine çevir.
- Step/transaction sonrası \`position map\` ile anchor/focus remap et.
- Source aralıkları edit sonrasında *eski source'un kalıcı adresi* sayılmaz; serialize edilmiş yeni source için yeniden hesaplanır.
- Emoji ZWJ, variation selectors, combining Turkish/Latin accents, surrogate pair'i ortadan bölme.

**Transaction ilkesi:** kullanıcıya görünen bir niyet **tek komut**, tek validate, tek commit, seçimi dönüştürme, tek undo step olarak ele alınır. Örnekler: replaceText, splitBlock, mergeBlocks, setMark, setFrameBounds, moveFrame, insertCallout, insertTable, changePagePreset. Mutation sıradan DOM uygulaması değil veri modeli operasyonudur. Backspace, Enter, Ctrl+Z, toolbar ve slash menu aynı komut arayüzünü kullanır.

**Validation/normalization:** yapının bozuk olmasını tespit et, kontrollü düzeltilebilir minimal durumları normalize et, **kullanıcı metnini sessizce silme**, eski/unknown extension'ı ham metin olarak sakla. Aynı marklara sahip bitişik run'ları birleştirmek, empty paragraph selection host yaratmak gibi işlemler kontrollü olmalı.

**Kaynaklar:**
- https://prosemirror.net/docs/guide/
- https://lexicaljs.org/docs/concepts/editor-state
- https://docs.slatejs.org/concepts/11-normalizing
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter

## 4. İçeriğin yerleşimden ayrılması

Flow içeriği ve Layout artboard'u **ayrı belge türü değil**: her TextFrame içerik ağacına, her frame layout hiyerarşisine bağlanır.

**Ölç/yerleştir/doğrula:**
1. **Intrinsic measurement**: yüklenmiş gerçek font, metin en/boy/linewrap, nested child min/max.
2. **Constraint pass**: artboard usable bounds, padding, gap, min/max, fixed/auto/percent ve aspect-ratio.
3. **Placement pass**: flow sırası veya row/column/grid track'leri; relative child rect'ler.
4. **Collision/overflow pass**: sibling intersect, text intrinsic overflow, artboard dışına taşma, unsatisfied constraints.
5. **Render and diagnostic**: sorun varsa içeriği sessizce itme/kırpma veya font küçültme yapma; kullanıcıya göster.
6. **Recompute only invalidated subtree**: tekrar tekrar tüm belgeyi ölçme.

**Temel durumlar:**
- Row/Column/Grid: üst üste binme yasak. Tüm koşullar çözülemiyorsa işlemi reddet veya layout uyarısı ver; otomatik yığınlaştırma kullanıcı seçeneği.
- Flow: yüksekliği içerik belirler, sonraki bloklar kayar; sabit sayfadan taşarsa uyarı veya açık devam/overflow politikası.
- Free/Overlay: explicit intentional overlap, z-order, hit testing ve snapping. İlk sürüm için isteğe bağlı ayrı yerleşim modu.
- Layout switch: **resize page**, **scale content**, **reflow** üç farklı işlem olarak sunulur. Kullanıcı açık seçim yapar.
- Artboard size = logical CSS px veya fiziksel mm/in gibi kanonik birim; zoom yalnız viewport ölçeği.
- TextFrame'in dış geometrisi vektörel olarak ölçeklenebilir, metin içeriği editable Unicode kalır. Outlines ayrı, non-destructive ileriki işlem.
- CSS Grid/Flex görüntüleme ve intrinsic measurement için kullanılabilir; kanonik frame modelimizi belirleyemez.
- \`ResizeObserver\` ölçüm aboneliği verir ama callback içinde ölçümü değiştiren yazmalar sonsuz reflow döngüsü yaratabilir; frame hesaplamasını ölçüm ve DOM commit evrelerine ayır.

**Kaynaklar:**
- https://www.w3.org/TR/css-grid/
- https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
- https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Using

## 5. Yazı şekillendirme, glif kontrolü ve sınırlar

Başlangıçta editable metni HTML DOM/CSS ile render et; frame/handles/guide'ları gerektiğinde SVG/CSS overlay ile çiz. Bütün metni canvas'a çizmek native seçim, klavye ve erişilebilirliği gereksiz yere zorlaştırır.

**Desteklenebilir denetimler:** font family/weight/style, letter-spacing/tracking, font-kerning, font-variant, line-height, paragraph alignment, OpenType \`font-feature-settings\`, variable-font \`font-variation-settings\`. Font ve platform desteklemiyorsa seçenek devre dışı; simüle edilmiş sahte kontrol yok.

- \`document.fonts.ready\` font load ve layout stabilizasyonunu beklemek için kullanılabilir; fakat \`document.fonts.check\` glyph coverage ispatlamaz.
- \`Range.getClientRects()\` gerçek DOM yerleşiminde satır/selection bounds testine yardımcıdır.
- Print ve ekran fontu farklı rasterleştirilebilir; varyant/kerning/ligatür farklarını raporla.
- Illustrator tarzı her glifin outline düğümlerini düzenleme, font tablolarından güvenli path çıkarma ve font lisansları ayrı **ileri aşama**. Vektör TextFrame ≠ gliflerin path'e çevrilmesi.

**Kaynaklar:**
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-feature-settings
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-variation-settings
- https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/ready
- https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check

## 6. EFSS Markdown kayıpsızlığı ve kalıcı kimlik sorunu

İki bilinçli trade-off:

**A. Sade Markdown + güçlü görsel düzen.**
- Plain Markdown her şeyi ifade edemez: merged cells, özel baseline/glif ayarları, artboard, free transforms, page size, z-index.
- Özel bloklar/yerleşim için versioned EFSS extension şart.
- Bilinmeyen extension'ları AST olduğu gibi saklayıp görsel editörde read-only placeholder gösterebilmeliyiz.
- Değiştirilmemiş source parçalarının byte/line-ending farkı mümkünse korunmalı; source roundtrip kesin olarak test edilmeli.
- Standart GFM table sadece düz tablo için. Nested blocks/merged cell rich-table extension olmalı.

**B. Stable ID vs. temiz Markdown.**
- Sıradan Markdown başlık ve paragrafının içinden kalıcı ID türetilemez: metin düzenlenince/yer değiştirince kimlik değişir.
- Geçici oturum içi ID sorun değildir; artboard, ilişkili TextFrame, asset ve kalıcı cross-block reference için explicit ID'nin **versiyonlu EFSS meta/extension** biçiminde kaydı gerekir.
- ID kaydının nereye konacağı, diff dostluğu ve raw source estetiği en büyük söz dizimi kararıdır. Önce minik bir source roundtrip prototipiyle belirle; şimdi global parser'ı zorla değiştirme.
- Bir belgenin farklı sayfaları ve frame'leri için tek atomik snapshot/manifest export gerekir; birbirinden bağımsız kayıtlar kırık referans üretebilir.

**Kaynaklar:**
- https://spec.commonmark.org/
- https://github.github.com/gfm/
- https://github.com/github/docs/blob/main/content/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-tables.md

## 7. Güvenlik, erişilebilirlik, saklama

- DOM'u **modelden** güvenli \`textContent\` ve createElement ile kur; ham kullanıcı Markdown/HTML'ini hiç sanitization olmadan \`innerHTML\` olarak basma.
- Clipboard HTML güvenilir değildir. İlk sürümde plain-text yapıştırma ve onaylı zengin content node dönüşümü; URL protokol allowlist; dış SVG ve font ayrı hak/güvenlik kontrolü.
- Deneysel native Sanitizer API'sine tek savunma olarak bağlanma (Baseline değil).
- Keyboard focus and ARIA: toolbars için tek tab stop/arrow navigasyonu, slash menu için listbox/combobox pattern, screenreader için logical reading order, artboard z-order'dan bağımsız.
- IndexedDB varsayılan best-effort storage: tarayıcı veriyi evict edebilir. \`navigator.storage.persist()\` isteği yardımcıdır ama silinmeme garantisi değildir. Yerel export ve test edilen geri yükleme zorunludur.
- Public GitHub'a kimlik/font/media/özel içerik/yerel kişisel dosya gönderme; telifli üçüncü taraf kodu kopyalamamak için çalışma notlarında kaynak/mantık/özgün uygulama ayrımı yap.
- Fikir, yöntem veya algoritmayı incelemek ile başkasının yazılım kaynak kodunu kopyalamak ayrı hak kategorileridir. Bu rapor izin vermeyen herhangi bir üçüncü taraf lisansını devre dışı bırakmaz.

**Kaynaklar:**
- https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API
- https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API
- https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/
- https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- https://www.wipo.int/en/web/copyright/activities/software

## 8. Yapılacak ilk beş araştırma prototipi — kodu sabitlemeden önce

| ID | Dar deney | Objektif geçme ölçütü | Başarısızsa |
|---|---|---|---|
| S1 | **Native input spike:** aktif text frame içinde contenteditable; beforeinput, composition, paste, selection | Windows Chromium/Vivaldi + Firefox'ta Türkçe, emoji ZWJ, IME composition, Ctrl+Z, yapıştırma sonrası kayıpsız kaynak ve doğru caret | textarea/visible hybrid'i değerlendir, EditContext sadece destekliyse |
| S2 | **Pure transaction core:** replaceText, split/merge, mark, invert step, selection mapping | DOM'suz 100+ adversarial edit cases; undo→redo ilk metin, seçim ve stilini verir | step/selection modelini düzelt, UI'ya geçme |
| S3 | **Source roundtrip:** paragraph, list, callout, GFM table, unknown EFSS block | serialize→parse tekrarında içerik/ID/layout ve unknown raw extension korunsun | extension contract çözülmeden layout kaydetme |
| S4 | **Layout spike:** 2 text frame + icon, nested row/grid, artboard presets, overflow | Constraint ihlali olduğunda sessiz overlap/clip olmaması, net hata veya kullanıcıya seçim | free coords modunu geciktir, flow/row'a odaklan |
| S5 | **Typography spike:** font switching, line height, tracking, kerning, zoom | DOM ölçüsü ile gösterilen bounds senkron; font yüklenince overflow yeniden hesaplanır, text editable kalır | ölçüm adapter ve font fallback'i düzelt |

**Test matrisi:** cross-browser hands-on manual UI + native event logs + DOM snapshot + property-based model operations + accessibility smoke tests. Node testlerinin yeşil olması **UI correct** anlamına gelmez.

**Başlangıç sırası:** S2 pure core ve S1 input spike paralel tasarlanır; önce en az S1 keyboard/IME correctness kanıtı. Sonra S3 parser/serializer, S4 artboard, S5 typography. Kapsam dışı: PDF/DPI, collaboration, rich media, vector outline extraction.

## 9. Ölçüm hedefleri (başlangıç kriterleri, ölçülmüş performans değildir)

- 5.000 paragraflık sentetik dokümanda tek karakter girişi tüm belgeyi parse/render etmek zorunda kalmamalı.
- Undo/redo tek niyeti geri çevirmeli; yeniden oluşturmada eski cursor/selection kaybolmamalı.
- Artboard işlemleri deterministic sonuç vermeli: aynı input ve constraints → aynı placement/dia­gnostic (font metrikleri platforma bağlı değişebilir; measurement adapter fixture ile ayrı test edilir).
- İnput gecikmesi için %95 event-to-paint hedefi normal notlarda 50 ms altında; gerçek cihazda raporlanacak, asla CI test sayısıyla karıştırılmayacak.
- Sıfır veri kaybı: tekrar açınca kullanıcı metni ve explicit layout metadata korunmalı; overflow durumunda hiçbir karakter silinmemeli.

## 10. Araştırmanın hükmü

**Yapılacak:** kaynak sahibi EFSS AST + BellekPad transaction model + browser-native input bridge + constraint layout + semantic DOM typography. Dış editör motoru/runtime framework bağımlılığı **yok**.

**Düzgün sınır:** Bizim yazacağımız şey text/layout mantığıdır; işletim sistemi Unicode input/IME ve tarayıcı glyph shaping'i devralınabilir platform yeteneğidir. Font rasterizer, OS klavye sürücüsü veya PDF standardını kendimiz yazmak zorunda değiliz.

**En büyük açık:** Native composition olaylarının gerçek tarayıcılarda gözlemlenmesi ve EFSS layout extension'ının kayıpsız/kararlı kimlikli yapısı. Bu iki risk giderilmeden kapsamlı UI teslim edildi diye işaretlenmez.
