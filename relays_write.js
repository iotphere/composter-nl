const flowData = flow.get("flow");
if (!flowData?.config) return null;

const { config, runtime } = flowData;
const labels = config.labels || { true: "on", false: "off" };
const payload = msg.payload;
if (!payload || payload.method !== "cmd" || typeof payload.params !== "object") return null;

const { type, target } = payload.params;
if (!type || !target) return null;

const relayChannels = { ...config.io.relay_outputs_1.channels, ...config.io.relay_outputs_2.channels };
const unitids = {
  1: config.io.relay_outputs_1.unitid,
  2: config.io.relay_outputs_2.unitid
};

// Context arrayler
let arr1 = context.get("last_write_array_1") || Array(8).fill(false);
let arr2 = context.get("last_write_array_2") || Array(8).fill(false);
const arrays = { 1: arr1, 2: arr2 };

// Röle bilgisi
const getRelayInfo = (name) => {
  if (config.io.relay_outputs_1.channels?.[name]) return { array: arr1, bit: config.io.relay_outputs_1.channels[name].map, unitid: unitids[1], arrayName: "last_write_array_1" };
  if (config.io.relay_outputs_2.channels?.[name]) return { array: arr2, bit: config.io.relay_outputs_2.channels[name].map, unitid: unitids[2], arrayName: "last_write_array_2" };
  return null;
};

// fc:6 write mesajı
const createRelayMsg = (array, unitid, arrayName) => {
  let word = array.reduce((w, b, i) => b ? w | (1 << i) : w, 0);
  context.set(arrayName, array);
  return { payload: { value: word, fc: 6, unitid, address: 128, quantity: 1 } };
};

// evt gönderimi (yalnızca değişenler)
const sendEvt = (name, val) => {
  if (runtime[name]?.val !== val) {
    runtime[name] = { val };
    node.send([null, { payload: { method: "evt", params: { type: name, val } } }]);
  }
};

// Röle sıfırlama
const resetRelays = ({ preservePower = false, setPower = null } = {}) => {
  arr1.fill(false);
  arr2.fill(false);

  // power_contactor
  const powerBit = config.io.relay_outputs_2.power_contactor?.map;
  if (powerBit !== undefined) {
    if (preservePower) arr2[powerBit] = runtime.power_contactor?.val === "on";
    else if (setPower !== null) arr2[powerBit] = setPower;
    sendEvt("power_contactor", labels[arr2[powerBit]]);
  }

  // diğer röleler off evt
  Object.keys(relayChannels).forEach(name => {
    if (name !== "power_contactor") {
      arrays[relayChannels[name].unitid === unitids[1] ? 1 : 2][relayChannels[name].map] = false;
      sendEvt(name, "off");
    }
  });

  // loader off
  const loaderKeys = Object.keys(config.io.relay_groups.loader);
  loaderKeys.forEach(k => {
    const r = getRelayInfo(k);
    if (r) r.array[r.bit] = false;
  });
  sendEvt("loader", "off");

  // fc:6 yazma mesajları
  node.send([[createRelayMsg(arr1, unitids[1], "last_write_array_1"), createRelayMsg(arr2, unitids[2], "last_write_array_2")], null]);
};

// Mesaj işleme
if ((type === "off" && target === "actuators") || (type === "off" && target === "power") || (type === "on" && target === "power")) {
  const args = target === "actuators" ? { preservePower: true } : { setPower: type === "on" };
  resetRelays(args);
} else {
  // Tekil röle veya loader
  if (target === "loader") {
    const [motorKey, fwdKey, revKey] = Object.keys(config.io.relay_groups.loader);
    const motor = getRelayInfo(motorKey), fwd = getRelayInfo(fwdKey), rev = getRelayInfo(revKey);
    if (motor && fwd && rev) {
      // Reset tüm loader önce
      [motor, fwd, rev].forEach(r => r.array[r.bit] = false);

      if (type === "forward") { motor.array[motor.bit] = true; fwd.array[fwd.bit] = true; }
      else if (type === "reverse") { motor.array[motor.bit] = true; rev.array[rev.bit] = true; }

      sendEvt("loader", type);
      sendEvt(motorKey, motor.array[motor.bit] ? "on" : "off");
      sendEvt(fwdKey, fwd.array[fwd.bit] ? "on" : "off");
      sendEvt(revKey, rev.array[rev.bit] ? "on" : "off");

      node.send([[createRelayMsg(motor.array, motor.unitid, motor.arrayName),
                  createRelayMsg(fwd.array, fwd.unitid, fwd.arrayName),
                  createRelayMsg(rev.array, rev.unitid, rev.arrayName)], null]);
    }
  } else {
    const r = getRelayInfo(target);
    if (r) {
      r.array[r.bit] = type === "on";
      sendEvt(target, type);
      node.send([[createRelayMsg(r.array, r.unitid, r.arrayName)], null]);
    }
  }
}

flow.set("flow", flowData);
return null;
