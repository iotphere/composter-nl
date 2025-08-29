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

const relayMsgs = [];
const sinamicsMsgs = [];
const evtMsgs = [];

function enqueueAll() {
  let sendQueue = context.get("sendQueue") || [];
  const allMsgs = [];
  relayMsgs.forEach(m => allMsgs.push([0, m]));
  sinamicsMsgs.forEach(m => allMsgs.push([1, m]));
  evtMsgs.forEach(m => allMsgs.push([2, m]));
  sendQueue.push(...allMsgs);
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
    portIndex === 1 ? msgObj : null,
    portIndex === 2 ? msgObj : null
  ]);
  setTimeout(processQueue, 50);
}

// === Toplu OFF ===
function doAllOff() {
  currentArray1 = Array(8).fill(false);
  currentArray2 = Array(8).fill(false);
  const emBit = relayChannels2.power_contactor?.map;
  if (emBit !== undefined) currentArray2[emBit] = runtime.power_contactor?.val === "on";

  context.set("last_write_array_1", currentArray1);
  context.set("last_write_array_2", currentArray2);

  for (const name of Object.keys({ ...relayChannels1, ...relayChannels2 })) {
    if (name === "power_contactor") continue;
    if (runtime[name]) {
      runtime[name].val = "off";
      evtMsgs.push({ payload: { method: "evt", params: { type: name, val: "off" } } });
    }
  }

  // Loader OFF
  const loaderKeys = Object.entries({ ...relayChannels1, ...relayChannels2 })
    .filter(([_, val]) => val.group === "loader")
    .map(([key]) => key);
  loaderKeys.forEach(key => {
    const r = getRelayInfo(key);
    if (r) r.array[r.bit] = false;
  });
  runtime.loader = { val: "off" };
  evtMsgs.push({ payload: { method: "evt", params: { type: "loader", val: "off" } } });

  // SINAMICS OFF
  for (const [name, sin] of Object.entries(config.sinamics?.channels || {})) {
    sinamicsMsgs.push({ payload: { value: config.sinamics.command_words.off, fc: 6, unitid: sin.unitid, address: 99, quantity: 1 } });
    if (!runtime[name]) runtime[name] = {};
    runtime[name].val = "off";
    if (runtime[name].speed?.set_point) {
      const value = Math.round(runtime[name].speed.set_point / 100 * config.sinamics.speed_max);
      sinamicsMsgs.push({ payload: { value, fc: 6, unitid: sin.unitid, address: 100, quantity: 1 } });
    }
    evtMsgs.push({ payload: { method: "evt", params: { type: name, val: runtime[name].val, speed: runtime[name].speed ? { set_point: runtime[name].speed.set_point } : undefined } } });
  }

  relayMsgs.push(createRelayMsg(currentArray1, unitid1, "last_write_array_1"));
  relayMsgs.push(createRelayMsg(currentArray2, unitid2, "last_write_array_2"));
  enqueueAll();
}

// === Restore ===
if (type === "restore" && target === "all") {
  evtMsgs.push({ payload: { method: "evt", params: { type: "power_contactor", val: "on" } } });
  const emRelay = getRelayInfo("power_contactor");
  if (emRelay) {
    emRelay.array[emRelay.bit] = true;
    runtime.power_contactor = { val: "on" };   // eksik olan eklendi
    relayMsgs.push(createRelayMsg(emRelay.array, emRelay.unitid, emRelay.arrayName));
  }
  enqueueAll();
  setTimeout(doAllOff, 10000);
} else if (type === "off" && target === "all") {
  doAllOff();
} else {
  const sinamics = config.sinamics?.channels?.[target];
  if (sinamics) {
    const unitid = sinamics.unitid;
    const commandWords = config.sinamics.command_words;
    const speedMax = config.sinamics.speed_max;
    if (["forward_on", "reverse_on", "off"].includes(type)) {
      const value = commandWords[type];
      if (value != null) {
        sinamicsMsgs.push({ payload: { value, fc: 6, unitid, address: 99, quantity: 1 } });
        if (!runtime[target]) runtime[target] = {};
        runtime[target].val = type;
      }
    }
    if (type === "speed" && typeof set_point === "number") {
      const value = Math.round(set_point / 100 * speedMax);
      sinamicsMsgs.push({ payload: { value, fc: 6, unitid, address: 100, quantity: 1 } });
      if (!runtime[target]) runtime[target] = {};
      if (!runtime[target].speed) runtime[target].speed = {};
      runtime[target].speed.set_point = set_point;
    }
    evtMsgs.push({ payload: { method: "evt", params: { type: target, val: runtime[target].val, speed: runtime[target].speed ? { set_point: runtime[target].speed.set_point } : undefined } } });
    enqueueAll();
  } else {
    if (["on", "off"].includes(type)) {
      const relay = getRelayInfo(target);
      if (relay) {
        const val = type === "on";
        relay.array[relay.bit] = val;
        runtime[target] = { val: type };
        evtMsgs.push({ payload: { method: "evt", params: { type: target, val: type } } });
      }
    }

    // === Tekil loader komutları için güncelleme ===
    if (target === "loader" && ["forward_on", "reverse_on", "off"].includes(type)) {
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

        // runtime güncelle
        runtime.loader = { val: type };
        runtime.loader_motor = { val: type === "off" ? "off" : "on" };
        runtime.loader_forward_valve = { val: type === "off" ? "off" : (type === "forward_on" ? "on" : "off") };
        runtime.loader_reverse_valve = { val: type === "off" ? "off" : (type === "reverse_on" ? "on" : "off") };

        // evt mesajları ekle
        evtMsgs.push({ payload: { method: "evt", params: { type: "loader", val: type } } });
        evtMsgs.push({ payload: { method: "evt", params: { type: "loader_motor", val: runtime.loader_motor.val } } });
        evtMsgs.push({ payload: { method: "evt", params: { type: "loader_forward_valve", val: runtime.loader_forward_valve.val } } });
        evtMsgs.push({ payload: { method: "evt", params: { type: "loader_reverse_valve", val: runtime.loader_reverse_valve.val } } });
      }
    }

    relayMsgs.push(createRelayMsg(currentArray1, unitid1, "last_write_array_1"));
    relayMsgs.push(createRelayMsg(currentArray2, unitid2, "last_write_array_2"));
    enqueueAll();
  }
}

flow.set("flow", flowData);
return null;
