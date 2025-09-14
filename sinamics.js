// === SINAMICS.JS ===
// Bu nod motor sürücülerini (sinamics) yönetir.
// Port 1: Modbus Flex Writer’a gönderim (sinamics komutları)
// Port 2: EVT mesajları (durum/speed)

// === Flow context ===
const flowData = flow.get("flow");
const config = flowData.config;
const runtime = flowData.runtime;

const payload = msg.payload;
if (!payload || payload.method !== "cmd" || typeof payload.params !== "object") return null;

const { type, target, set_point } = payload.params;
if (!type || !target) return null;

const sinamicsChannels = config.sinamics?.channels || {};
const commandWords = config.sinamics?.command_words || {};
const speedMax = config.sinamics?.speed_max || 16384;

// === Gönderim listeleri ===
const modbusMsgs = []; // Port 1
const evtMsgs = [];    // Port 2

// === Kuyruk sistemi ===
function enqueueMsgs() {
  let sendQueue = context.get("sendQueue") || [];
  const queuedMsgs = [];
  modbusMsgs.forEach(m => queuedMsgs.push([0, m])); // Port 1
  evtMsgs.forEach(m => queuedMsgs.push([1, m]));   // Port 2
  sendQueue.push(...queuedMsgs);
  context.set("sendQueue", sendQueue);
  if (!context.get("isSending")) processQueue();
}

function processQueue() {
  let sendQueue = context.get("sendQueue") || [];
  if (sendQueue.length === 0) {
    context.set("isSending", false);
    return;
  }
  context.set("isSending", true);

  const [portIndex, msgObj] = sendQueue.shift();
  context.set("sendQueue", sendQueue);

  node.send([
    portIndex === 0 ? msgObj : null,
    portIndex === 1 ? msgObj : null
  ]);

  // Port 1 modbus için 50 ms bekleme, Port 2 evt anında
  setTimeout(processQueue, portIndex === 0 ? 50 : 0);
}

// === Modbus mesajı oluştur ===
function createModbusMsg(value, unitid, address, quantity = 1) {
  return { payload: { value, fc: 6, unitid, address, quantity } };
}

// === Tüm sinamicsleri OFF ===
function doSinamicsOff() {
  for (const [name, sin] of Object.entries(sinamicsChannels)) {
    // motoru durdur
    const offVal = commandWords.off;
    if (offVal != null) {
      modbusMsgs.push(createModbusMsg(offVal, sin.unitid, 99, 1));
    }

    // hız registerına runtime’daki speed’i gönder
    let speedValue = 0;
    if (runtime[name]?.speed?.set_point != null) {
      speedValue = Math.round(runtime[name].speed.set_point / 100 * speedMax);
    }
    modbusMsgs.push(createModbusMsg(speedValue, sin.unitid, 100, 1));

    // runtime güncelle – speed aynen kalıyor
    if (!runtime[name]) runtime[name] = {};
    runtime[name].val = "off";

    evtMsgs.push({
      payload: {
        method: "evt",
        params: {
          type: name,
          val: runtime[name].val,
          speed: runtime[name].speed
            ? { set_point: runtime[name].speed.set_point }
            : undefined
        }
      }
    });
  }
  enqueueMsgs();
}

// === Komut işleme ===
if (type === "off" && target === "actuators") {
  // Tüm sinamicsleri kapat
  doSinamicsOff();

} else if (type === "off" && target === "power") {
  // Tüm sinamicsleri kapat
  doSinamicsOff();

} else if (type === "on" && target === "power") {
  // 10 sn bekleyip tüm sinamics’leri kapat
  setTimeout(doSinamicsOff, 10000);

} else if (sinamicsChannels[target]) {
  // Tekil motorlar için yön/sürat komutları
  const unitid = sinamicsChannels[target].unitid;

  if (["forward_on", "reverse_on", "off"].includes(type)) {
    const value = commandWords[type];
    if (value != null) {
      modbusMsgs.push(createModbusMsg(value, unitid, 99, 1));
      if (!runtime[target]) runtime[target] = {};
      runtime[target].val = type;
    }

    // her off/forward_on/reverse_on’da runtime speed’i de 100’e gönder
    let speedValue = 0;
    if (runtime[target]?.speed?.set_point != null) {
      speedValue = Math.round(runtime[target].speed.set_point / 100 * speedMax);
    }
    modbusMsgs.push(createModbusMsg(speedValue, unitid, 100, 1));
  }

  if (type === "speed" && typeof set_point === "number") {
    const value = Math.round(set_point / 100 * speedMax);
    modbusMsgs.push(createModbusMsg(value, unitid, 100, 1));
    if (!runtime[target]) runtime[target] = {};
    if (!runtime[target].speed) runtime[target].speed = {};
    runtime[target].speed.set_point = set_point;
  }

  // evt her zaman
  evtMsgs.push({
    payload: {
      method: "evt",
      params: {
        type: target,
        val: runtime[target]?.val,
        speed: runtime[target]?.speed
          ? { set_point: runtime[target].speed.set_point }
          : undefined
      }
    }
  });
  enqueueMsgs();

} else {
  // Bu nod sadece sinamicsleri işler
  return null;
}

flow.set("flow", flowData);
return null;
