# BellekPad — Ürün Yörüngesi ve Teslim Ölçütleri

Tarih: **27 Ekim 2026** · Kanonik repository: `saygiylasunar/efss.bellekpad` · Dal: `main`

Bu belge **uygulama kapsamını bağlamak** içindir, kullanıcı onayı olmadan özelliklerin son tasarımını kesinleştirmez. Güncel mühendislik ilerlemesi [DEV_HANDOFF](DEV_HANDOFF.md), bloklar [BLOCK_BEHAVIOR_SPEC](BLOCK_BEHAVIOR_SPEC.md).

## Ürün niyeti

BellekPad salt Markdown alanı değil: **yerel öncelikli, görsel olarak nesne düzenlenebilir, bağlantılı bilgi barındıran, ihtiyaç halinde yerel modellerle güçlendirilen kişisel çalışma ortamı**. Oyun arayüzlerindeki açıklık ve durum farkındalığı; Discord/Slack'in arayüz disiplini; Notion'un blokları; Word'ün doğal yazımı; Illustrator'un nesne özellikleri ve Canva'nın boyut/şablon yaklaşımı **ilhamdır, kopya değil**. Sakin, soft, teknik, Türkçe uyumlu, yoğun ama boğmayan bir tasarım.

## Sıfır tavizler

- **Yazmak esastır:** Enter/Tab/Shift+Enter ve karakter seçimi gündelik kullanımda kullanıcıyı sürekli kaynak editörüne sürüklemeyecek. Destek dışı durum net ve kayıpsız reddedilir; içerik gizlice düzleştirilmez.
- **Her blok davranışlı nesne:** tür/özellik, içerik, klavye, görünüm, Inspector ve veri saklama semantiği ayrı tanımlanır.
- **Tek yetkili belge:** EFSS Markdown + sürümlü gelişmiş metadata, source roundtrip ve atomik Undo/Redo. DOM ikinci belge deposu değildir.
- **Kullanıcı kontrolü:** Model önerisi belgeyi otomatik değiştirmez; dosya/görsel/model dizinleri izinsiz taranmaz veya buluta gönderilmez. Belirlenmemiş yerel yollar koda gömülmez.
- **Özgün editör ve güvenli host:** Üçüncü taraf rich editor framework'ü yok; Electron sandbox + allowlist IPC. DevTools/UI chrome gizliliği tam bir tersine mühendislik koruması olarak vaat edilmez.
- **Somut ürün:** Test sayısı bir araçtır; tamamlanan özellik, normal UI'dan elle uygulanabilir, kaydedilir, Undo/Redo ile döner ve gerçek Electron testinden geçer.

## Çalışan görünür dilim / 25.10.2026

| Kullanıcı eylemi | Gerçek uygulama | Limit |
| --- | --- | --- |
| Görsel olarak yazma ve biçim | B/I/S, heading, liste, quote, temel callout, inline rich işaretler | Karma çok satır ve IME kabulü eksik |
| Enter/Backspace/Shift+Enter | Temel liste devamı, basit paragraflar, sınırlı Shift+Enter, bazı blok sınırları | Çok bloklu seçim ve trailing softline eksik |
| **Seçili blok Özellikleri** | H1–H6, madde işareti, callout varyantı ve **tablo satır sayısı + satır ekleme** | Font ölçüleri, tablo sütunları/konum/renk yok |
| Yerel not saklama | Electron kasası, revision kontrol ve kaynak görünümü | Kurtarma/taşınabilir yedek son ürün değil |
| Modeller için çekirdek | OpenAI-compatible ve ComfyUI provider, dosya envanteri | Masaüstü seçim, sohbet, runtime IPC/inference kanıtı yok |
| Artboard / tablo / checklist | **G0.7B kısmi:** düzenlenebilir tablo, satır ekle/son satırı sil ve tıklanabilir görev checkbox'ları; artboard hâlâ tasarım | Serbest sayfa, sütun ve çoklu hücre seçimleri yok |

### Kabul edilen kod

`7ff3c39382d65d605efa1a4f53ff295dfd9d21a8` — 291/291 Node, Windows + Linux Electron smoke ve tablo kasa save/reopen başarılı. Önceki Inspector kodu: `fbb0ab4`. [Core](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/40196926785) / [Desktop](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/40196926766).

## Bundan sonra sırayı belirleyen şey: kullanıcıya çalışan yetenek

**1 · Editör güvenilirliği — G0.6C (dar mühendislik kapısı).** Fiziksel klavye/IME, uzun paragraflar, trailing Shift+Enter, çoklu seçim, clipboard, kaynak/Flow roundtrip, kaydet aç. Her seferinde tek kritik hata grubunu bitir, kapsamı gereksiz genişletme.

**2 · Zengin nesneler — G0.7.** **G0.7A doğrulandı:** 3×3 kaynak tablosu ekleme, hücreye yazma/silme, Tab/Shift+Tab, satır ekleme, Undo/Redo ve yerel kasa kaydet-aç. **G0.7B ilk kesit tamamlandı:** görsel checkbox kontrolü, tamamlanmış görevden Enter ile yeni boş görev, Undo/Redo/kasa kaydet-aç ve Inspector'dan **yalnız son tablo veri satırını silme**. **Kalanlar:** seçili herhangi satır, sütun ekleme/silme, çoklu hücre seçimi, spreadsheet clipboard, gelişmiş Inspector ve fiziksel IME. Güvenli GFM sınırları korunacak.

**3 · Yerel model / AI-0.1 başladı.** Sabit `127.0.0.1:1234`, whitelist main IPC, kullanıcı isteğiyle sunucu durumunu ve model listesini gösterme **çalışıyor; fake local HTTP+real Electron GUI doğrulandı**. **AI-0.2** sıradaki gerçek kullanıcı işlemi: açıkça başlatılan, seçili modelle sohbet/inference ve iptal/hata; kullanıcının belgesi asla otomatik gönderilmez. Gerçek LM Studio model çalıştırma hâlâ test edilmedi. ComfyUI ayrı AI dikeyidir.

**4 · Artboard / Layout — G0.8.** Sayfa boyutu, TextFrame, vektör ölçüler, snap, grid/row/column, overflow işareti, özgür çakışmada açık niyet ve kalıcı EFSS layout schema.

**5 · Geniş Inspector ve dağıtım — G0.9.** Font boyut/ağırlık/line-height, geometri X/Y/W/H, nesne hizası, layer/asset, kurtarma, import/export; lisanslı font yoksa sahte dropdown yok.

**6 · İleri AI/medya/çıktı — G1+.** ComfyUI görsel stüdyo, bağlamsal RAG, model değerlendirmesi, yüksek kalite PDF/vector/raster dışa aktarma. Temel LLM bağlantısını G1+'a kadar zorunlu bekletme.

## Teslim tanımı

Bir özellik **hazır** yalnız şu koşullarda denebilir: (1) uygulama içinden erişilir, (2) kaynakta veya sürümlü varlıkta saklanır, (3) Undo/Redo varsa doğrulanır, (4) Windows ve Linux gerçek Electron smoke yeşildir, (5) sınırlamalar açıkça yazılmıştır. Pazar/ürün nihai yönü ve tasarım kararlarında son onay kullanıcıya aittir.
