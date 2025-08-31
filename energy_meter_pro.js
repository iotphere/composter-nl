const flowData = flow.get("flow");
const energyChannels = flowData.config.energy_meter.channels;
const runtime = flowData.runtime;

const m = msg.payload;
if (typeof m !== "object") return null;

const key = m.params?.type;
const val = m.params?.val;
if (typeof key !== "string" || typeof val !== "number") return null;

const channelDef = energyChannels[key];
if (!channelDef || !channelDef.pro) return null;

const changed = [];

for (const [detectorKey, thresholds] of Object.entries(channelDef.pro)) {
    if (!thresholds || typeof thresholds.on !== "number" || typeof thresholds.off !== "number") continue;

    const prevVal = runtime[detectorKey]?.val ?? "off";
    let newVal = null;

    // Kural 1: runtime off + val >= on → on
    if (prevVal === "off" && val >= thresholds.on) {
        newVal = "on";
    }
    // Kural 2: runtime on + val <= off → off
    else if (prevVal === "on" && val <= thresholds.off) {
        newVal = "off";
    }

    if (newVal && newVal !== prevVal) {
        runtime[detectorKey] = { val: newVal };
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
