const flowData = flow.get("flow");
const analogInputs = flowData.config.io.analog_inputs;
const channels = analogInputs.channels;

// Giriş verisi: [<number>, <number>, ...]
const rawVals = msg.payload;
if (!Array.isArray(rawVals)) return null;

const results = [];
const lastVals = context.get("lastVals") || {};

for (const [key, def] of Object.entries(channels)) {
    const index = def.map;
    const raw = rawVals[index];
    if (typeof raw !== "number") continue;

    // factor varsa uygula
    const factor = (typeof def.factor === "number") ? def.factor : 1;
    const rawEff = raw * factor;

    let scaled = rawEff;
    if (def.scale) {
        const { in_min, in_max, out_min, out_max } = def.scale;
        scaled = ((rawEff - in_min) / (in_max - in_min)) * (out_max - out_min) + out_min;
    }
    scaled = parseFloat(scaled.toFixed(3));

    const last = lastVals[key];
    const diff = (last !== undefined) ? Math.abs(scaled - last) : Infinity;

    if (diff >= (def.change ?? 0)) {
        // Node context'te sakla
        lastVals[key] = scaled;

        // Flow runtime'a yaz
        flowData.runtime[key].val = scaled;
        flow.set("flow", flowData);

        // Mesaj oluştur
        results.push({
            payload: {
                method: "evt",
                params: {
                    type: key,
                    val: scaled
                }
            }
        });
    }
}

// Güncellenmiş son değerleri sakla
context.set("lastVals", lastVals);

if (results.length === 0) return null;
return [results];
