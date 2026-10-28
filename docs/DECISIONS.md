# BellekPad — Kanonik Karar Defteri (R0–R7)

**Son doğrulama:** 28.10.2026 · **Kaynak depo:** `saygiylasunar/efss.bellekpad` · **Aktif çalışma dalı:** `rebuild/web-ai-core`

> Bu dosya **ürün kararlarının kalıcı kaydıdır**. Son kod durumu ve açık mühendislik işleri için `REBUILD_HANDOFF.md`; doğrulama koşulları için `ACCEPTANCE.md`. Geçmiş tartışmalarda geçen geçici seçenekleri "karar" gibi uygulamayın. Kullanıcı tarafından kilitlenmiş işlevleri onaysız kaldırmayın.

## Durum sözlüğü

- **KİLİTLİ:** Kabul edilmiş kullanıcı/ürün gereksinimi ya da seçilmiş teknoloji. Uygulamada korunacak.
- **SÖZLEŞME:** Mühendislik yaklaşımı kabul edildi; uygulamanın uçtan uca tamamlandığı anlamına gelmez.
- **AÇIK:** Teknik uygulama/uyumluluk detayları araştırılacak; ürün amacı açık değildir demek değildir.
- **ERTELENDİ:** Kapsamdan çıkarılmadı; AI-öncelikli sürümün ön koşulu değil.

## A. Ürün sınırları — KİLİTLİ

**Web-first, AI-first, local-first.** Tarayıcı kullanıcı arayüzüdür; yerel Python/backend motorları, model ve disklere erişimi sağlar. Desktop/Electron ve mobil ilk teslimin zorunlusu değildir. Çalışma yüzeyleri: Chat, Image Studio (Generate), Workflow Studio, Models, Notes, Projects. İleri Word/Illustrator tipi artboard ve nesne geometrisi şimdilik **ERTELENDİ**; ileride aynı semantik metin çekirdeğini kullanabilmeli.

**Görsel etkileşim:** ChatGPT + LM Studio gibi geniş sohbet alanı, sol gezinme/proje geçmişi, altta mesaj yazma, bağlamsal ve tercihen kapanabilir Inspector. Forge benzeri "Generate" ile Comfy benzeri "Workflow" **ayrı modlar**. Çalışma yüzeyleri aynı ürünün parçasıdır ama araç çubuklarını gereksiz paylaşmak zorunda değildir.

**Tasarım prensibi:** Kullanıcı dostu, ölçülü ve şık; fakat backend'de desteklenmeyen bir özelliği sunmaz. UI, backend'in otoritesini taklit etmez; frontend kontrolünün devre dışı olması backend doğrulamasının yerine geçmez.

## B. Seçilmiş teknolojiler — KİLİTLİ

| Katman | Karar | Sınır |
|---|---|---|
| Web frontend | **React + TypeScript + Vite** | Özgün BellekPad arayüzü |
| Text/Notes | **Tiptap + ProseMirror** | EFSS'yi Tiptap'ın standart Markdown serializer'ına teslim etme |
| Workflow canvas | **React Flow** | Görselleştirme/bağlantı; inference ve geçerlilik backend'dedir |
| Backend | **Python + FastAPI + Pydantic** | Core-first; servis sözleşmeleri tipli/doğrulanmış |
| Görsel iş motoru (başlangıç) | **BellekPad'in yönettiği ComfyUI backend süreci** | ComfyUI web UI açma zorunluluğu yok; farklı motor adapter'ları mümkün |
| Veri tabanı (başlangıç) | **SQLite + EFSS kaynakları + dosya varlıkları** | Kullanıcı tarafından seçilen kalıcı kök dizin |
| GGUF/multimodal | Yönetilen `llama.cpp` / Transformers worker yolu | Python venv inference motoru **değil**, ortam izolasyonudur; nihai worker/paketleme hâlen AÇIK |

**Bağımlılık standardı:** Yaygın, iyi belgeli, lisansı uyumlu, uzun ömürlü/olgun kütüphane; işlevi uyumsuz küçük editör/framework ekleme. Özel bir doğrulama gereği olmadan overlapping UI/rich-editor/state kütüphaneleri çoğaltma. GrapesJS zengin metin çekirdeği olarak seçilmeyecek.

## C. Üç cisim problemi — KİLİTLİ

1. **Parallel:** Aynı kullanıcı istemine bağımsız birden fazla model yanıtı.
2. **Roundtable:** Sınırlandırılmış tur sayısıyla modellerin birbirinin yanıtlarını görüp konuşması.
3. **Orchestrated:** Rol/görev/sıradaki konuşmacı/bitiş politikasını belirleyen yöneticili görüşme. Yönetici ayrı bir LLM olmak zorunda değil.

Aynı konuşmada model değiştirme, geçmiş, alternatif yanıt dalları, durdurma/iptal ve tur sınırı temel gereksinimlerdir. Çoklu konuşmacı **eşzamanlı VRAM yükleme zorunluluğu** değildir. Şema, token streaming ve model-adapter protokolü R3 sözleşmesi olarak geliştirilecek.

## D. Modeller, dizinler ve kullanıcı özgürlüğü — KİLİTLİ

- Modeller kullanıcının belirlediği farklı sürücü/klasörlerde kalır; BellekPad kendi klasörüne taşımayı/kopyalamayı şart koşmaz. **Yalnız izin verilen dizinleri tara.**
- GGUF ve Safetensors birincil ağırlık biçimleri; tokenizer, JSON, encoder, VAE, mmproj, LoRA vb. ilişkili bileşenler desteklenir. Uzantı tek başına mimariyi kanıtlamaz.
- Model Registry; tür, aile, konum, yardımcı varlıklar ve runtime profilini ayrı izler.
- Kullanıcının seçtiği modelin kapasitesinden kullanıcı sorumludur: **keyfî RAM/VRAM/quantization yasakları ve gereksiz öğütler yok.** Yazılımın sorumluluğu başlat/durdur, gerçek hata raporu, cleanup ve veri güvenliğidir. Kaynak izlemesi isteğe bağlı bilgi olabilir.
- Model yanıtlarına BellekPad tarafından zorunlu genel ahlaki/NSFW yeniden yazma filtresi eklenmez. Bu, dosya/işlem/yerel servis güvenliğinin devreden çıkarılması anlamına gelmez.

## E. Görsel AI ve workflow — KİLİTLİ

Bir üretimde birincil diffusion model; model ailesine göre bütünleşik **veya ayrı** CLIP(ler)/text encoder/VAE. Çoklu LoRA (ağırlıklarıyla), conditioning, reference image, denoise, scheduler, sampler, CFG/guidance, steps, seed ve boyutlar workflow'un desteklediği ölçüde ayrı yönetilebilir.

**Workflow preset ≠ çalışma anındaki parametreler ≠ tamamlanmış iş kaydı.** Önceden hazırlanmış grafiği her seferinde yeniden kurma. "Generate" kolay formu ile React Flow grafik editörü iki ayrı yüzeydir. Sohbetteki görsel üretme isteği yapılandırılmış/validasyonlu bir job'a dönüştürülür; desteklenmeyen parametre sessizce uygulanmış gibi gösterilmez.

**Comfy mimarisi:** Kendi UI'ımız → BellekPad API → graph validator → Comfy adapter → yönetilen Comfy Python süreci → PyTorch/CUDA. Kullanıcı ayrıca ComfyUI açmaz. İsterse mevcut kurulum/harici çalışan Comfy'ye erişim opsiyonel olabilir. Worker sürümleri, özel node uyumluluğu, progress, output artifacts, cancellation ve kurulum dağıtımı **AÇIK mühendislik işleri**. Comfy GPL koşulları kapalı kaynak BellekPad'in dağıtımından önce ayrıca ele alınır.

## F. EFSS Markdown / Tiptap — KİLİTLİ

EFSS Markdown canlı bir kaynak dili olarak **güçlendirilecek**: değişken/constant, özel bloklar, tablolar, callout, emoji, kod, source roundtrip ve gelecekte layout metadata. Tiptap, görsel düzenlemede ProseMirror altyapısını sağlar; **EFSS'nin kanonik kaynağı ayrı ve sürümlüdür**.

Tanımadığı yapıları atma, biçimlerini normalleştirip kaybetme veya görsel başarı iddiasıyla üzerine yazma yasaktır. Desteklenmeyen kaynak segmentleri opaque, görülebilir ve düzenleme açısından korumalı kalır. Gerçek rich node/mark eşlemeleri ve Unicode/IME/roundtrip kanıtları tamamlanmadan tam WYSIWYG ilan edilmez. Artboard editörü ayrı kapsamdır.

## G. Kullanıcı verisi, güvenlik ve yedekleme — KİLİTLİ

Kalıcı çalışma klasörü kullanıcı tarafından seçilir; otomatik Roaming/Temp gömüsü yok. Sohbet, not, workflow, proje ve varlıkları taşınabilir/yedeklenebilir olarak tasarla. SQLite online backup, diskteki tüm asset/model/ek dosyalarını kapsamaz: çok dosyalı export için manifest/snapshot bütünlüğü gerekir. Not revizyonları, workflow revizyonları ve yeniden açma davranışı açıkça tanımlanır.

Yerel web sunucusu yalnız loopback bağlamında, browser API'sinde origin/host/oturum koruması ve süreç komutu injection önlemleriyle çalışır. Kullanıcıdan gelen node/graph, python kodu ve yürütülebilir dosya komutu gibi işlenmez. Harici dizin/model/data ve belge bağlamına erişim kullanıcı kararıyla sınırlandırılır.

## H. CORE → API → UI bütünlük protokolü — KİLİTLİ

**Plan → kabul edilmiş sözleşme → Core algoritması → Backend servis → API/data contract → frontend etkileşimi → test/kabul**. UI'daki her eylem backend'deki gerçek ve tipli durum/izin kümesine karşılık gelmeli. Bir modül, yalnız derleniyor veya mock testinden geçiyor diye tamamlandı sayılmaz. İş kuralları backend otoritesindedir; frontend backend'i korumasız bırakamaz.

Her modül: iş tanımı, girdi/çıktı, veri ve durum makinesi, eşzamanlılık, zaman aşımı/iptal/tekrar, hata kodları, yedekleme/kurtarma, güvenlik sınırları ve Core→API→UI kabul testleriyle ele alınır. **Hatasızlık mutlak garanti değildir:** hatayı sistematik azaltan doğrulanmış sözleşmeler zorunludur.

## I. R0–R7 — çalışma yörüngesi

| Paket | Kapsam |
|---|---|
| **R0** | Eski depoyu ayır, kararları koru, mimari sınırları ve test kapılarını oluştur |
| **R1** | Web Application Shell; ortak gezinme ve gerçekten çalışan yüzeyler |
| **R2** | Backend / yönetilen runtime supervisor / model kayıt ve worker protokolü |
| **R3** | Chat engine, kalıcı çoklu sohbet ve Parallel/Roundtable/Orchestrated |
| **R4** | Image Studio, Comfy adaptörü, preset/workflow, generation job, galeri |
| **R5** | EFSS + Tiptap Notes; kayıpsız semantik belge modeli |
| **R6** | Chat→image, belge bağlamı, projeler ve iş akışları arası izinli entegrasyon |
| **R7** | Kurtarma, yedek, gerçek Windows/GPU/UI kabulü, dağıtım, lisans |

**R0 mevcut durum (bu defter yazılırken):** `rebuild/web-ai-core` dalında eski Electron kaynak ağacı temizlendi, Python backend + React Flow + Tiptap ilk kesitleri ve CI var. Tam model inference/Comfy gerçek donanım kabulü **yok**. Yeni planın kodları üzerinde çalışılabilir, fakat yayın/beta iddiası yok. `main` eski referans olarak korunuyor. Önceki `feat/g0-6a-rich-selection` ve PR #1 bu dala otomatik merge edilmeyecek.

## J. Karar değişikliği prosedürü

Yeni karar bu dosyanın ilgili başlığını güncelleyip aşağıdaki günlüğe **tarih + gerekçe + etkilenen modül** ile yazılacak. Ürün niyetindeki değişiklikler kullanıcı onayı olmadan kilitlenmeyecek. Uygulama ilerleme kayıtları `REBUILD_HANDOFF.md` / `ACCEPTANCE.md` dosyalarında tutulacak.

### Değişiklik günlüğü
- **28.10.2026:** Web-first/AI-first; React, Tiptap/ProseMirror ve React Flow; üç çoklu sohbet politikası; yönettiğimiz Comfy engine; kullanıcı tanımlı veri/model dizinleri; CORE→API→UI kuralı **kilitlendi**.
- **28.10.2026:** `rebuild/web-ai-core` temiz kaynak dalı açıldı; `main` korunacak; ilk Comfy/EFSS/SQLite sözleşmeleri testli temele dönüştürüldü.
- **28.10.2026:** Bu karar defteri repoya kanonik `docs/DECISIONS.md` olarak kaydedildi; Workflow Studio için motor kapalıyken de kaydedilebilir **sürüm 1 taslak/preset** ve API revizyon koruması eklendi. Gerçek Comfy inference, immutable generation job, visual end-to-end kabulü **açıktır**.
