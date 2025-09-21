// === RELAYS_WRITE.JS — FIXED POWER_BIT ORDER ===

// ===== const / başlangıç =====
const flowData = flow.get("flow");
if (!flowData || !flowData.config) return null;

const config = flowData.config;
const runtime = flowData.runtime || {};
const labels = config.labels || { true: "on", false: "off" };

const payload = msg.payload || {};
if (payload.method !== "cmd" || typeof payload.params !== "object") return null;
const { type, target } = payload.params || {};
if (!type || !target) return null;

// local arrays (work on these only)
let arr1 = context.get("last_write_array_1") || Array(8).fill(false);
let arr2 = context.get("last_write_array_2") || Array(8).fill(false);

// channels / unitid
const relayChannels = { ...(config.io.relay_outputs_1?.channels || {}), ...(config.io.relay_outputs_2?.channels || {}) };
const unitids = { 1: config.io.relay_outputs_1?.unitid, 2: config.io.relay_outputs_2?.unitid };
const arrays = { 1: arr1, 2: arr2 };
const POWER_BIT = config.io.relay_outputs_2?.channels?.power_contactor?.map;

// ===== functions =====
function getRelayInfo(name) {
  if (config.io.relay_outputs_1?.channels?.[name]) {
    return { array: arr1, bit: config.io.relay_outputs_1.channels[name].map, unitid: unitids[1], arrayName: "last_write_array_1" };
  }
  if (config.io.relay_outputs_2?.channels?.[name]) {
    return { array: arr2, bit: config.io.relay_outputs_2.channels[name].map, unitid: unitids[2], arrayName: "last_write_array_2" };
  }
  return null;
}

function createRelayMsgFromArray(theArray, unitid, arrayName) {
  const word = theArray.reduce((w, b, i) => (b ? w | (1 << i) : w), 0);
  context.set(arrayName, theArray);
  return { payload: { value: word, fc: 6, unitid, address: 128, quantity: 1 } };
}

function sendEvtIfChanged(name, valStr) {
  if ((runtime[name]?.val) !== valStr) {
    runtime[name] = { val: valStr };
    node.send([null, { payload: { method: "evt", params: { type: name, val: valStr } } }]);
  }
}

function computePowerNewValue(preservePower, setPower) {
  if (preservePower) {
    const rtVal = runtime.power_contactor?.val;
    if (rtVal === "on") return true;
    if (rtVal === "off") return false;
    if (POWER_BIT !== undefined) return !!arr2[POWER_BIT];
    return false;
  }
  if (typeof setPower === "boolean") return setPower;
  return false;
}

// ===== FIXED resetRelays =====
function resetRelays({ preservePower = false, setPower = null } = {}) {
  // 1. tümünü sıfırla
  arr1.fill(false);
  arr2.fill(false);

  // 2. loader ve diğer röleleri kapat
  Object.keys(relayChannels).forEach(name => {
    if (name === "power_contactor") return; // power bitini atla
    const ch = relayChannels[name];
    const targetArray = (ch.unitid === unitids[1]) ? arr1 : arr2;
    targetArray[ch.map] = false;
    sendEvtIfChanged(name, "off");
  });

  // loader group off
  if (config.io.relay_groups?.loader) {
    Object.keys(config.io.relay_groups.loader).forEach(k => {
      const r = getRelayInfo(k);
      if (r) r.array[r.bit] = false;
    });
    sendEvtIfChanged("loader", "off");
  }

  // 3. EN SON power bit
  const newPowerBool = computePowerNewValue(preservePower, setPower);
  if (POWER_BIT !== undefined) {
    arr2[POWER_BIT] = !!newPowerBool;
    sendEvtIfChanged("power_contactor", labels[!!newPowerBool]);
  }

  // 4. persist arrays
  context.set("last_write_array_1", arr1);
  context.set("last_write_array_2", arr2);

  // 5. FC6 mesajlarını üret
  const msgs = [];
  if (unitids[1] != null) msgs.push(createRelayMsgFromArray(arr1, unitids[1], "last_write_array_1"));
  if (unitids[2] != null) msgs.push(createRelayMsgFromArray(arr2, unitids[2], "last_write_array_2"));
  node.send([msgs, null]);
}

// ===== other functions unchanged =====
function writeSingleRelay(name, setOn) {
  const info = getRelayInfo(name);
  if (!info) return;
  info.array[info.bit] = !!setOn;
  context.set(info.arrayName, info.array);
  sendEvtIfChanged(name, (info.array[info.bit] ? labels[true] : labels[false]));
  node.send([[ createRelayMsgFromArray(info.array, info.unitid, info.arrayName) ], null]);
}

function handleLoaderCmd(cmdType) {
  if (!config.io.relay_groups?.loader) return;
  const keys = Object.keys(config.io.relay_groups.loader || {});
  const motorKey = keys[0], fwdKey = keys[1], revKey = keys[2];
  const motor = getRelayInfo(motorKey), fwd = getRelayInfo(fwdKey), rev = getRelayInfo(revKey);
  if (!(motor && fwd && rev)) return;

  [motor, fwd, rev].forEach(r => r.array[r.bit] = false);

  if (cmdType === "forward") { motor.array[motor.bit] = true; fwd.array[fwd.bit] = true; }
  else if (cmdType === "reverse") { motor.array[motor.bit] = true; rev.array[rev.bit] = true; }

  context.set(motor.arrayName, motor.array);
  context.set(fwd.arrayName, fwd.array);
  context.set(rev.arrayName, rev.array);

  sendEvtIfChanged("loader", cmdType);
  sendEvtIfChanged(motorKey, motor.array[motor.bit] ? labels[true] : labels[false]);
  sendEvtIfChanged(fwdKey, fwd.array[fwd.bit] ? labels[true] : labels[false]);
  sendEvtIfChanged(revKey, rev.array[rev.bit] ? labels[true] : labels[false]);

  const msgs = [];
  [motor, fwd, rev].forEach(r => msgs.push(createRelayMsgFromArray(r.array, r.unitid, r.arrayName)));
  const uniqueMsgs = Array.from(new Map(msgs.map(m => [m.payload.unitid, m])).values());
  node.send([uniqueMsgs, null]);
}

// ===== main flow =====
if ((type === "off" && target === "actuators") || (type === "off" && target === "power") || (type === "on" && target === "power")) {
  const args = (target === "actuators") ? { preservePower: true } : { setPower: (type === "on") };
  resetRelays(args);
} else if (target === "loader") {
  handleLoaderCmd(type);
} else {
  writeSingleRelay(target, type === "on");
}

flow.set("flow", flowData);
return null;
