/****************************************************
 * sin_queue – dispatcher (write öncelikli)
 * Port 1 → sin_getter
 * Port 2 → sin_writer
 ****************************************************/

// Config’ten queue_interval çek
let flowData = flow.get("flow") || {};
let queueInterval = 20; // default
if (flowData.config?.sinamics?.queue_interval) {
    queueInterval = flowData.config.sinamics.queue_interval;
}

// Kuyrukları node context’te tut
let queueWrite = context.get("queueWrite") || [];
let queueRead  = context.get("queueRead")  || [];
let timerActive = context.get("timerActive") || false;

// Mesaj fc alanına göre ilgili kuyruğa at
if (msg && msg.fc === 6) {
    // Write mesajı
    queueWrite.push(msg);
} else if (msg && msg.fc === 3) {
    // Read mesajı
    queueRead.push(msg);
} else {
    // fc tanımlı değilse görmezden gel
    return null;
}

// Timer başlatılmamışsa başlat
if (!timerActive) {
    timerActive = true;
    context.set("timerActive", true);
    sendNext();
} else {
    // sadece kuyruklara ekledik, zaten timer çalışıyor
}

// Kuyrukları ve timer’ı context’e yaz
context.set("queueWrite", queueWrite);
context.set("queueRead", queueRead);

return null;

/****************************************************
 * Fonksiyonlar
 ****************************************************/

function sendNext() {
    // Kuyrukları oku
    let qW = context.get("queueWrite") || [];
    let qR = context.get("queueRead")  || [];

    // Öncelik: önce write
    let nextMsg = null;
    let port = null;

    if (qW.length > 0) {
        nextMsg = qW.shift();
        port = 2; // sin_writer
    } else if (qR.length > 0) {
        nextMsg = qR.shift();
        port = 1; // sin_getter
    }

    // Kuyrukları geri kaydet
    context.set("queueWrite", qW);
    context.set("queueRead", qR);

    if (nextMsg) {
        // Mesajı uygun port’tan gönder
        node.send([port === 1 ? nextMsg : null, port === 2 ? nextMsg : null]);

        // queue_interval sonra tekrar çalıştır
        setTimeout(sendNext, queueInterval);
    } else {
        // Kuyruklar boş, timer’ı durdur
        context.set("timerActive", false);
    }
}
