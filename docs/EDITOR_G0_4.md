# BellekPad G0.4 — İlk Görsel Flow Düzenleme Katmanı

**Durum:** Kaynak moduyla aynı TextEditorSession'ı paylaşan, bağımsız haricî editör kütüphanesi kullanmayan ilk görsel blok düzenleyici uygulandı. Node testleri ve odaklı **Windows + Linux Electron GUI smoke** geçti; fiziksel klavye, IME, kapsamlı yapıştırma, erişilebilirlik ve sürükleme testleri **henüz yapılmadı**.

## Bütünlük ilkesi

**Tek gerçek kaynak:** EFSS Markdown metni + bu metni düzenleyen tek TextEditorSession/transaction geçmişi. Görsel Flow görünümü, ayrı kaydedilen ikinci bir belge değildir. Source/Flow/Preview geçişi metni başka formata çevirmeye kalkmaz; ekran yalnızca mevcut kaynak üzerinde bir projeksiyon oluşturur.

\`\`\`text
          ┌──────────── Görsel Flow DOM (native input adapter)
          │
TextEditorSession ──── Markdown Kaynak DOM (source input adapter)
          │
          ├──────────── EFSS AST / block projection / callout view
          │
          └──────────── onChange → draft / Electron IPC / LocalVault
\`\`\`

## Mevcut özellikler

- Başlık, tek satırlı paragraf, madde ve alıntı üzerindeki sıradan metinler görsel olarak seçilip düzenlenebilir. Markdown başlık/list/quote işaretleri görünmez; kaynakta korunur.
- Belgelerde ilk **görsel callout** kutuları vardır: \`/callout\`, \`/uyarı\`, \`/ipucu\` veya blok ekleme menüsü. Özel EFSS uzantısı \`:::efss.callout...\` olarak kaydedilir; başlık/ikon ve vurgulu renk görsel yüzeyde gösterilir. *Bu ilk sürüm callout içeriği tek satırla sınırlıdır.*
- Ekle menüsünde paragraf, başlık, madde, alıntı ve tür bazlı callout bulunur. Komutlar doğrudan belge işlemi oluşturur; kullanıcıdan uzun Markdown kaynak sözdizimi yazması istenmez.
- **Kaynak** görünümüne geçiş serbesttir. Kaynak modunda Markdown'ın bütün ham biçimi düzenlenebilir; Preview ayrı görüntülemedir. Aynı editör işlem geçmişi her iki yazı modunda paylaşılır.
- Bilinmeyen EFSS blokları, kod çitleri, çok satırlı/nested yapılar, inline Markdown markları (\`**bold**\` vb.) ve kayıpsız gösterilemeyen diğer öğeler Flow modunda **kaynağa yönlendiren salt okunur kartlar** olarak sunulur. Kullanıcı içeriği yanlışlıkla metne dönüştürülmez/silinmez.
- Clipboard yalnız \`text/plain\` kabul eder; içerik \`innerHTML\` ile işlenmez. IME için native composing DOM korunur; compositionend sonrası mutabakat gerekir.

## Öncelikli riskler

1. **Henüz eksiksiz WYSIWYG değil:** Seçili metne kalın/italik/renk uygulama, tablolarda hücre düzenleme, iç içe callout, glif/konum, artboard ve düzenli çok satırlı metin akışı yapılmadı. Flow editor karmaşık syntax'ı kayıpsız sürdürmek için açıkça kaynak moduna yönlendirir.
2. Native input seçimi, metnin RTL/IME/mobil davranışı, tek bloğun her tuşta yeniden yaratılması, erişilebilirlik ve büyük belgelerde performans **gerçek GUI ortamında ölçülmedi**.
3. \`/callout\` komutunun bir Undo hareketine dönüşmesi ve kaynakta kalıcı blok kimlikleri sonraki teknik aşama konularıdır. Mevcut blok kimlikleri oturum süresince geçerlidir.
4. Markdown kaynak metni EFSS local vault'un SHA-256 tabanlı revizyon kontrolüyle saklanır. İşletim sisteminin zorla kapatması sırasında autosave tamamlanmamışsa değişiklik kaybedilebilir.
5. Görsel blok metin alanındaki sıradan içerik çok satıra uzarsa veri **kaybolmaz**, ancak görünüm geçici olarak kaynak kartına dönüşebilir. Ayrı metin akışı/satır düzenleme motoru G0.5'te geliştirilecek.

## Doğrulamalar

- Pure \`editor-flow-model.js\`: kaynak aralıkları, tüm basit blokların öneklerini gizleme, CRLF/emoji kaynak koruma, callout oluşturma ve düzenleme, unknown extension ve biçimlendirilmiş blokların güvenli read-only gösterimi, sürüm kontrolü.
- Static UI sözleşmesi: tek paylaşılan session, görsel/kaynak mod anahtarları, güvenli DOM, model bağlantısı, callout ve slash komutları.
- Önce **Windows Electron üzerinde** şu senaryoları gerçek giriş olaylarıyla tamamla: boş notta /callout; içerik yaz, kaydet/kapat/aç; Flow→Kaynak→Flow dönüşümü; iki blok arasında Undo; metin seç/yapıştır; Türkçe ve emoji; IME; kilitli blokta kaynakla düzenleme; hızlı navigasyon.

## Mimari sonraki adım

Üçüncü taraf editör import etmeden **inline mark/selection mapping, çok satırlı paragraf, gerçek tablo hücreleri** ve ardından **constraint tabanlı artboard/layout**. Frontend DOM, arka planda tek belge modeli ve sürüm kontrollü dosya kayıt sözleşmesine bağlı kalmalı.

## Sonradan tamamlanan masaüstü çalıştırma kontrolü

`desktop-smoke` iş akışında hem `windows-latest` hem Ubuntu/Xvfb üzerinde gerçek Electron süreci açılarak sandboxed renderer, preload bridge, yeni sayfa, `/callout`, callout içeriği, başlık ekleme, Undo/Redo, disk kaydı/okuma ve üç görünüm sınandı. İki ortam da commit `a16a15e` için başarılıydı. Kullanılan `beforeinput` olayları testte oluşturulan kontrollü olaylardır; fiziksel IME/klavye etkileşimlerini otomatik olarak kanıtlamaz.
