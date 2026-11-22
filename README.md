# Ev Kontrol

> **English:** A Windows desktop control panel for Home Assistant (Tauri 2 + React). The interface is available in Turkish and English — switch under *Settings → Language*.

Home Assistant için Windows masaüstü kontrol paneli. Tauri 2, React ve TypeScript ile yazıldı. Yerel ağdaki Home Assistant'a WebSocket üzerinden bağlanır, bulut servisi kullanmaz.

## Özellikler

- **Pano:** favori cihazlar, oda özeti, anlık güç tüketimi, evde/dışarıda durumu (konum bilgisi eskiyse "Konum güncel değil" gösterir)
- **Odalar ve tüm cihazlar:** arama, filtreleme, cihaz ayrıntı çekmecesi; komutların gerçekten uygulandığı doğrulanır
- **Otomasyonlar:** listeleme, açma/kapama, tetikleme, silme ve YAML düzenleyici
- **Akıllı düğmeler, hareket sensörleri, kameralar, robot süpürge ve enerji** sayfaları
- **Tepsi:** kapatınca tepsiye gizlenir, `Ctrl+Alt+H` ile aç/gizle (değiştirilebilir), Windows açılışında başlatma
- **Düşük kaynak kullanımı:** tepsideyken WebView2 askıya alınır, kamera ve zamanlayıcılar durur
- **Dil:** Türkçe ve İngilizce arayüz (Ayarlar → Dil); cihaz ve oda adları Home Assistant’taki gibi kalır
- **Bilgisayar kontrolü (Siri):** Home Assistant'tan gelen komutlarla bilgisayarı kilitleme, kapatma, ses ve medya kontrolü

## Kurulum

Gerekenler: [Node.js](https://nodejs.org/) 20+, [Rust](https://rustup.rs/) ve Windows'ta MSVC derleme araçları.

```powershell
npm install
npm run tauri dev                         # geliştirme
npm run tauri build -- --no-bundle        # src-tauri/target/release/ha-desktop.exe
npm test                                  # birim testleri (çeviri eksiklerini de yakalar)
```

İlk açılışta Home Assistant adresini (ör. `http://homeassistant.local:8123`) ve bir **uzun ömürlü erişim token'ı** girin. Token'ı HA'da *Profil → Güvenlik → Uzun ömürlü erişim token'ları* bölümünden oluşturabilirsiniz.

## Güvenlik

- Token, Windows Kimlik Bilgisi Yöneticisi'nde saklanır; dosyaya ya da loglara yazılmaz.
- Bilgisayar kontrolü yalnızca sabit bir komut listesini kabul eder (`src-tauri/src/pc.rs`); serbest kabuk komutu çalıştırılamaz. Ayarlar'dan tamamen kapatılabilir.
- Kapatma komutu 60 saniye gecikmeyle çalışır ve iptal edilebilir.

## Bilgisayar kontrolü (Siri / Home Assistant)

Uygulama açıkken (tepside de olabilir) Home Assistant'taki `ev_kontrol_command` olayını dinler:

```yaml
# Örnek HA betiği
bilgisayari_kilitle:
  alias: Bilgisayarı kilitle
  sequence:
    - event: ev_kontrol_command
      event_data:
        command: lock
```

Komutlar: `lock`, `sleep`, `monitor_off`, `mute`, `volume_up`, `volume_down`, `play_pause`, `next`, `previous`, `shutdown`, `shutdown_cancel`. Birden çok bilgisayar varsa `target: <BİLGİSAYAR ADI>` eklenebilir.

Siri için Home Assistant'ta iki şablon yardımcısı oluşturup HomeKit Bridge'e eklemek yeterlidir:

- **Anahtar "Bilgisayar":** kapatınca `shutdown`, açınca `shutdown_cancel` → "Hey Siri, bilgisayarı kapat"
- **Kilit "Bilgisayar ekranı":** kilitleyince `lock` → "Hey Siri, bilgisayar ekranını kilitle"

## Lisans

[MIT](LICENSE)
