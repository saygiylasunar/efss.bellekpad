# BellekPad — Uygulamanın kendi GGUF motoru (AI-0.3 başlangıç)

Güncelleme: **28 Ekim 2026** · Repository: `saygiylasunar/efss.bellekpad` · Dal: `main`.

## Neden?

BellekPad **kendi sohbet arayüzüne** sahip olmasına rağmen AI-0.1 ve AI-0.2 sırasında inference işlemi için **LM Studio veya başka bir OpenAI-uyumlu sunucunun önceden çalıştırılması** gerekiyordu. Bu bağımlılık bir ürün hedefi değil, IPC ve ağ köprüsünü doğrulamak için seçilen ilk teknik kesitti. BellekPad'in asıl hedefi: **program içerisinden kullanıcı tarafından seçilmiş bir modeli başlatmak, sohbet etmek ve durdurmak**; ayrı bir uygulamada sohbet etmek ya da harici uygulamayı zorunlu kılmak değil.

## İlk gerçek uygulama kesiti

- Electron sol panelinde **BELLEKPAD MOTORU** kartı; native dosya penceresiyle **güvenilir `llama-server.exe`** ve tek bir **`.gguf`** seçimi. Bu iki dosyayı tarayıp otomatik aramaz. Renderer gerçek tam dosya yollarını, shell komutunu veya erişim belirtecini almaz.
- `desktop/owned-model-runner.js`: yalnız Electron ana süreçte; `spawn(..., {shell:false, windowsHide:true})` ve sabit uygulama parametreleri. `127.0.0.1:12883` ile sınırlandırılmış localhost model sunucusu, rastgele oturumluk anahtarlı API ve `--no-webui`. `/v1/models` üzerinden beklenen `bellekpad-local` yanıtını bekler; maksimum **90 saniye** yükleme süresinde başarısızlık bildirir.
- Uygulama içerisindeki **Başlat** butonu işletim sistemi sürecini başlatır; **Durdur** mevcut sürece kapatma sinyali verir; **yüklenirken de Durdur aktiftir**. BellekPad kapanışında süreci kapatmayı dener.
- `desktop/local-model-service.js`: önceki sohbet/iptal arayüzü korunur; başarılı başlatmadan sonra yalnızca **kendi yönetilen endpoint'ine** geçilir; kullanıcı durdurduğunda isteğe bağlı eski harici loopback uyumluluğuna dönülür. Belge kendiliğinden modele gönderilmez. Sahte localhost yanıtlarının gerçek model çıkarımı olduğunu iddia etmeyiz.

## Şimdiki sınırlar — “tam bağımsız” değil

Bu ilk kesitte **llama.cpp ikili dosyası henüz beta paketine dâhil değil**. Kullanıcı, güvenilir bir derlemeyi kendisi seçmek zorunda. Model dosyaları da otomatik indirilmez. Modeli bellekte çalıştıran doğrudan BellekPad'in başlattığı subprocess'tir; **LM Studio gerekmez**, ancak seçilen `llama-server` binary gereklidir.

**Sonraki zorunlu adım:** Windows x64 için dağıtıma uygun, lisansı ve SHA-256'sı doğrulanan sürüme sabitlenmiş CPU/CUDA `llama.cpp` runtime'ını paketleme; güvenli otomatik seçimi, kurulum/ilk açılış deneyimi, CUDA uyumluluğu ve eksik DLL teşhisini ayrıca test etme. Sonra GGUF model seçiciye önizleme/bellek tahmini, çok turlu sohbet ve seçili modelin yükle/boşalt akışı. Kullanıcıdan izin almadan genel disk/model klasörü tarama veya otomatik model indirme yok.

**Doğrulama:** Node birim testleri native dosya doğrulaması, allowlist spawn argümanları, localhost auth, model başlat/stop, token sızdırmama, provider geçişi ve reddedilen istekleri sınar; Windows/Linux Electron GUI testleri yeni butonların varlığını ve önceki sohbetini sınar. **Gerçek `llama-server` binary ve gerçek GGUF ile inference, kullanıcı makinesinde ayrıca doğrulanmalıdır.**

**Uyarı:** Native seçim kullanıcının `llama-server` adlı *kendi seçtiği* yürütülebilir dosyayı çalıştırır. Bilinmeyen kaynaklardan gelen `.exe` dosyalarını kullanma. Bu güvenlik gereksinimi model içerik filtrelemesinden bağımsızdır.

## Mimari gerekçe

C++ çıkarım hesaplamasını sıfırdan Electron/JavaScript'e yazmıyoruz; kanıtlanmış bir **GGUF inference engine** uygulamamızın denetiminde alt süreç olarak çalışıyor. BellekPad'in model seçici, sohbet, durum yönetimi, iptal, veri erişimi ve yaşam döngüsü kendi modüllerinde kalıyor. Web, Electron ve ileride başka platformlar için IPC/API sözleşmesi değişmeden motor adaptörü genişletilebilir.
