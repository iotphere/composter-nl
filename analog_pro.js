const flowData = flow.get("flow");
const analogChannels = flowData.config.io.analog_inputs.channels;
const runtime = flowData.runtime;

const m = msg.payload;
if (typeof m !== "object") return null;

const key = m.params?.type;
const val = m.params?.val;
if (typeof key !== "string" || typeof val !== "number") return null;

const analogDef = analogChannels[key];
if (!analogDef || !analogDef.pro) return null;

const changed = [];

for (const [detectorKey, thresholds] of Object.entries(analogDef.pro)) {
    if (!thresholds || typeof thresholds.on !== "number" || typeof thresholds.off !== "number") continue;

    const prevVal = runtime[detectorKey]?.val ?? "off";

    // Minimal değişim mantığı: sadece eşik geçildiğinde tersine çevir
    let newVal = prevVal;
    if (prevVal === "off" && val >= thresholds.on) newVal = "on";
    else if (prevVal === "on" && val <= thresholds.off) newVal = "off";

    if (newVal !== prevVal) {
        runtime[detectorKey].val = newVal;
        flow.set("flow", flowData);

        changed.push({
            payload: {
                method: "evt",
                params: { type: detectorKey, val: newVal }
            }
        });
    }
}

return changed.length ? [changed] : null;
