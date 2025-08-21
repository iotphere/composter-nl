const flowData = flow.get("flow");
const runtime = flowData.runtime;
const channels = flowData.config.energy_meter.channels;

// energy_meter'dan gelen tekil mesaj
const m = msg.payload;
if (typeof m !== "object") return null;

const key = m.params?.type;
const val = m.params?.val;
if (typeof key !== "string" || typeof val !== "number") return null;

const chDef = channels[key];
if (!chDef || !chDef.pro) return null;

const changed = [];

for (const [detectorKey, detector] of Object.entries(chDef.pro)) {
  if (
    typeof detector === "object" &&
    detector !== null &&
    typeof detector.on === "number" &&
    typeof detector.off === "number"
  ) {
    // runtime'da başlatılmamışsa başlat
    if (!runtime[detectorKey]) {
      runtime[detectorKey] = { val: "off" };
    }

    const prevVal = runtime[detectorKey].val;

    const newVal =
      prevVal === "on"
        ? val <= detector.off
          ? "off"
          : "on"
        : val >= detector.on
        ? "on"
        : "off";

    if (newVal !== prevVal) {
      runtime[detectorKey].val = newVal;
      flow.set("flow", flowData);

      changed.push({
        payload: {
          method: "evt",
          params: { type: detectorKey, val: newVal },
        },
      });
    }
  }
}

if (changed.length === 0) return null;

return [changed];
