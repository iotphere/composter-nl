const ctx = context;
const flowData = flow.get("flow");

const labels = flowData.config.labels;
const digitalInputs = flowData.config.io.digital_inputs;
const channels = digitalInputs.channels;

// Giriş verisi: [<number>] şeklinde array
const rawVal = msg.payload?.[0];
if (typeof rawVal !== "number") return null;

// Hafıza başlat (bit geçmişi)
if (!ctx.get("history")) {
  ctx.set("history", {});
}
const history = ctx.get("history");

// Değişen input'lar buraya
const changed = [];

for (const [key, def] of Object.entries(channels)) {
  const bitIndex = def.map;
  const bitVal = (rawVal >> bitIndex) & 1;
  const newVal = labels[String(bitVal === 1)]; // "true"/"false" string olarak erişim

  if (!history[key]) {
    history[key] = [newVal];
    // İlk seferde runtime'a yaz
    if (flowData.runtime[key].val !== newVal) {
      flowData.runtime[key].val = newVal;
      changed.push({
        payload: {
          method: "evt",
          params: { type: key, val: newVal }
        }
      });
    }
    continue;
  }

  const prevStates = history[key];
  prevStates.push(newVal);
  if (prevStates.length > 2) prevStates.shift();

  const [prev, curr] = prevStates;

  if (prev === curr && flowData.runtime[key].val !== curr) {
    flowData.runtime[key].val = curr;
    changed.push({
      payload: {
        method: "evt",
        params: { type: key, val: curr }
      }
    });
    history[key] = [curr];
  } else {
    history[key] = prevStates;
  }
}

ctx.set("history", history);

// Runtime'ı sadece değişiklik varsa yaz
if (changed.length > 0) {
  flow.set("flow", flowData);
  return [changed];
}

return null;
