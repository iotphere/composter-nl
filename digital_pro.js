const flowData = flow.get("flow");
const digitalChannels = flowData.config.io.digital_inputs.channels;
const runtime = flowData.runtime;

const m = msg.payload;
if (typeof m !== "object") return null;

const key = m.params?.type;
const val = m.params?.val;
if (typeof key !== "string" || (val !== "on" && val !== "off")) return null;

const digitalDef = digitalChannels[key];
if (!digitalDef || !digitalDef.pro) return null;

// Ortak alarm anahtarı (pro objesindeki ilk key)
const commonAlarmKeys = Object.keys(digitalDef.pro);
if (commonAlarmKeys.length === 0) return null;
const commonAlarmKey = commonAlarmKeys[0];

// Bireysel girişlerin runtime güncellemesi ve mesaj çıkışı yok (diger nod yapıyor)

// Şimdi aynı ortak alarm anahtarına sahip tüm kanalları bulalım
const relatedKeys = [];
for (const [chanKey, chanDef] of Object.entries(digitalChannels)) {
  if (chanDef.pro && Object.keys(chanDef.pro).includes(commonAlarmKey)) {
    relatedKeys.push(chanKey);
  }
}

// runtime’dan bu ilgili kanalların değerlerini al
// Burada beklenen pro objesi tek bir key-value, örn {oxygen_detector_dig: "off"} ya da {"on"}
// bu yüzden değerlerine göre karar veriyoruz

let newCommonVal = runtime[commonAlarmKey]?.val ?? "off";

const offExists = relatedKeys.some(k => {
  return digitalChannels[k].pro[commonAlarmKey] === "off" && runtime[k]?.val === "off";
});

const onExists = relatedKeys.some(k => {
  return digitalChannels[k].pro[commonAlarmKey] === "on" && runtime[k]?.val === "on";
});

// Hysteresis kuralı
if (offExists) {
  newCommonVal = "off";
} else if (onExists) {
  newCommonVal = "on";
}

// Eğer değiştiyse runtime güncelle ve mesaj üret
if (newCommonVal !== runtime[commonAlarmKey]?.val) {
  runtime[commonAlarmKey].val = newCommonVal;
  flow.set("flow", flowData);

  return [[{
    payload: {
      method: "evt",
      params: { type: commonAlarmKey, val: newCommonVal },
    },
  }]];
}

return null;
