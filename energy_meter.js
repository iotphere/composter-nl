const flowData = flow.get("flow");
const channels = flowData.config.energy_meter.channels;

// Giriş verisi: [<number>, <number>, ...]
const rawVals = msg.payload;
if (!Array.isArray(rawVals)) return null;

const results = [];
const lastVals = context.get("lastVals") || {};

for (const [key, def] of Object.entries(channels)) {
    const index = def.map;
    let raw = rawVals[index];
    if (typeof raw !== "number") continue;

    // Çarpan uygula (ör: factor)
    if (def.factor) {
        raw *= def.factor;
    }

    raw = parseFloat(raw.toFixed(3));

    const last = lastVals[key];
    const diff = (last !== undefined) ? Math.abs(raw - last) : Infinity;

    if (diff >= (def.change ?? 0)) {
        // Node context'e son değeri yaz
        lastVals[key] = raw;

        // Flow context runtime'a yaz
        flowData.runtime[key].val = raw;
        flow.set("flow", flowData);

        // Mesaj oluştur
        results.push({
            payload: {
                method: "evt",
                params: {
                    type: key,
                    val: raw
                }
            }
        });
    }
}

// Güncellenmiş son değerleri sakla
context.set("lastVals", lastVals);

if (results.length === 0) return null;
return [results];
