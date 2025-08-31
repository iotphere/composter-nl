const flowData = flow.get("flow");
const digitalChannels = flowData.config.io.digital_inputs.channels;
const runtime = flowData.runtime;

const m = msg.payload;
if (typeof m !== "object") return null;

const key = m.params?.type;
const val = m.params?.val;
if (typeof key !== "string" || (val !== "on" && val !== "off")) return null;

const digitalDef = digitalChannels[key];
if (!digitalDef || !digitalDef.pro) return null;

// pro objesindeki tek ortak anahtar
const commonAlarmKey = Object.keys(digitalDef.pro)[0];
const expectedVal = digitalDef.pro[commonAlarmKey];

if (!commonAlarmKey) return null;

const currentVal = runtime[commonAlarmKey]?.val;
let newVal = null;

// Kural 1: pro[key] === "off" ve runtime === "on" → "off"
if (expectedVal === "off" && currentVal === "on") {
    newVal = "off";
}

// Kural 2: pro[key] === "on" ve runtime === "off" → "on"
if (expectedVal === "on" && currentVal === "off") {
    newVal = "on";
}

// Eğer bir değişim yoksa çık
if (!newVal) return null;

// Runtime güncelle ve mesaj gönder
runtime[commonAlarmKey].val = newVal;
flow.set("flow", flowData);

return [[{
    payload: {
        method: "evt",
        params: { type: commonAlarmKey, val: newVal }
    }
}]];
