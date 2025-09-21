/****************************************************
 * sin_evt – sin_getter’dan gelen ZSW (status word)
 * değişim olduğunda evt mesajı üretir.
 * Tüm bit tanımları config.status_word’dan dinamik alınır.
 * Çıkış msg.payload üzerinden verilecek.
 ****************************************************/

const flowData = flow.get("flow") || {};
const sinConfig = flowData.config?.sinamics || {};
const labels = flowData.config?.labels || {true: "on", false: "off"};
const statusWordMap = sinConfig.status_word || {};

// payload array [val] veya tek val olabilir
const rawVal = Array.isArray(msg.payload) ? msg.payload[0] : msg.payload;

// UnitID'yi olabilecek tüm kaynaklardan sırayla dene
const unitid =
    msg.meta?.unitid ??
    msg.unitid ??
    msg.payload?.unitid ??
    msg.modbusResponseBuffer?.unitid;

if (unitid === undefined) {
    node.warn("unitid bilgisi bulunamadı (meta/unitid/payload/modbusResponseBuffer).");
    return null;
}

let targetName = null;
for (const [name, ch] of Object.entries(sinConfig.channels || {})) {
    if (ch.unitid === unitid) {
        targetName = name;
        break;
    }
}

if (!targetName) {
    node.warn("sin_evt: unitid eşleşmedi " + unitid);
    return null;
}

// bit okuma fonksiyonu
function getBit(val, bitIndex) {
    return (val & (1 << bitIndex)) !== 0;
}

// config.status_word’daki tüm key’leri dinamik çöz
let stateObj = {};
for (const [key, def] of Object.entries(statusWordMap)) {
    const bitIndex = def.map;
    const bitVal = getBit(rawVal, bitIndex);
    stateObj[key] = labels[bitVal]; // örn on/off
}

// Son durumla karşılaştır, değişim varsa gönder
let lastStates = context.get("lastStates") || {};
let last = lastStates[targetName];

let changed = false;
if (!last) {
    changed = true; // ilk sefer
} else {
    for (let k of Object.keys(stateObj)) {
        if (stateObj[k] !== last[k]) {
            changed = true;
            break;
        }
    }
}

if (changed) {
    // Kaydet
    lastStates[targetName] = stateObj;
    context.set("lastStates", lastStates);

    // evt mesajını payload içine sar
    const evtMsg = {
        payload: {
            method: "evt",
            params: {
                type: targetName,
                val: stateObj
            }
        }
    };

    return evtMsg;
} else {
    return null; // değişim yok
}
