/****************************************************
 * sin_queue – dispatcher (write öncelikli)
 * Port 1 → sin_getter  (fc:3 read)
 * Port 2 → sin_writer  (fc:6 write)
 ****************************************************/

// --- Config’ten queue_interval çek ---
let flowData = flow.get("flow") || {};
let queueInterval = 50; // default
if (flowData.config?.sinamics?.queue_interval) {
    queueInterval = flowData.config.sinamics.queue_interval;
}

// --- Kuyrukları node context’te tut, yoksa başlat ---
let queueWrite  = context.get("queueWrite");
if (!Array.isArray(queueWrite)) queueWrite = [];
let queueRead   = context.get("queueRead");
if (!Array.isArray(queueRead)) queueRead = [];
let timerActive = context.get("timerActive") || false;

// --- fc alanını payload’dan güvenli çek ---
const fc = msg?.payload?.fc;

// --- Mesajı ilgili kuyruğa at ---
if (fc === 6) {
    queueWrite.push(msg);
} else if (fc === 3) {
    queueRead.push(msg);
} else {
    return null; // fc tanımlı değilse görmezden gel
}

// --- Kuyrukları context’e yaz ---
context.set("queueWrite", queueWrite);
context.set("queueRead", queueRead);

// --- Timer başlatılmamışsa başlat ---
if (!timerActive) {
    context.set("timerActive", true);
    sendNext();
}

return null;

/****************************************************
 * Fonksiyonlar
 ****************************************************/
function sendNext() {
    // Kuyrukları oku
    let qW = context.get("queueWrite") || [];
    let qR = context.get("queueRead") || [];

    let nextMsg = null;
    let port = null;

    // Öncelik: write kuyruğu
    if (qW.length > 0) {
        nextMsg = qW.shift();
        port = 2;
    } else if (qR.length > 0) {
        nextMsg = qR.shift();
        port = 1;
    }

    // Kuyrukları context’e geri yaz
    context.set("queueWrite", qW);
    context.set("queueRead", qR);

    if (nextMsg) {
        // İki çıkışlı: [out1, out2]
        node.send([
            port === 1 ? nextMsg : null,
            port === 2 ? nextMsg : null
        ]);

        // queue_interval sonra tekrar çalıştır
        setTimeout(sendNext, queueInterval);
    } else {
        // Kuyruklar boş, timer’ı durdur
        context.set("timerActive", false);
    }
}
