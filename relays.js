const flowData = flow.get("flow");
const config = flowData.config;
const runtime = flowData.runtime;

const payload = msg.payload;
if (!payload || payload.method !== "cmd" || typeof payload.params !== "object") return null;

const { type, target, set_point } = payload.params;
if (!type || !target) return null;

const relayChannels1 = config.io.relay_outputs_1.channels || {};
const relayChannels2 = config.io.relay_outputs_2.channels || {};
const unitid1 = config.io.relay_outputs_1.unitid;
const unitid2 = config.io.relay_outputs_2.unitid;

let currentArray1 = context.get("last_write_array_1") || Array(8).fill(false);
let currentArray2 = context.get("last_write_array_2") || Array(8).fill(false);

function getRelayInfo(name) {
  if (relayChannels1?.[name]) return { array: currentArray1, bit: relayChannels1[name].map, unitid: unitid1, arrayName: "last_write_array_1" };
  if (relayChannels2?.[name]) return { array: currentArray2, bit: relayChannels2[name].map, unitid: unitid2, arrayName: "last_write_array_2" };
  return null;
}

function createRelayMsg(array, unitid, arrayName) {
  let word = 0;
  for (let i = 0; i < 8; i++) {
    if (array[i]) word |= (1 << i);
  }
  context.set(arrayName, array);
  return { payload: { value: word, fc: 6, unitid, address: 128, quantity: 1 } };
}

// queue sadece port 1 için
function enqueuePort1(msgObj) {
  let sendQueue = context.get("sendQueue") || [];
  sendQueue.push(msgObj);
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
  const msgObj = sendQueue.shift();
  context.set("sendQueue", sendQueue);
  node.send([msgObj, null]); // port 1
  setTimeout(processQueue, 50);
}

// evt mesajları port 2’den direkt gönderim
function sendEvt(msgObj) {
  node.send([null, msgObj]); // port 2
}

// === Genel relays off fonksiyonu ===
function resetRelays({ preservePowerContactor = false, setPowerContactor = null } = {}) {
  // relay 1 ve relay 2 arraylerini sıfırla
  currentArray1 = Array(8).fill(false);
  currentArray2 = Array(8).fill(false);

  // power_contactor korunacak veya değiştirilecek
  if (preservePowerContactor) {
    const emBit = relayChannels2.power_contactor?.map;
    if (emBit !== undefined) currentArray2[emBit] = runtime.power_contactor?.val === "on";
  } else if (setPowerContactor !== null) {
    const emBit = relayChannels2.power_contactor?.map;
    if (emBit !== undefined) currentArray2[emBit] = setPowerContactor;
    runtime.power_contactor = { val: setPowerContactor ? "on" : "off" };
  }

  // power_contactor evt mesajı her zaman gönderilsin
  if (relayChannels2.power_contactor) {
    sendEvt({ payload: { method: "evt", params: { type: "power_contactor", val: runtime.power_contactor.val } } });
  }

  // loader ve diğer röleler off
  for (const name of Object.keys({ ...relayChannels1, ...relayChannels2 })) {
    if (name === "power_contactor") continue;
    if (runtime[name]) runtime[name].val = "off";
    sendEvt({ payload: { method: "evt", params: { type: name, val: "off" } } });
  }

  // loader özel off
  const loaderKeys = Object.entries({ ...relayChannels1, ...relayChannels2 })
    .filter(([_, val]) => val.group === "loader")
    .map(([key]) => key);
  loaderKeys.forEach(key => {
    const r = getRelayInfo(key);
    if (r) r.array[r.bit] = false;
  });
  runtime.loader = { val: "off" };
  sendEvt({ payload: { method: "evt", params: { type: "loader", val: "off" } } });

  // modbus mesajları port1 üzerinden
  enqueuePort1(createRelayMsg(currentArray1, unitid1, "last_write_array_1"));
  enqueuePort1(createRelayMsg(currentArray2, unitid2, "last_write_array_2"));
}

// === Mesaj işleme ===
if (type === "off" && target === "actuators") {
  resetRelays({ preservePowerContactor: true });

} else if (type === "off" && target === "power") {
  resetRelays({ setPowerContactor: false });

} else if (type === "on" && target === "power") {
  resetRelays({ setPowerContactor: true });

} else {
  // loader ve diğer röleler
  const relay = getRelayInfo(target);
  if (relay) {
    const val = type === "on";
    relay.array[relay.bit] = val;
    runtime[target] = { val: type };
    sendEvt({ payload: { method: "evt", params: { type: target, val: type } } });
    enqueuePort1(createRelayMsg(relay.array, relay.unitid, relay.arrayName));
  }

  // loader özel forward/reverse
  if (target === "loader") {
    const loaderKeys = Object.entries({ ...relayChannels1, ...relayChannels2 })
      .filter(([_, val]) => val.group === "loader")
      .map(([key]) => key);
    const relays = Object.fromEntries(loaderKeys.map(key => [key, getRelayInfo(key)]).filter(([_, info]) => info));
    const motor = relays["loader_motor"];
    const fwd = relays["loader_forward_valve"];
    const rev = relays["loader_reverse_valve"];
    if (motor && fwd && rev) {
      if (type === "forward_on") { motor.array[motor.bit] = true; fwd.array[fwd.bit] = true; rev.array[rev.bit] = false; }
      else if (type === "reverse_on") { motor.array[motor.bit] = true; fwd.array[fwd.bit] = false; rev.array[rev.bit] = true; }
      else if (type === "off") { motor.array[motor.bit] = false; fwd.array[fwd.bit] = false; rev.array[rev.bit] = false; }

      runtime.loader = { val: type };
      runtime.loader_motor = { val: type === "off" ? "off" : "on" };
      runtime.loader_forward_valve = { val: type === "off" ? "off" : (type === "forward_on" ? "on" : "off") };
      runtime.loader_reverse_valve = { val: type === "off" ? "off" : (type === "reverse_on" ? "on" : "off") };

      sendEvt({ payload: { method: "evt", params: { type: "loader", val: type } } });
      sendEvt({ payload: { method: "evt", params: { type: "loader_motor", val: runtime.loader_motor.val } } });
      sendEvt({ payload: { method: "evt", params: { type: "loader_forward_valve", val: runtime.loader_forward_valve.val } } });
      sendEvt({ payload: { method: "evt", params: { type: "loader_reverse_valve", val: runtime.loader_reverse_valve.val } } });

      enqueuePort1(createRelayMsg(motor.array, motor.unitid, motor.arrayName));
      enqueuePort1(createRelayMsg(fwd.array, fwd.unitid, fwd.arrayName));
      enqueuePort1(createRelayMsg(rev.array, rev.unitid, rev.arrayName));
    }
  }
}

flow.set("flow", flowData);
return null;
