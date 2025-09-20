// === SIN_WRITE.JS ===
// Bu node gelen "cmd" mesajlarına göre sinamics sürücülerine modbus write mesajları oluşturur
// Çıkışı sin_queue'ya bağlı olacak, evt mesajları üretmeyecek

const flowData = flow.get("flow");
if (!flowData || !flowData.config || !flowData.config.sinamics) return null;

const config = flowData.config;
const runtime = flowData.runtime;
const payload = msg.payload;

if (!payload || payload.method !== "cmd" || typeof payload.params !== "object") return null;

const { type, target, set_point } = payload.params;
if (!type || !target) return null;

const sinamicsChannels = config.sinamics.channels;
const commandWords = config.sinamics.command_words;
const speedMax = config.sinamics.speed_max || 16384;
const powerUpTime = config.sinamics.power_up_time || 10000;

// Modbus write mesajı oluştur
function createModbusMsg(value, unitid, address, quantity = 1) {
    return { payload: { value, fc: 6, unitid, address, quantity } };
}

// Tüm sinamicsleri OFF komutu
function doSinamicsOff() {
    const msgs = [];
    for (const [name, sin] of Object.entries(sinamicsChannels)) {
        const unitid = sin.unitid;

        // Komut word
        const offVal = commandWords.off;
        if (offVal != null) msgs.push(createModbusMsg(offVal, unitid, 99, 1));

        // Speed register
        const speedValue = runtime[name]?.speed?.set_point
            ? Math.round(runtime[name].speed.set_point / 100 * speedMax)
            : 0;
        msgs.push(createModbusMsg(speedValue, unitid, 100, 1));

        // Runtime güncelle
        if (!runtime[name]) runtime[name] = {};
        runtime[name].val = "off";
    }
    return msgs;
}

// Mesajları tek çıkışa gönder
function sendMsgs(msgs) {
    for (const m of msgs) node.send(m);
}

let modbusMsgs = [];

/* 🔹 Fault Acknowledgement tüm sinamics için */
if (type === "fault_ack" && target === "sinamics") {
    const faultAckSet = commandWords.fault_ack_set;
    const faultAckRes = commandWords.fault_ack_res;

    if (faultAckSet == null || faultAckRes == null) {
        node.warn("fault_ack_set veya fault_ack_res tanımlı değil.");
        return null;
    }

    for (const [name, sin] of Object.entries(sinamicsChannels)) {
        modbusMsgs.push(createModbusMsg(faultAckSet, sin.unitid, 99, 1));
    }
    for (const [name, sin] of Object.entries(sinamicsChannels)) {
        modbusMsgs.push(createModbusMsg(faultAckRes, sin.unitid, 99, 1));
    }

} else if ((type === "off" && (target === "actuators" || target === "power"))) {
    // 🔹 Hemen gönder
    modbusMsgs = doSinamicsOff();
    sendMsgs(modbusMsgs);

} else if (type === "on" && target === "power") {
    // 🔹 Gecikmeli gönderim
    setTimeout(() => {
        const delayedMsgs = doSinamicsOff();
        sendMsgs(delayedMsgs);
        flow.set("flow", flowData);
    }, powerUpTime);

} else if (sinamicsChannels[target]) {
    const unitid = sinamicsChannels[target].unitid;

    if (["forward", "reverse", "off"].includes(type)) {
        const value = commandWords[type];
        if (value != null) {
            modbusMsgs.push(createModbusMsg(value, unitid, 99, 1));
            if (!runtime[target]) runtime[target] = {};
            runtime[target].val = type;
        }
        // Speed register
        const speedValue = runtime[target]?.speed?.set_point
            ? Math.round(runtime[target].speed.set_point / 100 * speedMax)
            : 0;
        modbusMsgs.push(createModbusMsg(speedValue, unitid, 100, 1));
    }

    if (type === "speed" && typeof set_point === "number") {
        const speedValue = Math.round(set_point / 100 * speedMax);
        modbusMsgs.push(createModbusMsg(speedValue, unitid, 100, 1));
        if (!runtime[target]) runtime[target] = {};
        if (!runtime[target].speed) runtime[target].speed = {};
        runtime[target].speed.set_point = set_point;
    }

    sendMsgs(modbusMsgs);
} else {
    return null; // Sadece sinamics target'larını işler
}

flow.set("flow", flowData);
return null;
