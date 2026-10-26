# EFSS BellekPad — Devir README'si ve Uygulama Roadmap'i

> **Bu dosya yeni sohbetin birincil devam noktasıdır.**
> Güncelleme: **26 Ekim 2026** | Repository: **saygiylasunar/efss.bellekpad** | Dal: **main**.
> Doğrulanan durum: **G0.7B kısmi — tıklanabilir checklist + kontrollü son tablo satırını silme**, G0.9 erken Inspector ve G0.6B.6 kısmi / v0.2.8. Son doğrulanan KOD commit'i **d452657c04ebd3ba200d1ca97ceb8727e669ddb0**. **299/299 Node, sanity/check ve Windows/Linux gerçek Electron GUI smoke başarılı; checklist için gerçek kasa kaydet/aç doğrulandı.** [Ürün yönü](PRODUCT_DIRECTION.md) · [Blok sözleşmesi](BLOCK_BEHAVIOR_SPEC.md). G0.7'nin tamamı bitmedi.
> Bu belge de commit edileceği için yeni sohbette **önce gerçek HEAD'i ve CI'yi tekrar kontrol et**.

> **26.10.2026 G0.7B İLK TESLİM:** Menüde “Yapılacak görev” bloğu (`- [ ] `) ve doğrudan tıklanabilir görsel checkbox var. `- [x]` ↔ `- [ ]` değişikliği yalnız tek karakter kaynak işlemi; Undo/Redo, tamamlanmış görevden Enter ile yeni boş görev, tek seviye Tab/Shift+Tab, Backspace ve kaydet-aç GUI regresyonlarından geçti. Tablo Inspector'ına **“Son satırı sil”** geldi: yalnız son veri satırını ve en az bir veri satırının korunmasını destekler. Silme tek Undo/Redo işlemi, tekrar parse ve opaque EFSS byte denetimli. **`62e7a6a` (checklist) → `d452657` (satır silme), 299/299 Node + gerçek Win/Linux Electron smoke yeşil.** G0.7B'nin tümü **bitmedi**: seçili herhangi satırı silme, sütun ekle/sil, grid paste, tüm GFM biçimleri/IME yok.

> **25.10.2026 G0.7A TABLO KABULÜ:** Inspector'dan/tablodan bağımsız blok ekleme menüsünden gerçek Markdown pipe table ekleme çalışıyor. Üç sütun × üç görünür satır (1 header + 2 body), kaynakta tüm hücreler aynı EFSS belgede. Hücreye doğrudan yazma/silme, hücrelerde Tab/Shift+Tab, son hücreden Tab veya Inspector düğmesiyle yeni satır ve Undo/Redo mevcut. Gerçek Electron kasa kaydet-yeniden aç regresyonu eklendi. Korunan kapsam: yalnız kanonik leading/trailing pipe, kaçışsız sade hücre metni ve header divider; Markdown işaretli hücreler ve karmaşık GFM dialektleri read-only/fail-closed. **291/291 Node + Win/Linux gerçek GUI smoke başarılı, kaynak commit `7ff3c39`.** Satır silme, sütun ekle/sil, çoklu hücre seçimi, paste-grid ve checklist henüz YOK.

> **25.10.2026 ÜRÜN YÖRÜNGESİ DÜZELTMESİ:** Bir sonraki temel hedef sırf metin motoru testi artırmak değil, kullanıcının doğrudan gördüğü **bağlamsal nesne özellikleri, gerçek tablolar, yerel LLM bağlantısı ve artboard**. Bu nedenle önceden G0.9'a bırakılan Inspector'ın dar, gerçek veri değiştiren ilk kesiti öne alındı. `fbb0ab`: seçili heading H1–H6, bullet `-/+/*` ve callout variant (default title/icon güncellemesi, kişiselleştirilmiş dekorları koruma) kaynak doğrulamalı `replaceRange` ve Undo/Redo ile sağ Inspector'dan yönetiliyor. **285/285 Node + Windows/Linux Electron smoke yeşil.** Geri kalan Inspector özellikleri (font size, renk, artboard geometry) uygulanmış değildir. [Ürün yönü ve kabul kapıları](PRODUCT_DIRECTION.md).

> **G0.6B.6 kısmi çok satırlı editör — 23.10.2026:** Güvenli düz metin paragrafları iki kaynak satırına yayıldığında artık Flow'da tek **editable** metin yüzeyidir; Markdown AST ve aynı TextEditorSession journal korunur. Metnin ortasındaki Shift+Enter tek yerel EOL ekler; sonraki yazma ve Backspace görsel editörde, Undo/Redo ile çalışır. Önceden var olan satır kırığının çevresinde normal Enter atıldığında 3. EOL üretilmez. **Sınır:** Shift+Enter'ın *satır sonunda boş satır açma* davranışı, rich çok satır, çapraz blok seçim ve fiziksel IME henüz desteklenmiyor; güvenle reddediliyor. `af31760`: **280/280 Node + Windows/Linux Electron smoke yeşil**.

> **G0.6B.5 paragraf birleşimi — 22.10.2026:** Görsel Flow'da ikinci düz paragrafın başında Backspace ya da ilkinin sonunda Delete, aradaki tam iki kaynak satır sonunu **tek replaceRange transaction** ile kaldırır. Örnek: `Birinci\n\nİkinci` → `Birinciİkinci`. Candidate EFSS parser ile yeniden açılıp tek **editable** paragraf kaldığı doğrulanır. Başlık/liste/alıntı, kalın-italik-karışık kaynak, fazladan blank ve bilinmeyen EFSS üzerinden birleşim **reddedilir**, byte kaybı yaratılmaz. `6482537` kodu **275/275 Node ve Windows/Linux Electron smoke başarılı**. **Model entegrasyonu hâlâ Electron IPC'ye bağlı değil; G0.6B/C doğal editör kabulü bitmeden hazır gibi sunulmayacak.**

> **G0.6B.4 görsel yazma düzeltmesi — 22.10.2026:** Görsel Flow'da normal paragraf sonu Enter ve ardından yazma, terminal boş bloğa yanlış source offsetinden yazdığı için iki kaynak satırı tek çok satırlı, read-only paragrafa birleştiriyordu; kullanıcıyı "Kaynağı düzenle" yoluna gönderiyordu. Son terminal boş satırda offset artık EOL sonuna bağlanır, Enter caret'i de bu sınırla hizalanır. Güvenli B/I/S işaretli tek satırlı paragraf, liste, başlık ve alıntıda Enter için parser/stil oracle doğrulamalı split de eklendi; riskli iç içe yıldız çakışmaları hâlâ kayıpsız reddedilir. `91fa27d` **269/269 Node + Windows/Linux gerçek Electron smoke yeşil**. **İçteki boş satırlar, çok satırlı birleşik paragraf, fiziksel IME ve karma çapraz blok senaryoları tamamlanmadı.**

> **G0.6B.3 doğrulama — 22.10.2026:** Tek seviyeli (`0 → 2 boşluk`) madde işaretli listede `Tab` ve `Shift+Tab` tek kaynağa bağlı replaceRange transaction olarak eklendi. Önceki uyumlu ebeveyn yoksa, ikinci derinlik istenirse, varsa alt öğeler yeniden ebeveynlenecekse veya sıralı listeyi etkileyecekse işlem fail-closed. Liste/başlık/alıntıda görünür metin başlangıcındaki `Backspace`, marker'ı tek Undo adımında kaldırır; iç içe listede önce outdent yapar. Veri ve unknown EFSS korunur. `cd661ad` **265/265 test**, Core + Windows/Linux smoke başarılı. G0.6B devam eder: keyfi nested tree, cross-block merge, rich split/IME, gerçek Inspector yok.

> **G0.6A.1 güncellemesi / ana dal doğrulaması:** `dfac015` kaynak + GUI köprü düzeltmeleri, `219/219` Node testi ve gerçek Windows/Linux Electron smoke **başarılı**. Rich span içindeki imleç artık kendi kaynak run'ını seçiyor; görünmeyen Markdown işaretlerini tüketecek karışık seçimler reddediliyor. Bu **tam rich selection editing değildir**; sıradaki kesit **G0.6A.2 run split/merge**, sonra G0.6B. Detay: [EDITOR_G0_6A.md](EDITOR_G0_6A.md). Önceki G0.5 durum paragrafı aşağıda tarihsel referans niteliğindedir.

> **UI asset güncellemesi (v0.2.7):** All Round Gothic / Noka / Exo yerel ve fallback font tokenları, özgün SVG icon registry, toolbar/sidebar/callout iconları. Verilen Adobe Fonts Web Project `aww8lcp` **yalnız web örneğine** eklendi; Electron CSP/offline ilkesi gevşetilmedi, üçüncü taraf font dosyası paketlenmedi. Adobe lisansı kullanıcıların kendi belge metninde bu web fontlarını seçebileceği tasarım editörü için yeterli değil; ilgili font menüsünde kullanmadan ayrı izin denetimi gerekir. [docs/TYPOGRAPHY_ICONOGRAPHY.md](TYPOGRAPHY_ICONOGRAPHY.md). **G0.6A.2 hâlâ sıradaki metin motoru görevi; bu yalnızca paralel UI asset kesitidir.** **UI kit doğrulama:** 223/223 Node test ve gerçek Windows/Linux Electron smoke başarılı; test sıra bağımlılığı düzeltildi (`5893692`).

> **G0.6A.2 güncellemesi:** Tam seçilmiş Markdown stilleri ve yanındaki düz metni birlikte değiştirme/silme, marker korumalı balanced splice ile desteklenir. Güvenli karma strike, 230/230 Node ve Windows/Linux Electron smoke doğrulandı. Kısmi kesilen stiller ve genelleştirilmiş karma B/I henüz eksik. [EDITOR_G0_6A_2.md](EDITOR_G0_6A_2.md).

> **G0.6A.2 takip iyileştirmesi:** İlk complete-run balanced splice üzerine **tek seviyeli kısmi Markdown biçim seçimi** de güvenli close/reopen algoritmasıyla eklendi. `A **kalın** B` üzerinde kısmi rich→plain/ plain→rich edit geri alınabilir ve kalan biçimi korur. 232/232 Node + Windows/Linux Electron smoke geçti (`7ecb9e7`). **Nested partial mark ve genel karma B/I/S hâlâ eksik.** [EDITOR_G0_6A_2.md](EDITOR_G0_6A_2.md).

> **G0.6A.2 nested takip doğrulaması:** `6f27e29` ile kısmi iç içe strike/strong kaynak aralıkları, kapanış/açılış sırası + parser/stil invariants ile güvenli düzenlenebilir oldu. Ters DOM selection, Undo/Redo, save/open, CRLF ve opaque EFSS regresyonları eklendi; **235/235 Node, Windows ve Linux smoke yeşil**. B/I yıldız marker çakışmaları hâlâ fail-closed ve genel mixed B/I/S hâlâ eksik. [EDITOR_G0_6A_2.md](EDITOR_G0_6A_2.md).

> **G0.6A.2 yeni doğrulama:** `a41c246` kısmi kalın/düz seçimlere strike uygulamasını; strike+düz içerik için karma B/I eklemeyi güvenli sınırlar içinde genişletti. `9e534eb` seçimin ileri/ters anchor/focus yönünü **aynı replaceRange transaction'ına** kaydediyor; Undo ve Redo artık orijinal/son biçim seçimini Flow DOM'unda geri getiriyor. Asterisk `***` collision hâlâ fail-closed. Source, CRLF, EFSS opaque ve save/open regresyonları mevcut. Core **241/241**, Windows/Linux smoke **yeşil**. [Detay](EDITOR_G0_6A_2.md).

> **G0.6A.2 kaynak güvenliği ek kesiti:** düz-run mark ekleme ve tam mark kaldırma da tek `verifyMarkCandidate` parser/stil doğrulamasından geçer. Bitişik `*` / `**` işaretlerinde görünür metni değiştirebilecek sonuçlar `MARK_SOURCE_COLLISION` olarak fail-closed reddedilir. Kaynağı, migration veya bağımlılık olmadan korumayı hedefler. CI yeni commit üzerinden doğrulanmalıdır.

> **CI geri dönüş düzeltmesi:** `e8be393` commit'i CI'da başarısız oldu (5 Node ReferenceError + Windows/Linux mixed-strike smoke); mixed format branch'inde tanımsız `candidate` erişimi, zaten hesaplanmış `validated` kaynak ofsetleriyle değiştirildi ve regresyon testi eklendi. Bu düzeltmeyi içerdiği commit'in CI durumunu ayrıca denetle; eski yeşil sonucu taşımamalısın.

> **G0.6B.1 uygulama kesiti (CI doğrulaması gerekli):** [BLOCK_BEHAVIOR_SPEC.md](BLOCK_BEHAVIOR_SPEC.md) içinde blokların anlam, görsel nitelik, Enter/Backspace/Tab, inspector ve kaynak sözleşmesi tanımlandı. İlk saf Enter davranışı: liste devamı, boş öğede çıkış, paragraph/heading split, basit quote devamı; numaralı kardeş yeniden numaralama/rich Enter henüz fail-closed. Bunların kabulü yeni commit Core ve Windows/Linux Electron smoke sonuçlarına bağlıdır.

> **G0.6B.2 doğrulandı (259/259, Windows/Linux):** Ardışık numaralı kardeşlerin Enter ile atomik yeniden numaralanması; `001.`, `7)`, girinti, CRLF ve opaque EFSS veri bütünlüğü. Başlık H1–H6 görünümü semantik seviyeye bağlı. Electron smoke önce PASSED bastıktan sonra `app.quit()` ile kapanamayıp CI timeout oluyordu; smoke başarı yolunda `app.exit(0)` kullanılıyor. [Blok sözleşmesi](BLOCK_BEHAVIOR_SPEC.md). Yeni HEAD üzerinde Core ve Windows/Linux Electron kabulü doğrulanmalı.

## 0. Ürünü bir paragrafta devret

**BellekPad**, EFSS Markdown'ı taşınabilir **kalıcı kaynak dili** olarak kullanan, ama kullanıcıyı Markdown yazmaya zorlamayan; Word kadar güçlü metin düzenlemeyi, Notion benzeri blok/komut eklemeyi ve Illustrator benzeri hassas konum/ölçü/typography denetimini **minimal, öngörülebilir arayüzle** sunmayı hedefleyen **yerel-öncelikli Electron masaüstü editörü**. Kendi belge modeli, transaction/undo motoru, görsel metin işleme ve artboard/layout algoritması geliştirilecek. Başka editörlerin fikirleri/algoritmaları araştırılabilir, ancak **başka editör kütüphanesi ya da veri formatı projeye ithal edilmeyecek**. Mevcut sürüm tam ürün değil; çalışan **erken G0.5 görsel Flow prototipi**.

## 1. Kesinleşmiş kararlar — yeniden sorma / ihlal etme

1. **Sahiplik ve çalışma düzeni:** Fikir kullanıcıdan gelir, mühendislik araştırması ve uygulama asistandan, son onay kullanıcıdandır. Gelişmiş seçenek önerilebilir; onaysız ürün yönü değiştirilmez.
2. **Electron kesin.** Windows masaüstü ilk hedef. Çekirdek Electron API'lerine bağlı olmamalı; gelecekte web/mobil aynı belge motorundan yararlanabilmeli. Electron editör kütüphanesi değil, host/packaging katmanı.
3. **Haricî editor/UI runtime yok.** Tiptap, ProseMirror, Lexical, Slate, CodeMirror, TinyMCE, Vue, React vb. import edilmez. Kendi ES modules; DOM/CSS/SVG, standard JS/Node/Unicode API'leri kullanılabilir. Haricî kodu kopyalama; yöntemlerden esinlen ve özgün uygulama geliştir. Yeni paketler için kullanıcı onayı gerekir.
4. **Tek belge doğruluğu:** EFSS Markdown kaynak/AST + kendi transaction/document modeli; DOM yalnız görünüm ve girdidir. **Görsel / Kaynak / Önizleme** ikinci kopya oluşturmaz. Bilinmeyen EFSS extension bozulmadan saklanır. Kalıcı layout, ileri typography ve frame bilgisi ileride **versioned EFSS extension/manifest** ile kaydedilecek; sözleşmesi henüz sonlandırılmadı.
5. **Flow + Layout**, farklı belge değil; aynı belgenin farklı davranışları. Flow doğal metin sırası; Layout çoklu artboard, TextFrame/Icon/ImageFrame, row/column/grid ve kullanıcı tercihli free/overlay katmanı. **İstenmeyen overlap, gizli clipping, otomatik font küçültme ve sessiz veri kaybı olmaz**.
6. **Minimal UI:** sol workspace/belge navigasyonu; ortada belge/artboard; gerektiğinde sağ bağlamsal Illustrator usulü Inspector. Seçim toolbar'ı, sağ tık, artı ve slash komutları **aynı transaction komutlarına** dayanmalı. Word ribbon karmaşası ve Notion sürprizleri yok.
7. **Geliştirici araçları son kullanıcı UI'sinde görünmez:** Electron \`devTools:false\`, default menu yok, F12/Ctrl+Shift+I/J/C ve reload kısayolları engellenmiş; normal cut/copy/paste ve OS pencere kontrolleri korunmuş. **Bu DRM veya sistem düzeyinde garanti edilmiş anti-debug değil.**
8. **Güvenlik/gizlilik:** renderer sandbox/contextIsolation; dar \`preload\`+IPC; renderer'da keyfî Node/fs/eval yok. Yerel notlar/özel yollar/keys/modeller repoya gönderilmez. IPC revizyon çakışmasında üzerine yazmamalı.
9. **Lisans:** Kök \`LICENSE\` dosyası **proprietary / all rights reserved**; npm \`private:true\`, \`license:"UNLICENSED"\`. Public GitHub görünürlüğü genel kullanım lisansı değildir; GitHub platform hakları/yasal istisnalar geçerlidir. Gerçek tescil, ücretli dağıtım EULA'sı ve exe imzalama henüz yok. Adobe Fonts/ikon ancak dağıtım izni kontrolünden sonra.
10. **Mühendislik disiplini:** test/smoke/güvenlik ve geri al/yapıştır/IME doğruluğunu göster; CI kırmızıysa onar. “Bug'sız” veya “tam WYSIWYG” deme: doğrulanan ve doğrulanmayanı ayrı belirt. Ek paketle geçiştirmek yerine özgün motoru düzelt.

## 2. Güncel kontrol edilmiş gerçek durum

**G0.5 / commit 906968c için 22.10.2026 kontrolü:**
- **core-checks: başarı** — **211/211 Node testi** ve sanity/gizlilik kontrolü başarılı.
- **desktop-smoke: başarı** — gerçek Electron uygulaması **Windows** ve **Ubuntu/Linux (Xvfb)** üzerinde açıldı. \`/callout\`, basit başlık oluşturma, B biçimlendirme, biçimli run'a yazma, Undo/Redo, yerel save/open ve Görsel/Kaynak/Önizleme geçişleri smoke edildi.
- **Önemli:** Smoke metin girdileri kontrollü **sentetik beforeinput** ile oluşturuldu. Fiziksel klavye, çok çeşitli IME'ler, screenreader, performans veya paketlenmiş bağımsız EXE test edildi iddiası **yok**.
- Doğrulama: [core-checks #39694511002](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39694511002) ve [desktop-smoke #39694511005](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39694511005).
- \`package.json\` **v0.2.5**, sabit **Electron 44.9.3**. Başka editor/UI dependency bulunmuyor.

| Dilim | Gerçekten kodlanmış | Açık eksik |
|---|---|---|
| P0–P1 EFSS | Kendi Markdown parser/AST, schema, semboller, revision-check vault, yerel bağlam/model yardımcıları | AI özellikleri görsel editörle uçtan uca bitmiş değil |
| G0.1 Desktop | Electron local protocol, güvenli dar IPC, belge oluştur/listele/aç/kaydet, temel UI | Installer, export/import GUI, crash recovery yok |
| G0.2 Text | Own TextEditorSession, immutable transaction/delta Undo/Redo, grapheme güvenliği, native input bridge | Çok blok doğal selection/IME tam değil |
| G0.3 Blocks | Kaynağı koruyan block projection, oturum içi ID, unknown extension read-only kart, DevTools kapatma | Kalıcı block ID, hızlı incremental parser yok |
| G0.4 Flow | Görsel/Kaynak/Önizleme ortak text session; tek satırlı paragraf/başlık/liste/quote, basit callout; slash ve Ekle | İç içe/çok satır Flow, tablo yok |
| **G0.5 Inline (son)** | Görsel B/I/S, source↔visible offset, mark ekle/çıkar, styled run'a yazma, shared Undo/Redo | Karışık mark seçimleri, bloklar arası doğal Enter/Backspace, ileri typography yok |

**Mevcut UI = erken görsel Flow prototipi.** Karmaşık EFSS/Markdown yapıları desteklenmiyorsa veri kaybını önlemek için Kaynak görünümüne yönlendirilir. Tam Word/Illustrator editörü, tablo, artboard ya da PDF aracı **henüz hazır değil**. Tarihsel plan belgelerinde güncel gerçekle çelişebilecek eski “UI henüz yok” ifadeleri bulunabilir; **son code HEAD + bu devir + çalışan CI** önceliklidir.

## 3. Mimari bağlantılar / dosya sorumlulukları

~~~text
desktop/ui/app.js + index.html + styles.css
  │  Görsel Flow / Kaynak / Önizleme / insert & style / autosave
  ├─ src/editor-flow-adapter.js     [DOM visible caret, Flow events, inline rendering]
  ├─ src/editor-input-adapter.js    [native source input/IME]
  │
  ▼
src/editor-text-engine.js          [tek TextEditorSession, typed offsets, undo/redo]
  ↕
src/editor-inline-format.js        [visible↔source ranges, B/I/S plan]
  ↕
src/editor-flow-model.js           [blocks/callout görünümü]
  ↕
src/editor-block-model.js          [lossless projection, temporary stable IDs]
  ↕
src/ast.js + src/efss-markdown.js  [own EFSS grammar & serializer]
  │
src/editor-draft.js                [dirty/version/autosave state]
  ▼
desktop/preload.cjs                [dar, sabit 4 IPC eylemi]
  ▼
desktop/main.js                    [sandbox, navigation/permissions, menu policy]
  ▼
src/desktop-document-service.js    [strict validation, revision compare-and-swap]
  ▼
src/local-document-vault.js        [yerel veri: Electron userData/vault]
~~~

**Mevcut dört renderer→main komutu:** \`listDocuments\`, \`openDocument\`, \`createDocument\`, \`saveDraft\`. Her yeni yetki explicit capability, doğrulama, IPC testleri ve güvenlik incelemesi gerektirir.

**Depo ayrımı:** CLI \`.efss/vault\` ile Electron \`app.getPath("userData")/vault\` aynı dizin değildir. Otomatik migration yapılmıyor. Autosave gecikmeli ve version-aware olsa da process force-kill karşısında **durable crash journal henüz yok**.

## 4. Roadmap — önce metin doğruluğu, sonra tablo, sonra artboard

### G0.6 — AKTİF: G0.6B doğal blok akışı; G0.6A karma işaret kenarları açık

**G0.6A · Selection / Inline doğruluğu (ilk sprint)**
- Çok parçalı formatted text (plain + strong + em + strike), ileri/ters selection, clipboard, mouse, Ctrl+B/I/S ve kaynak marker sınırlarında **Unicode güvenli kaynak↔görünür offset eşleme**.
- Bir seçimin farklı biçimli run'ları kapsaması hâlinde ya kayıpsız tek transaction ile split/merge/format ya da net **fail-closed**. Görünmeyen \`**\` işaretlerini tesadüfen silme. Inverse işlem kaynağı ve seçimi geri getirsin.
- Dış editör kullanmadan kendi \`src/editor-inline-format.js\` ve \`src/editor-flow-adapter.js\` modüllerini geliştir. Basit stabil model kur; yeni bir ikinci belge kaynağı icat etme.
- Bütün Flow DOM'unu her tuşta değiştirmek caret/perf riski; testli hedefli güncelleme/invalidation tasarla.

**G0.6B · Çok satır, Enter / Backspace / Delete**
- Tek satırlı prototipten gerçek paragraf düzenine geç; Enter yeni blok, gerektiğinde \`Shift+Enter\` satır kırımı; türüne göre list/quote/callout politikası.
- Blok başında Backspace / sonunda Delete ile komşu blokların birleştirilmesi veya bilinçli reddi; ok tuşları ve çapraz blok seçimi.
- Çok satırlı kaynak roundtrip, IME composition, Türkçe (İ/ı/ğ), emoji/ZWJ, CRLF, undo/redo, paste/cut.

**G0.6C · Kabul kapısı**
- Node adversarial/property-like Unicode tests + gerçeğe yakın DOM/native input tests.
- Windows ve Ubuntu Electron smoke: çok blokta yaz, seç, biçimlendir, geri al, Kaynak'a geç, kaydet, kapat, aç, aynı içerik/mark. Physical keyboard/IME **ayrı** sonuç olarak not edilmeli.
- Herhangi bir byte kaybı veya kısa yoldan düz metne indirgeme varsa milestone tamam sayılmaz.

**G0.6 bitti denebilmesi için:** Kullanıcı normal bir notu birkaç paragrafta doğal biçimde yazıp karışık stil aralıklarını düzenleyebilmeli; Undo/Redo ve tekrar açma sonrasında hem düz metin hem biçim **aynı** kalmalı.

### G0.7 — Gerçek tablolar ve zengin bloklar

- \`/table\`, \`+\` ve inspector tek command'a bağlanacak; **3×3 gerçek tablo**, hücrede yazma, Tab/Shift+Tab, satır/sütun ekle-sil, hücre selection, undo/redo.
- Basit tablolarda GFM pipe-table; birleşik hücre/nested içerikte versioned EFSS extension, **source roundtrip testi olmadan yok**.
- Callout type/icon/title değiştirme, çok satırlı/nested içerik. Unicode emoji ve kullanıcının dağıtım izni olan ikonlar; checklist, safe link, code, divider gibi ek yapılar.
- Blok taşıma, duplicate, slash menü UX, sağ tık: ortak transaction disiplini.

### G0.8 — Artboard / Layout / TextFrame motoru

- **Tek belge / content tree + layout tree**; **kalıcı page/frame/block IDs**, parent-relative coordinates, reading order ve z-order. Önce sürümlü EFSS extension/persistence spike.
- Multi-page artboard; **preset** (ölçü/birim) ve **template** (yerleşim/içerik) farklı kavram. Örnek: Web 1440×900, Desktop 1920×1080, Mobile 390×844, Social 1080×1920/1350/1080, A4 210×297 mm, US Letter 8.5×11 in, custom.
- Flow/Row/Column/Grid: intrinsic measurement → constraint solver → placement → collision/overflow diagnostic. Yan yana/alt alta metin kutuları **izinsiz taşmaz/üst üste binmez**.
- Serbest/free overlay yalnız *bilerek* çakışma. Snapping, exact X/Y/W/H, gap/padding, min/max, align/distribute, nested frames/grouping.
- Preset değişiminde açık **resize page / scale content / reflow** niyeti. Zoom sadece görünümü değiştirir. TextFrame'in geometry'si vektörel; metin Unicode ve editlenebilir kalır.

### G0.9 — Inspector, tipografi ve yerel ürün sağlamlığı

- Bağlamsal/pinlenebilir sağ Inspector: font family/weight/size, line-height, tracking, kerning, supported OpenType, paragraph align, TextFrame bounds, position ve constraints; olmayan font özelliklerini sahte seçenek olarak gösterme.
- Kalıcı recovery/journal, user-visible import/export/backups, asset manifest/checksums, crash testleri, perf profiling.
- Font/ikon dağıtım lisansları; imzalı installer/otomatik güncelleme **ayrı**, sonradan.

### G1+ — Bilinçli biçimde ertelenecek

PDF/Print-to-PDF, PNG/WebP raster export ve DPI/kalite/sıkıştırma, text-to-outlines, ileri baskı/ICC/bleed, cloud/collaboration ve gelişmiş AI entegrasyonları. **PDF sayfa geometrisi tek bir DPI kavramına indirgenmez**; raster çözünürlük ile fiziksel sayfa ayrıdır. Bunlar metin, tablo ve artboard doğruluğundan önce iş kapsamına alınmaz.

## 5. Somut sıradaki değer teslimleri

**G0.7B ilk kesit doğrulandı (`d452657`):** Checklist ekle → metnini görsel yaz → işaretle/işareti kaldır → Enter ile yeni boş görev → Undo/Redo → gerçek yerel kasada kaydet/aç. Tabloda *yalnız son veri satırını* Inspector ile silme, güvenli minimum bir veri satırı sınırı. **299/299 Node + Windows/Linux Electron smoke yeşil.**

1. **Şimdi ilk yerel LLM masaüstü bağlantısı (AI-0.1) en yakın öncelik.** `src/model-provider.js`'de `OpenAICompatibleProvider` var. Electron main-preload IPC yalnız **127.0.0.1 / loopback** için sınırlı ve açık kullanıcı tetiklemesiyle `/v1/models` durum/isimlerini listelemeli. Aşağıdaki kabul kapıları: trusted frame whitelist, `redirect:"error"`, timeout, response limit, ağ/gizlilik hatalarını kaynaksız söylememe, fake response ile Node ve gerçek GUI smoke. **Gerçek LM Studio inference'i kullanıcı ortamında bağlanmadan gerçekleşti diye sunma.** Sohbet ve kullanıcının belgeye açık onayla aktarımı sonraki ayrı dilimdir. ComfyUI model taramasını otomatik başlatma.
2. **G0.7B devam:** Mevcut `planTableDeleteLastRow` yeterli değil; bilinçli seçili satırı silme, sütun ekle/sil, hücre paste-grid/selection, daha geniş tablo Inspector semantiği, checklist'in richer marker/caret edge vakaları. Her özellik tek EFSS source ve Undo/Redo üzerinden.
3. **G0.6C güvenilirlik:** Fiziksel IME, trailing Shift+Enter, çoklu seçim, rich multiline, clipboard, kaydet/aç. Gündelik yazmayı Kaynak sekmesine gönderen kusurları izole edip onar.
4. **Sonra G0.8 artboard; geniş G0.9 Inspector; G1+ ComfyUI ve gelişmiş AI.** Kalıcı schema olmadan X/Y/W/H veya font dosyası uydurma.

**Kısıtlar:** Sadece `saygiylasunar/efss.bellekpad` **main**. Yeni branch yok. Dış kütüphane/editor bağlama veya kullanıcı model klasörlerini izinsiz tarama yok. Her kabulde Node, Windows/Linux Electron, kaynak roundtrip, unknown EFSS ve Undo/Redo.

## 6. Kanonik kod/test dosya haritası

| Dosya | Rol |
|---|---|
| \`src/editor-text-engine.js\` | Tek TextEditorSession, caret offsets, transaction, undo/redo |
| \`src/editor-inline-format.js\` | Inline marks ve source↔visible positions (**G0.6A**) |
| \`src/editor-flow-adapter.js\` | Flow native DOM selection/input, styled runs (**G0.6A**) |
| \`src/editor-flow-model.js\` | Flow projections, callout/slash |
| \`src/editor-input-adapter.js\` | Kaynak görünümü native input/IME |
| \`src/editor-block-model.js\` | Lossless raw source, session IDs |
| \`src/ast.js\`, \`src/efss-markdown.js\` | Kendi EFSS parser + serializer |
| \`src/editor-draft.js\`, \`src/local-document-vault.js\` | Autosave/version ve local persistence |
| \`desktop/ui/\` | Gerçek Electron arayüzü |
| \`desktop/preload.cjs\`, \`desktop/main.js\`, \`desktop/security.js\` | IPC, sandbox, özel protokol, DevTools policy |
| \`test/editor-text-engine.test.js\`, \`test/editor-inline-format.test.js\` | Unicode, selection, Undo/Redo regresyonları |
| \`test/editor-flow-model.test.js\`, \`test/desktop-ui-contract.test.js\` | Flow/markup/UI sözleşmesi |
| \`desktop/smoke.mjs\` + \`.github/workflows/desktop-smoke.yml\` | Windows + Ubuntu gerçek Electron smoke |
| \`docs/ARTBOARD_LAYOUT_SPEC.md\` | G0.8 bağlayıcı yerleşim/preset tasarımı |
| \`docs/EDITOR_ENGINE.md\`, \`docs/EDITOR_BLUEPRINT.md\` | Geniş mimari/product niyet; bazı durum satırları tarihi |
| \`docs/RIGHTS_AND_DISTRIBUTION.md\`, \`LICENSE\` | Telif/haklar |
| \`docs/STATUS.md\`, \`docs/EDITOR_G0_2.md\` ... \`G0_5.md\` | Kronolojik teknik kayıtlar |

## 7. Dev ortamı / kontrol komutları

~~~powershell
git clone https://github.com/saygiylasunar/efss.bellekpad.git
cd efss.bellekpad
git pull origin main
npm install
npm run desktop
npm run sanity
npm run check
npm test
npm run desktop:smoke
~~~

Node minimum 20, CI Node 22 — geliştirmede Node 22 uygun. \`npm run desktop:smoke\` gerçek masaüstü oturumu veya CI sanal ekranı gerektirir. İlk Electron dependency indirmesi internet ister; notların yerel düzenlenmesi buluta bağlı olmamalı.

**Her turun kapanış standardı:** gerçek HEAD → hangi kod eklendi/değişti → source/EFSS roundtrip → Node testleri + privacy → Windows/Linux Electron smoke → sınırlamalar/IME → commit SHA → bir sonraki dar iş. Kullanıcıya manuel tekrarlar yıkma; CI'yla yapılabilecekleri otomatikleştir.

## 8. Önemli teknik borç / riskler

- Source ve görünen metnin offset'leri farklı; nested \`<strong>/<em>\` DOM text node'ları ve ters selection hassas.
- G0.6A karma B/I/S işlemleri parser-oracle ile sınırlı; bazı `***` komşu marker vakaları fail-closed. Tam çok bloklu Word alternatifi gibi tanıtma.
- Flow her değişimde yeniden projekte/render ediliyor; caret ve uzun belge performansına dikkat.
- Blok kimlikleri oturum içinde stabil; **dosya aç-kapat sonrası kalıcı node ID henüz yok**.
- IME/noncancelable input ve fiziksel klavye, sentetik GUI smoke ile doğrulanmış sayılmaz.
- Crash/force-kill autosave tamamlanmadan veri kaybettirebilir; durable local journal gerekli.
- CLI \`.efss/vault\` ve masaüstü \`userData/vault\` farklı, migration yok.
- DevTools gizliliği DRM değildir. Original rights notice bir telif bildirimi; mutlak teknik engelleme değildir.
- **Henüz yok:** tam görsel tablolar, çok satırlı/nested callout, çoklu artboard, inspector, vector text outlines, PDF/DPI/compression, imzalı installer.

## 9. Yeni sohbet devri

> “BellekPad'i `saygiylasunar/efss.bellekpad` / `main` üzerinden geliştir. `docs/PRODUCT_DIRECTION.md`, `docs/DEV_HANDOFF.md` ve güncel HEAD/CI'yi oku. **G0.7B kısmi** `d452657`: tıklanabilir Markdown checklist, Enter, Undo/Redo, gerçek kasa kaydet/aç; tabloda Inspector'dan yalnız **son veri satırını** atomik silme; **299/299 test ve gerçek Windows/Linux Electron yeşil**. Şimdi **dar güvenli yerel LLM modellerini listeleme IPC + UI kesitine** geç; asla internet endpoint'i veya kullanıcı dosyası taramayı varsayılan etkinleştirme. Tam sohbet/inference/ComfyUI'ı doğrulanmadan tamamlandı diye ilan etme. Sonra kalan tablo/IME/artboard görevlerini ilerlet. Yeni branch/repo/harici editör açma.”

**Nihai ürün ve kullanım kararları kullanıcıda.**
