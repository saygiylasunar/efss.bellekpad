# BellekPad — G0.6A: kaynak farkındalıklı karışık run biçimlendirmesi

**Durum:** Dar kapsamlı ilk dilim geliştirildi; G0.6A bütünü hâlâ tamamlanmadı.  
**Repo:** `saygiylasunar/efss.bellekpad`  
**Başlangıç:** `main` HEAD `67676912cef7ff53feb23e9e95aee823b962bdf8`  
**Dal:** `feat/g0-6a-rich-selection` (Draft PR; `main` değiştirilmedi)  
**Mimari otorite:** `docs/DEV_HANDOFF.md`, `docs/EDITOR_G0_5.md`

## Neden?

G0.5 yalnız bir biçimsiz run içindeki işaretlemeyi ve tam mark açmayı destekliyordu. Görsel olarak seçilen ama kaynakta `**` gibi gizli delimiter içeren aralıklar doğrudan UTF-16 kaynak ofsetiyle sarmalanırsa kaynak sözdizimi bozulabilir. Bu aşama işaretlerin veri kaybına yol açmadan, yalnızca **kanıtlanabilen** karışık biçim seçimlerinde uygulanmasını sağlar.

## Somut değişiklikler

- `src/editor-inline-format.js`: `planInlineVisibleMark()` gerçek görünür UTF-16 aralığından `mapInlineVisibleOffset` ile kaynak aralığı planlar. Otorite yine orijinal EFSS Markdown string ve `TextEditorSession` içindeki tek replace transaction'dır.
- Planner, mevcut blok projeksiyonunu **mevcut kaynak ile birebir** doğrular (source range, run marks/offsets ve mark bölgeleri). Aynı görünen ama değişmiş kaynak, stale projeksiyon olarak reddedilir.
- Bir mark, karışık run aralığına ancak önerilen kaynak yeniden `projectInline()` ile parse edildiğinde **görünen her karakter ve mevcut tüm diğer marklar değişmeden kalıyorsa** eklenir. Örnek: `A **kalın** B` → `~~A **kalın** B~~`.
- Tam mark kaldırma eski kaynak-koruyan yöntemi kullanır; daha karmaşık kısmi toggles, sınır kesişmeleri veya geçersiz Unicode aralıkları **fail-closed**.
- `src/editor-flow-adapter.js`: `format()` doğrudan görünür DOM seçimini okur. Kaynakta görünmeyen marker'ları seçimin sıradan karakterleriymiş gibi ele almaz; ters mouse seçimi yönünü muhafaza eder.
- `test/editor-inline-format.test.js`: karışık strong+plain, emphasis+plain, CRLF + bilinmeyen EFSS extension, Undo/Redo, kısmi seçimin reddi, emoji/ZWJ ve stale projection senaryoları.
- `desktop/smoke.mjs`: Windows/Linux Electron üzerinde gerçek Flow DOM reverse selection → mark → undo/redo → yerel vault save/open. Smoke `executeJavaScript` ve kontrollü `beforeinput` kullanır; fiziksel klavye/gerçek IME doğrulaması **değildir**.

## Sınırlar — yanlış tamamlandı ilanı yok

- **G0.6A'nın tamamı değil.** Karışık seçimlerin tüm düzenleme/toggle ihtimalleri, seçilen metnin panoya biçimle aktarımı ve çok bloklu selection hâlâ eksik.
- Çapraz marker sınırları rastgele split/merge edilmez. Açık reddedilir, EFSS kaynağı değişmeden kalır.
- Flow DOM'unun her editte yeniden oluşturulması caret/performans riski; hedefli invalidation sonraki çalışma.
- G0.6B doğal Enter/Backspace/çoklu paragraf, G0.7 callout özelleştirmesi/blok taşıma ve G0.8 artboard kapsam dışı.
- Electron security/DevTools/IPC/persistence/lisans politikası değiştirilmedi.
- **Yeni npm paketi, UI framework, dış editör veya ikinci belge formatı yok.**
- Daha önce yanlış repoda yürütülen çalışma ile bu dal arasında **merge, copy, cherry-pick veya adapter bağlantısı yoktur.** Geliştirme doğrudan bu deponun G0.5 kaynaklarına dayanır.

## Doğrulama

```powershell
npm run sanity
npm run check
npm test
npm run desktop:smoke
```

GitHub Actions `core-checks` ve `desktop-smoke` workflowları PR için hem Windows hem Ubuntu'da çalışır. Onaydan önce **güncel dal HEAD'ine ait** CI sonuçları kontrol edilmelidir. Ayrı fiziksel klavye/IME ve yardımcı teknoloji testlerinin henüz yapılmadığı belgelenmelidir.

## Sonraki dar görev

G0.6A'nın kalanında kısmi/çakışan mark işlemleri için **lossless interval split/merge** algoritmasını, görsel selection ile source mapping'teki birleşik işaretleme köşelerini ve tek-transaction inverse seçimini genişlet. Sonra G0.6B'ye geç. Dış editör runtime ekleme.
