// === SIN_READ..JS ===
// Bu fonksiyon nodu, her tetiklendiğinde tüm sinamics sürücülerinin
// ZSW Status Word registerlerini okumak için mesaj üretir.
// Çıkışı sin_queue'ya bağlıdır.

const flowData = flow.get("flow");
if (!flowData?.config?.sinamics) return null;

// Sürücü listesi flow context'ten alınıyor
const sinamicsChannels = flowData.config.sinamics.channels;
const address = 109;   // ZSW Status Word register adresi
const quantity = 1;    // Okunacak register sayısı

// Mesajları oluştur
const msgs = Object.entries(sinamicsChannels).map(([name, cfg]) => {
    const unitid = cfg.unitid;

    return {
        unitid: unitid, // ✅ üst property olarak
        payload: {
            fc: 3,
            unitid: unitid,  // yine payload içinde de bırakıyoruz (Modbus için)
            address: address,
            quantity: quantity
        }
    };
});

// Tek çıkıştan dört mesaj olarak göndermek için:
return [msgs];
