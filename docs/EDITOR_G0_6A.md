# G0.6A.1 — Rich DOM caret affinity ve kayıpsız inline edit kapısı

**Tarih:** 22 Ekim 2026. **Branch:** main. **Sürüm:** 0.2.6. **Commit:** dfac01555f4b256887fb89c93a6a7db86a1bb3a8.

## Tamamlanan kod

- src/editor-inline-format.js: \`sourceLength\`, \`mapInlineSourceOffset()\`, \`planInlineTextEdit()\`.
- src/editor-flow-adapter.js: her görünen inline run'a \`data-inline-run\` atandı. DOM'un kendi yazı düğümü ve koşut run kaynağı kullanılarak imleç **biçimli sözcüğün içine** yerleştirilir; sadece görünen offset'e bakılıp saklanan \`**\` / \`*\` işaretlerinden biri yanlışlıkla silinmez.
- Seçimin iki tarafı farklı Markdown run'larında kaldığında, görünür metin ile kaynak byte aralığı örtüşmüyorsa düzenleme **iptal edilir** ve görünür hata gösterilir. Sessiz “düz metne çevirme” yapılmaz.
- Enter veya biçimsel metni dönüştürmeye yol açacak otomatik Markdown yorumlaması, bu ilk dilimde **fail-closed**; kullanıcı istediği sözdizimini bilinçli olarak **Kaynak** modunda yazabilir.
- Ctrl+B/I/S komutundan önce **aktif native selection'ın gerçekten aynı düzenlenebilir Flow block içinde olup olmadığı** denetlenir. Eski, görünmez selection kullanılarak başka belge konumuna style uygulanamaz.
- Kes (cut) için görünen metin \`text/plain\` clipboard'a yazılır; içerik silme aynı güvenli transaction kapısından geçer. HTML çalıştırılmaz veya kopyayla DOM'a gömülmez.
- Aynı TextEditorSession, aynı undo/redo ve EFSS Markdown kaynağı; **yeni dosya formatı, haricî editör veya Electron yetkisi eklenmedi**.

## Doğrulama

Commit \`dfac015\` için GitHub Actions:
- **core-checks:** başarılı — **219/219 Node testi**, privacy/sanity başarılı. [Run #39726223124](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39726223124).
- **desktop-smoke:** başarılı — **Windows** ve **Ubuntu/Xvfb** gerçek Electron penceresinde bütün smoke kontrolleri geçti. [Run #39726223095](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39726223095).
- Eklenen kaynak/GUI regresyonları: \`A **kalın** B\` metninde ters yönde karma selection + delete hiçbir \`**\` işaretini tüketmez; bold run başına \`ğ\` ve sonuna \`👩‍👧\` ekleme; undo/redo, disk save/open ve bilinmeyen \`:::efss.unknown\` uzantısını koruma.
- Regresyon birimi: \`test/editor-inline-selection.test.js\`. GUI smoke: \`desktop/smoke.mjs\`.

**Test kapsamı uyarısı:** GUI testlerinde kontrollü \`beforeinput\` olayları kullanılır. Fiziksel klavye, IME composition, complex nested Markdown, ekran okuyucu, real selection drag/clipboard farklı platform uygulamaları veya force-kill crash recovery **test edildi diye varsayılmamalıdır**. Windows CI başarı = üretim ürünü hatasız değil.

## Bilinen sınırlar

1. Bu dilim **karışık stilli seçimin biçimini sorunsuzca dönüştürmez**. \`A **kalın** B\` içindeki \`kalın B\` seçimi için güvenli biçim işlemi ve otomatik marker split/merge henüz yok; kullanıcıya anlaşılır hata çıkıyor, kaynak korumalı.
2. Tam işaretlenmiş son harfi silme halinde biçim kaplarının nasıl kaldırılacağı ve run sınırında ileri/geri yapıştırma gelişiyor; desteklenmeyen adım kayıp yaratmadan reddediliyor.
3. DOM hâlâ çoğu inputtan sonra bütünüyle yeniden render ediliyor; büyük belgelerde focus/caret ve performans için incremental invalidation gerekir.
4. Çok satırlı metin, Enter/Backspace ile blok birleştirme/ayırma ve cross-block selection G0.6B'dir.
5. Native composition ve Türkçe/RTL erişilebilirlik testleri ayrıca gerçekleştirilmelidir.

## Sıradaki net iş

**G0.6A.2:** seçili alanda farklı stiller birlikte bulunurken text replacement/formatting için kanonik run-split/merge modeli. Kayıpsız dönüşümün ispatlanamadığı her kaynak deseninde işlem **fail-closed** kalmalı. Önce ters selection / nested marks / emoji / marker / undo regresyonunu ekle. Böylece G0.6B çok satırlı editörü bu katmanın üzerine güvenle kurabiliriz. Dış editör kütüphanesi ekleme.

**Ardından G0.6B:** gerçek paragraf split/merge, Enter/Backspace/Delete ve bloklar arası caret; Windows/Linux kullanıcı girdi testini genişlet.
