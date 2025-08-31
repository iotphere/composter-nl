const flowData = flow.get("flow");
const digitalChannels = flowData.config.io.digital_inputs.channels;
const runtime = flowData.runtime;

const m = msg.payload;
if (typeof m !== "object") return null;

const key = m.params?.type;
const val = m.params?.val;
if (typeof key !== "string" || (val !== "on" && val !== "off")) return null;

const channelDef = digitalChannels[key];
if (!channelDef || !channelDef.pro) return null;

// Ortak alarm anahtarı
const [commonKey] = Object.keys(channelDef.pro);
const expectedVal = channelDef.pro[commonKey];
if (!commonKey) return null;

// Sadece iki kural
let newVal = null;
if (val === "on" && expectedVal === "off" && runtime[commonKey].val === "on") {
    newVal = "off";
} else if (val === "off" && expectedVal === "on" && runtime[commonKey].val === "off") {
    newVal = "on";
}

if (!newVal) return null;

runtime[commonKey].val = newVal;
flow.set("flow", flowData);

return [[{
    payload: {
        method: "evt",
        params: { type: commonKey, val: newVal }
    }
}]];
