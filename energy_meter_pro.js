const flowData = flow.get("flow");
const runtime = flowData.runtime;
const channels = flowData.config.energy_meter.channels;

const m = msg.payload;
if (typeof m !== "object") return null;

const key = m.params?.type;
const val = m.params?.val;
if (typeof key !== "string" || typeof val !== "number") return null;

const chDef = channels[key];
if (!chDef || !chDef.pro) return null;

const changed = [];

for (const [detectorKey, thresholds] of Object.entries(chDef.pro)) {
    if (!thresholds || typeof thresholds.on !== "number" || typeof thresholds.off !== "number") continue;

    // runtime'da başlatılmamışsa başlat
    if (!runtime[detectorKey]) runtime[detectorKey] = { val: "off" };
    const prevVal = runtime[detectorKey].val;

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
