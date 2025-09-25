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
const powerUpTime = config.sinamics.power_up_time || 15000;

// Speed helper (default=100)
function getSpeedValue(sp) {
    const spVal = (typeof sp === "number") ? sp : 100; // default 100
    return Math.round(spVal / 100 * speedMax);
}

// Modbus write mesajı oluştur
function createModbusMsg(value, unitid, address, quantity = 1) {
    return { payload: { value, fc: 6, unitid, address, quantity } };
}

// 🔹 TOPLU OFF – sadece off komut word gönderir ve runtime günceller
function setAllOff() {
    const msgs = [];
    for (const [name, sin] of Object.entries(sinamicsChannels)) {
        const unitid = sin.unitid;

        const offVal = commandWords.off;
        if (offVal != null) {
            msgs.push(createModbusMsg(offVal, unitid, 99, 1));
        }

        // Runtime güncelle
        if (!runtime[name]) runtime[name] = {};
        runtime[name].val = "off";
    }
    return msgs;
}

// 🔹 TOPLU SPEED – her cihaz için speed_set_point gönderir
function setAllSpeed() {
    const msgs = [];
    for (const [name, sin] of Object.entries(sinamicsChannels)) {
        const unitid = sin.unitid;

        const speedValue = getSpeedValue(runtime[name]?.speed_set_point);
        msgs.push(createModbusMsg(speedValue, unitid, 100, 1));
    }
    return msgs;
}

// 🔹 TOPLU FAULT ACK
function ackAllFault() {
    const msgs = [];
    const faultAckSet = commandWords.fault_ack_set;
    const faultAckRes = commandWords.fault_ack_res;

    if (faultAckSet == null || faultAckRes == null) {
        node.warn("fault_ack_set veya fault_ack_res tanımlı değil.");
        return msgs;
    }

    for (const [name, sin] of Object.entries(sinamicsChannels)) {
        msgs.push(createModbusMsg(faultAckSet, sin.unitid, 99, 1));
    }
    for (const [name, sin] of Object.entries(sinamicsChannels)) {
        msgs.push(createModbusMsg(faultAckRes, sin.unitid, 99, 1));
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
    modbusMsgs = ackAllFault();
    sendMsgs(modbusMsgs);

/* 🔹 Actuators OFF – eski davranış korunuyor */
} else if (type === "off" && target === "actuators") {
    modbusMsgs = [...setAllOff(), ...setAllSpeed()];
    sendMsgs(modbusMsgs);

/* 🔹 Power OFF – hiçbir işlem yapmadan çık, ama if dursun */
} else if (type === "off" && target === "power") {
    // İstenilen şekilde hiçbir şey yapılmıyor
    return null;

/* 🔹 Power ON – önce bekle, sonra fault ack + speed gönder */
} else if (type === "on" && target === "power") {
    setTimeout(() => {
        const msgs = [
            ...setAllOff(),
            ...setAllSpeed()
        ];
        sendMsgs(msgs);
        flow.set("flow", flowData);
    }, powerUpTime);

/* 🔹 Bireysel sinamics hedefleri (forward/reverse/off/speed) */
} else if (sinamicsChannels[target]) {
    const unitid = sinamicsChannels[target].unitid;

    if (["forward", "reverse", "off"].includes(type)) {
        // 1️⃣ Speed register (speed_set_point, default 100) — önce gönder
        const speedValue = getSpeedValue(runtime[target]?.speed_set_point);
        modbusMsgs.push(createModbusMsg(speedValue, unitid, 100, 1));

        // 2️⃣ Komut word (forward/reverse/off) — sonra gönder
        const value = commandWords[type];
        if (value != null) {
            modbusMsgs.push(createModbusMsg(value, unitid, 99, 1));
            if (!runtime[target]) runtime[target] = {};
            runtime[target].val = type;
        }
    }

    if (type === "speed" && typeof set_point === "number") {
        const speedValue = getSpeedValue(set_point);
        modbusMsgs.push(createModbusMsg(speedValue, unitid, 100, 1));
        if (!runtime[target]) runtime[target] = {};
        runtime[target].speed_set_point = set_point;   // artık speed_set_point
    }

    sendMsgs(modbusMsgs);
} else {
    return null; // Sadece sinamics target'larını işler
}

flow.set("flow", flowData);
return null;
