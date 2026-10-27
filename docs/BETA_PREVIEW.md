# BellekPad 0.3.0-beta.2 — Sınırlı teknik beta

## Kapsam ve dürüst durum

Bu aşama **ilk Windows portable beta adayıdır**. Bir kararlı sürüm, imzalı kurulum programı veya geniş çaplı halka açık beta değildir. Hedef: çalıştırılabilir, test edilmiş bir Electron klasörünü dış bağımlılık eklemeden üretebilmek ve gerçek kullanım sorunlarını sınırlı beta testinde saptamak. Kaynak tek otoritedir: `saygiylasunar/efss.bellekpad` → `main`.

**Var:** Yerel belge oluşturma/kaydetme, temel görsel EFSS metin düzenleme, B/I/S, liste ve checklist, sade Markdown tabloları, bazı blok özellikleri, isteğe bağlı LM Studio model listesi ve kullanıcı tarafından başlatılan tek turlu sohbet/iptal.

**Eksik / kullanım sınırları:** Zengin çok satırlı editörün tüm davranışları, gerçek fiziksel IME ve clipboard kombinasyonları, artboard, tam Inspector, tablo sütun kontrolleri, belge dışa/içe aktarma, veri kurtarma/journal, imzalı installer, auto-update, kilitli npm transitive dependency lockfile, Electron'un tüm platformlarda elle son kullanıcı kurulumu, gerçek LM Studio üzerinde model ağırlığı çıkarımı.

## Portable Windows paketi

Repo içindeki `scripts/package-beta.mjs` yalnız **pakete izin verilen Electron çalışma zamanı ve statik yerel bağımlılıkları** `resources/app` altına kopyalar; `.git`, `.efss/vault`, `node_modules`, `.env`, dosya modelleri veya örnek kişisel belgeler paketlenmez. Uygulama dosyalarının SHA-256 manifesti oluşturulur; `scripts/verify-beta.mjs` ayrıca doğrular.

Windows üzerinde Node 22 ve `npm install` sonrasında:
```powershell
npm run sanity
npm run check
npm test
npm run desktop:smoke
npm run beta:package
npm run beta:verify
```

Çıktı: `dist/BellekPad-0.3.0-beta.2-win32-x64/`, içerisinde `BellekPad.exe`. **Dosya klasör olarak çıkarılır**; ZIP içerisinden doğrudan çalıştırılmaz.

**Doğrulanan Windows build:** [GitHub Actions beta-portable-windows #40591123263](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/40591123263), **312/312 Node, Windows Electron GUI ve bağımsız SHA256 manifest denetimi başarılı**. Artifact: `BellekPad-Windows-limited-beta` (yaklaşık 163 MB; 7 gün saklanır). GitHub'da Actions koşusunu açıp **Artifacts** bölümünden indir. GitHub artifact ZIP'inin içindeki **ikinci ZIP** taşınabilir uygulamadır; aynı yerdeki `.sha256` değerine göre doğrula, sonra ikinci ZIP'i açıp `BellekPad.exe` çalıştır.

GitHub Actions `beta-portable-windows` işi önce çekirdek/Node/gerçek Windows Electron smoke koşar, sonra Windows portable klasörünü ZIP'ler ve SHA256 oluşturur. Başarılıysa **Actions → beta-portable-windows → Artifacts** altında **7 gün** tutulur. **Kendiliğinden bir GitHub Release veya yayınlanan kurulum paketi oluşturmaz**. Başarısız işte beta indirme paketi kabul edilmiş sayılmaz.

## İlk çalıştırmada dikkat

1. **Önemli belgelerin tek kopyasını bu betada tutma.** Belgelerin yerel kasada kaydı olsa da 650 ms debounce sırasında zorla kapanma veri kaybettirebilir; otomatik crash recovery henüz tamamlanmadı.
2. Belgeler `app.getPath("userData")/vault` altında, portable uygulama klasöründen **ayrı**, şifrelenmemiş EFSS dosyaları olarak saklanır. Portable klasörü silmek otomatik olarak veriyi silmez; **mevcut kullanıcı verisini el ile koru**.
3. Kullanıcı beta testine geçmeden önce mevcut yerel vault dizininin tam **harici kopyasını** kendi cihazında güvenli bir yere almalı. Beta şu an tek tuşla yedek/dışa aktarma sağlamıyor; bunu geniş betaya geçişin engeli olarak görüyoruz.
4. LM Studio tamamen opsiyoneldir. Yerel API sunucusu **`127.0.0.1:1234`** üzerinde kullanıcı tarafından başlatılmadıkça model isteği yapılmaz; AI sonucu otomatik nota yazılmaz.
5. Windows paketi imzasızdır; Windows koruma uyarısı çıkabilir. Yalnızca kendi inşa ettiğin veya güvenilir GitHub Actions artefaktını doğrulayarak kullandığın paketi çalıştır.

## Geniş beta için bitmesi gereken kabul kapıları

| Kapı | Şimdiki durum |
| --- | --- |
| Kaynak ve gizlilik kontrolü, Node testleri | CI tarafından doğrulanır |
| Windows/Linux gerçek Electron GUI | CI tarafından doğrulanır |
| Windows portable EXE ZIP ve manifest | ✅ Windows CI / 40591123263 doğrulandı; kullanıcı makinesinde ilk çalıştırma bekliyor |
| Gerçek Windows kullanıcı makinesinde ilk açılış ve yeniden açılış | Kullanıcı kabulü bekleniyor |
| Belge yedeği / açık kaynak dışa aktarma + kurtarma | **Engel** |
| Fiziksel Türkçe klavye/IME ve çok satırlı editör güvenilirliği | **Engel** |
| Dağıtım güvenliği: bağımlılık kilidi, imza/kurulum yolu | Geniş beta için **engel** |
| Gerçek LM Studio inference | Opsiyonel AI özelliği için ayrı kabul kapısı |

**Beta adayı olmak, bütün planlanan özelliklerin tamamlandığını veya verinin garantili kurtarılabildiğini söylemek değildir.** Kapsam, son kullanıcı testleri ve sonraki sürüm kararlarında nihai onay kullanıcıdadır.

## 0.3.0-beta.2 — dahili GGUF başlatma kontrolü

BellekPad'in kendi sohbet arayüzü **zaten vardı**; beta.1 yalnız LM Studio gibi harici bir sunucuyla inference konuşabiliyordu. beta.2 adayı model motorunun uygulama içinden **başlatılması ve durdurulması** için ilk somut yüzeyi ekler. Native dosya seçiminden **güvenilir llama.cpp llama-server** binary ve bir `.gguf` seçilir. Sunucu BellekPad'in alt sürecidir; localhost API rastgele oturum anahtarı ile kullanılır. **LM Studio zorunlu değildir**, ancak bu beta adayı `llama-server.exe` dosyasını kendisi içermediğinden tam tek-parça model dağıtımı da değildir. Gerçek GGUF inference testi ve runtime lisans/SHA doğrulamalı paketleme ayrı kabul kapılarıdır. [Motor ayrıntıları](OWNED_GGUF_RUNTIME.md).

**Paketlemenin eski beta.1 artifact linkini beta.2'ye aitmiş gibi kullanma.** En son başarılı beta-portable-windows job sürümünü ve manifestini kontrol et. 
