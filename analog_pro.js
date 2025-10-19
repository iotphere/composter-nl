const flowData = flow.get("flow");
const analogChannels = flowData.config.io.analog_inputs.channels;
const runtime = flowData.runtime;

const m = msg.payload;
if (typeof m !== "object") return null;

const key = m.params?.type;
const val = m.params?.val;
if (typeof key !== "string" || typeof val !== "number") return null;

const channelDef = analogChannels[key];
if (!channelDef || !channelDef.pro) return null;

const changed = [];

// örn. humidity.pro = { humidity_detector_ang: { low: 30, high: 60 } }
for (const [detectorKey, thresholds] of Object.entries(channelDef.pro)) {
    if (!thresholds || typeof thresholds.low !== "number" || typeof thresholds.high !== "number") continue;

    // 2 key oluştur: ..._ang_low ve ..._ang_high
    const lowKey = `${detectorKey}_low`;
    const highKey = `${detectorKey}_high`;

    // önce mevcut durumları oku
    const prevLow = runtime[lowKey]?.val ?? "on";
    const prevHigh = runtime[highKey]?.val ?? "on";

    let newLow = prevLow;
    let newHigh = prevHigh;

    // low alanı için kural: val < low → off, aksi → on
    if (val < thresholds.low) newLow = "off";
    else newLow = "on";

    // high alanı için kural: val > high → off, aksi → on
    if (val > thresholds.high) newHigh = "off";
    else newHigh = "on";

    // değişim varsa runtime'ı güncelle ve mesaj oluştur
    if (newLow !== prevLow) {
        runtime[lowKey] = { val: newLow };
        changed.push({
            payload: {
                method: "evt",
                params: { type: lowKey, val: newLow }
            }
        });
    }

    if (newHigh !== prevHigh) {
        runtime[highKey] = { val: newHigh };
        changed.push({
            payload: {
                method: "evt",
                params: { type: highKey, val: newHigh }
            }
        });
    }
}

// yalnızca değişiklik varsa flow context'i güncelle
if (changed.length) {
    flow.set("flow", flowData);
    return [changed];
}

return null;
