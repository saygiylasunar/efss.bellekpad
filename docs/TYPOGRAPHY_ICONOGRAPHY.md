# BellekPad — Tipografi / İkonografi Entegrasyonu

**Durum:** UI görünümü için v0.2.7 geliştirme kesiti. **Desktop = offline-first**, fonts are NOT bundled. The provided Adobe web-project CSS is recorded and provided only for **an actual web page**, not loaded by the Electron window.

## Kabul edilmiş yön

- Başlıca görsel kimlik: **All Round Gothic** (rounded UI), **Noka** (display/brand headings), **Exo** (technical and editor reading). These are *preferred families*, not a claim about what the current Adobe Web Project publishes.
- Türkçe karakter gereksinimi: **Ö Ç Ş Ğ Ü İ ı ö ç ş ğ ü**. Never claim a given font supports these without checking its actual font file/Adobe glyph coverage; CSS fallback applies if a glyph is absent.
- Önceki daha geniş font adayları (ileride ihtiyaç ve hak denetimi ile): New Order, Chakra Petch, Quicksand, Courier Prime, Gluten Variable, Indie Flower, vb. **Hepsini otomatik pakete eklemedik**; font menu/hangi ailelerin belge tipografisinde kullanılacağı G0.9 kapsamı.
- İkonlar için dış paket yerine **src/ui-icons.js** içindeki özgün, aynı 24×24 SVG koordinat sisteminde çizilen stroke ikonları. CSS theme tokens \`--icon-size\`, \`--font-ui\`, \`--font-display\`, \`--font-technical\`, \`--font-document\`; ayrı güvenli erişilebilirlik testleri.
- Belgelerin gerçek görsel içeriğine SVG/ikon ekleme henüz G0.7 komutu değildir. Şu anda ikonografi arayüz düğmelerinde, belge gezgininde ve callout başlıklarında kullanılır; EFSS dosya içeriğini ve callout meta içindeki Unicode icon değerini değiştirmez.

## Adobe Fonts web project — yalnız web yayını

Kullanıcının sunduğu embed kodu:

\`\`\`html
<link rel="stylesheet" href="https://use.typekit.net/aww8lcp.css">
\`\`\`

Gerçek **web sayfası** örneği: \`examples/adobe-fonts-web.html\`. Web proje CDN'den çağrılır; yalnız ağ erişiminde ve ilgili Creative Cloud web projesi aktifken çalışır. İleri web ürününe geçildiğinde bu embed, **o web sayfasının kendi head bölümüne** (verilen orijinal haliyle, kopyalanıp yerel CSS'e birleştirilmeden) eklenebilir.

**ÖNEMLİ:** Web kit CSS'ini erişilebilir kaynakla doğrulayamadık; hangi font family/weight/font-feature'ların \`aww8lcp\` içinde bulunduğunu iddia etmiyoruz. \`"all-round-gothic"\`, \`"noka"\`, \`"exo"\` fallback alias'ları kit ile eşleşene kadar yalnızca **aday isimdir**. Adobe Fonts web proje API/CSS içinden CSS font family değerleri ve Türkiye dil kapsamı doğrulanmalı.

## Neden Electron head'ine bu link eklenmedi?

1. **Yerel not editörü ağ gerektirmeden çalışmalı.** Mevcut Electron CSP \`default-src 'none'; style-src 'self'; font-src 'self'; connect-src 'none'\` ile kasten internet fontlarının hiçbirini yüklemez. Bunu yalnız kozmetik değişiklik için gevşetmiyoruz.
2. **Adobe web font lisansı**, web fontu indirme, kopyalama, self-host, Electron paketine font dosyası ekleme izni vermez. Adobe, web fonts'un bir webview'da çalışabileceğini söylese de, masaüstü uygulamasına font dosyası gömmek için ayrıca hak gerekir.
3. **Kullanıcıların kendi metin tasarımlarını font seçerek oluşturmasına imkân veren ürünler için** standart Adobe web fonts kullanım hakkı yeterli değil; Adobe doğrudan foundry/custom license gerektiğini açıklıyor. BellekPad bu kategoriye girebilir; bu web kitini belge font seçimi için kullanmıyoruz.
4. Masaüstü kabuğu, kullanıcı sisteminde zaten lisanslı kurulmuş/etkinleştirilmiş font ailelerini CSS font stack aracılığıyla kullanabilir; yoksa Türkçe destekli sistem fontları görüntülenir. Biz font dosyası dağıtmıyor, web lisansını desktop font seçimine dönüştürmüyoruz.
5. Adobe bağlantısını uygulamanın tamamında açmak \`use.typekit.net\`/font CDN görüntüleyip kullanıcı gizliliği ve CSP için yeni yetkiler açacaktı; bu kararı dolaylı biçimde almadık.

Kaynaklar:
- Adobe Fonts web font licensing: https://helpx.adobe.com/fonts/web/font-licensing/webfont-licensing.html
- Adobe Fonts embed codes: https://helpx.adobe.com/fonts/web/web-design-and-development/embed-codes.html
- Adobe Fonts kit font-name differences: https://fonts.adobe.com/docs/api/css_names
- Adobe Fonts about/limitations: https://fonts.adobe.com/about.html

## UI entegrasyon katmanları

\`\`\`text
desktop/ui/index.html (data-ui-icon)
  │
  ├── src/ui-icons.js
  │     ├── makeIcon(document,name) -> SVG DOM (no innerHTML, no fetching)
  │     └── decorateUI(document) -> toolbar/sidebar/buttons
  ├── desktop/ui/app.js -> document list icons (document/layers)
  ├── src/editor-flow-adapter.js -> variant-based callout header icons
  └── desktop/ui/styles.css
        ├── All Round Gothic/Noka/Exo fallbacks: CSS variables
        └── stable monochrome SVG scaling & contextual colors

src/editor-text-engine.js and EFSS Markdown persistence are unchanged.
\`\`\`

## Kalan işler

- Adobe kit font CSS family adları ve Türkçe glyph kapsamı gerçek web proje örneğinde doğrulanmalı; **şu an bu aşama yapılamadı**.
- Ürün UI için sadece aday font adları + fallback var; gerçek font dosyası lisansı / offline font paketi / güncel Web Project entegrasyonu tamamlanmış sayılmaz.
- Icon picker veya icon-as-document-object, Word/Illustrator typography inspector, font dropdown ve export özellikleri henüz yapılmadı.
- Kullanıcının onayladığı fontlar dışında yeni tasarım/font framework bağımlılıkları eklenmez.

## CI doğrulaması

UI tokenları ve SVG registry için `test/ui-icons.test.js` eklendi; mevcut masaüstü smoke içinde toolbar SVG, callout SVG ve yerel font değişkenleri denetlendi. **v0.2.7** üzerinde kontrol commit'i `5893692087648a29ecf7ef66e35d948f9117c587`: **223/223 Node testi**, sanity başarılı ve **Windows + Linux Electron smoke** başarılı. İlk desktop CI çalışmasında smoke betiğinin eski belgeyi liste sırasından seçmesi test hatasına yol açtı; yeni belge artık ID farkıyla seçiliyor. Bu çözüm canlı belge kaydetme koduna değil, test kimlik seçim mantığına uygulandı. Adobe Fonts CDN CSS erişimi ve gerçek font ailesi listesi ayrıca doğrulanmadı.
