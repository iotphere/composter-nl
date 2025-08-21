const flowData = flow.get("flow");
const analogChannels = flowData.config.io.analog_inputs.channels;
const runtime = flowData.runtime;

// analog_inputs'tan gelen tekil mesaj
const m = msg.payload;
if (typeof m !== "object") return null;

const key = m.params?.type;  // DEĞİŞTİRİLDİ: method → params.type
const val = m.params?.val;
if (typeof key !== "string" || typeof val !== "number") return null;

const analogDef = analogChannels[key];
if (!analogDef || !analogDef.pro) return null;

const changed = [];

for (const [detectorKey, detector] of Object.entries(analogDef.pro)) {
  if (
    typeof detector === "object" &&
    detector !== null &&
    typeof detector.on === "number" &&
    typeof detector.off === "number"
  ) {
    const prevVal = runtime[detectorKey]?.val ?? "off";

    // Durum değişikliği mantığı (hysteresis)
    const newVal =
      prevVal === "on"
        ? val <= detector.off
          ? "off"
          : "on"
        : val >= detector.on
        ? "on"
        : "off";

    if (newVal !== prevVal) {
      // runtime güncelle
      runtime[detectorKey].val = newVal;
      flow.set("flow", flowData);

      // Çıkış mesajı
      changed.push({
        payload: {
          method: "evt",
          params: { type: detectorKey, val: newVal },
        },
      });
    }
  }
}

// Değişiklik yoksa çıkış verme
return changed.length === 0 ? null : [changed];
