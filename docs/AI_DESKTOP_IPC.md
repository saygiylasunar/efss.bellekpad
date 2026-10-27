# BellekPad AI-0.1 — Yerel Model Keşfi / Electron IPC

Durum: **kabul edilen ilk model bağlantı kesiti, 27 Ekim 2026**. Kaynak: `saygiylasunar/efss.bellekpad` `main`, kod commit'i `27e75fad569cc9dc3c3b9a356a60370da84cf91e`.

## Kullanım

1. LM Studio veya aynı OpenAI-compatible protokolü sunan **kendi yerel uygulaman** üzerinde API sunucusunu `127.0.0.1`, port `1234`'te çalıştır. Desteklenen keşif endpoint'i **`GET http://127.0.0.1:1234/v1/models`**.
2. BellekPad'i Electron ile aç. Sol menüde **YEREL MODEL → Modelleri kontrol et** düğmesine bas.
3. Sunucu geçerli model listesi döndürürse modeller açılır listede görünür. Liste boşsa veya sunucu kapalıysa belirgin bir durum mesajı görünür.
4. Bu aşamada açılır listeden model seçilebilir; **sohbet başlatılmaz**, model çalıştırma isteği gönderilmez, belge içeriği hiçbir yere aktarılmaz.

## Güvenlik ve veri sözleşmesi

- `desktop/local-model-service.js`: yalnız sabit `http://127.0.0.1:1234/v1` üzerinden mevcut `OpenAICompatibleProvider` çağrılır. Remote endpoint ve API anahtarı yoktur. İstek yalnız kullanıcı düğmesine basınca gerçekleşir; uygulama açılınca otomatik istek yoktur.
- `desktop/security.js` yalnız `bellekpad:models:list` kanalını whiteliste ekler. `desktop/preload.cjs` `listLocalModels()` dışında keyfi `invoke`, URL veya dosya yolu kabul etmez. `desktop/main.js` ana frame/güvenilir origin denetimiyle çalışır.
- `GET /models` time-out **4,5 saniye**; redirect reddi; cevap şekli ve model ID doğrulaması mevcut `src/model-provider.js`'den. Yanıt en fazla **128 model** kabul eder. Hata yüzeyinde dosya yolları, içerikler, ağ exception ayrıntıları gösterilmez.
- Renderer CSP `connect-src 'none'` korunur; ağ yalnız ana süreçteki sabit loopback isteğidir. Arayüz model ID'lerini `Option(...)` ile metin olarak çizer, HTML yorumlamaz.
- Model dosyası dizini taraması, checkpoint yüklemesi, prompt/body kullanımı, sohbet, ComfyUI ve uzaktaki sağlayıcılara veri gönderme **bu kapsamda yoktur**.

## Test kanıtı ve sınırlar

- Node model servis testleri: yalnız açık çağrı, sabit endpoint ve `redirect: "error"`, boş gövde, hatalı ID / boyut sınırı, remote override reddi, response body hata gizliliği.
- Gerçek Electron Windows/Linux GUI smoke: test sürecinde **sahte `127.0.0.1:1234` HTTP sunucusu** ayağa kaldırılır; kullanıcı butonuna basmadan HTTP isteği yoktur. Düğme basılınca IPC→main→HTTP→model listesi→select çalışır. Sunucu kapatıldığında çevrimdışı durum yeniden çizilir.
- **304/304 Node** ve gerçek Windows/Linux Electron smoke yeşil. [Core](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/40580561010) · [Desktop](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/40580560908).
- **Gerçek LM Studio yüklemesi ve inference doğrulanmadı.** `/models` cevabı, model ağırlıklarının başarıyla inference yapabildiğini veya belleğe yüklendiğini kanıtlamaz. Varsayılan sabit port şimdilik kullanıcı tarafından arayüzden değiştirilemez.

## Sonraki kesit

**AI-0.2**: açıkça yazılmış prompt + seçili model için izinli `chat/completions` IPC, iptal, yanıt/hata UI, kullanıcıya ait belge içeriklerini otomatik eklememe ve yalnız kullanıcı isteğiyle belgeye yapıştırma. Loopback güvenliği sürdürülür. Gerçek model üzerinde kullanıcı acceptance testi ayrıca gerekir.
