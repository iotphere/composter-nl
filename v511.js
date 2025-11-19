/************************************************************
 * PLC (Single Function Node) — V511
 * - Day timer start echo sorunu çözülü (V42’den devralınmış).
 * - Walking floor:
 *   * 100 ms tick tabanlı encoder (walking_floor_timer).
 *   * position: center=0, forward++ / reverse--, off=değişmez.
 *   * Encoder reset ONLY: RPC {target:"walking_floor_encoder", type:"reset"}.
 *   * Auto cycling: entry → cycling → exit-center.
 *   * Entry kuralları (position’a göre ilk yön):
 *       0..+49      → forward
 *       ≥ +50       → reverse
 *       -1..-49     → reverse
 *       ≤ -50       → forward
 *     Dışarıda bile olsa önce [-max,+max] bandına girip oradan cycling’e bağlanır.
 *   * Auto exit: min_tours tamamlanmadan exit yok, sonra en kısa
 *     yoldan center’a gelip durur.
 *   * Auto + fan tam paralel:
 *       auto mode != "off" → fan ON
 *       auto mode == "off" → fan OFF
 *   * Manual RPC:
 *       - target:"walking_floor", type:"forward"/"reverse"/"off"
 *         * Auto ON iken forward/reverse IGNORE
 *         * type:"off" her zaman kabul, auto force stop + acil durdurma
 *       - target:"walking_floor_auto", type:"on"/"off"
 *         * FSM/oxygen durumundan bağımsız tetik
 *       - target:"walking_floor_encoder", type:"reset"
 *         * Sadece encoder pozisyonunu 0 yapar, auto’yu etkilemez
 * - ANALOG INPUTS:
 *   * change "static" olarak son stabil değere göre çalışıyor.
 *   * Yeterli değişim için 2 ardışık örnekte deadband dışı olma şartı.
 *   * pro detector’lar sadece bu filtreyi geçen stabil değeri kullanıyor.
 * - SINAMICS AUTO-RECOVER:
 *   * Ortak retry limiti: config.sinamics.fault_ack_retry (default 3).
 *   * Ortak enable flag: config.sinamics.fault_ack_enable (default true).
 *   * fault_ack_enable === false iken otomatik recover çalışmaz,
 *     sadece status telemetry güncellenir.
 * - RUNTIME:
 *   * timers.day_timer.val
 *   * walking_floor_auto.val ("on"/"off")
 *   * walking_floor_position.val (encoder pozisyonu)
 ************************************************************/

// ---------- micro utils ----------
const K   = context.get("kernel") || {};
const cfg = K.config || {};
K.runtime = K.runtime || {};
K.helpers = K.helpers || {};
const rt  = K.runtime;
const hp  = K.helpers;

const out = []; // single port: we push all messages here
const LABELS = (cfg.labels || { true: "on", false: "off" });

function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }

function ensure(o, pathArr) {
  let cur = o;
  for (const k of pathArr) {
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  return cur;
}

// ---------- telemetry & rpc ----------
function tel(obj, nested=false) {
  if (!obj || !Object.keys(obj).length) return;
  const formatted = {};
  for (const [k,v] of Object.entries(obj)) {
    if (v && typeof v === "object" && ("val" in v)) formatted[k] = v;
    else formatted[k] = { val: v };
  }
  const payload = nested ? { data: formatted } : formatted;
  out.push({ topic:"v1/devices/me/telemetry", payload });
}

function rpcResp(id, content) {
  out.push({ topic: "v1/devices/me/rpc/response/" + id, payload: content });
}

// ==========================================================
// [no self-loop] loop()
// ==========================================================
function loop(evt) {
  if (!evt || !evt.type) return;
  if (evt.type === "evt.din") {
    fsm_event_from_digital(evt.key, evt.val);
  }
  else if (evt.type === "cmd.power_on_delay") {
    sin_all_off_and_speed();
  }
}

// ==========================================================
// RELAYS
// ==========================================================
function relays_packAndSend() {
  const hpio = ensure(hp, ["io"]);
  const bank1 = ensure(hpio, ["relay_outputs_1"]);
  const bank2 = ensure(hpio, ["relay_outputs_2"]);
  if (!Array.isArray(bank1.last_write_array)) bank1.last_write_array = Array(8).fill(false);
  if (!Array.isArray(bank2.last_write_array)) bank2.last_write_array = Array(8).fill(false);

  const r1 = bank1.last_write_array;
  const r2 = bank2.last_write_array;
  const unit1 = cfg.io?.relay_outputs_1?.unitid ?? null;
  const unit2 = cfg.io?.relay_outputs_2?.unitid ?? null;
  const arrToWord = a => a.reduce((w,b,i)=> b ? (w|(1<<i)) : w, 0);

  if (unit1 != null) out.push({ topic:"relays", payload:{ value:arrToWord(r1), fc:6, unitid:unit1, address:128, quantity:1 }});
  if (unit2 != null) out.push({ topic:"relays", payload:{ value:arrToWord(r2), fc:6, unitid:unit2, address:128, quantity:1 }});
}
function relay_info(name){
  const ch1 = cfg.io?.relay_outputs_1?.channels?.[name];
  if (ch1) return { bank:1, bit:ch1.map, unitid: cfg.io.relay_outputs_1.unitid };
  const ch2 = cfg.io?.relay_outputs_2?.channels?.[name];
  if (ch2) return { bank:2, bit:ch2.map, unitid: cfg.io.relay_outputs_2.unitid };
  return null;
}
function relay_set(name, onOffBool) {
  const info = relay_info(name);
  if (!info) return;
  const arrKey = (info.bank === 1) ? "relay_outputs_1" : "relay_outputs_2";
  const container = ensure(hp, ["io", arrKey]);
  if (!Array.isArray(container.last_write_array)) container.last_write_array = Array(8).fill(false);
  container.last_write_array[info.bit] = !!onOffBool;
  setIfChanged(rt, ["io", arrKey, "channels"], name, LABELS[onOffBool], name);
}
function relays_reset({ preservePower=false, setPower=null }={}) {
  const hpio = ensure(hp, ["io"]);
  const bank1 = ensure(hpio, ["relay_outputs_1"]);
  const bank2 = ensure(hpio, ["relay_outputs_2"]);
  if (!Array.isArray(bank1.last_write_array)) bank1.last_write_array = Array(8).fill(false);
  if (!Array.isArray(bank2.last_write_array)) bank2.last_write_array = Array(8).fill(false);
  bank1.last_write_array.fill(false);
  bank2.last_write_array.fill(false);

  const chAll = { ...(cfg.io?.relay_outputs_1?.channels||{}), ...(cfg.io?.relay_outputs_2?.channels||{}) };
  for (const name of Object.keys(chAll)) {
    if (name === "power_contactor" && preservePower) continue;
    relay_set(name,false);
  }
  if (cfg.io?.relay_groups?.walking_floor) {
    setIfChanged(rt, ["io","relay_groups"], "walking_floor","off","walking_floor");
    for (const k of Object.keys(cfg.io.relay_groups.walking_floor)) relay_set(k,false);
  }
  if (cfg.io?.relay_groups?.roof) {
    setIfChanged(rt, ["io","relay_groups"], "roof","off","roof");
    for (const k of Object.keys(cfg.io.relay_groups.roof)) relay_set(k,false);
  }
  const pInfo = relay_info("power_contactor");
  if (pInfo) {
    let newPow;
    if (preservePower) {
      const prev = rt.io?.relay_outputs_2?.channels?.power_contactor?.val;
      newPow = (prev === "on");
    } else if (typeof setPower==="boolean") newPow=setPower; else newPow=false;
    relay_set("power_contactor", newPow);
  }
  relays_packAndSend();
}
function walking_floor_cmd(type) {
  const keys = Object.keys(cfg.io?.relay_groups?.walking_floor || {});
  if (keys.length<3) return;
  const motor = keys.find(k=>k.includes("motor"))||keys[0];
  const fwd   = keys.find(k=>k.includes("forward"))||keys[1];
  const rev   = keys.find(k=>k.includes("reverse"))||keys[2];
  relay_set(motor,false); relay_set(fwd,false); relay_set(rev,false);
  if (type==="forward"){ relay_set(motor,true); relay_set(fwd,true); }
  else if (type==="reverse"){ relay_set(motor,true); relay_set(rev,true); }
  setIfChanged(rt,["io","relay_groups"],"walking_floor",type,"walking_floor");
  relays_packAndSend();
}
function roof_cmd(type){
  const keys = Object.keys(cfg.io?.relay_groups?.roof||{});
  if (keys.length<2) return;
  const fwd=keys.find(k=>k.includes("forward"))||keys[0];
  const rev=keys.find(k=>k.includes("reverse"))||keys[1];
  relay_set(fwd,false); relay_set(rev,false);
  if (type==="forward") relay_set(fwd,true);
  else if (type==="reverse") relay_set(rev,true);
  setIfChanged(rt,["io","relay_groups"],"roof",type,"roof");
  relays_packAndSend();
}

// ==========================================================
// SINAMICS
// ==========================================================
function sin_address(){ return { wordAddr:99, speedAddr:100 }; }
function sin_speedToValue(spPct){
  const max=cfg.sinamics?.speed_max??16384;
  const sp=Number.isFinite(spPct)?clamp(spPct,0,100):100;
  return Math.round(sp/100*max);
}
function sin_write(unitid,address,value){
  out.push({ topic:"sinamics", payload:{ value,fc:6,unitid,address,quantity:1 }});
}
function sin_cmd(target,type){
  const ch=cfg.sinamics?.channels?.[target];
  if(!ch) return;
  const {wordAddr}=sin_address();
  const cmdWords=cfg.sinamics?.command_words||{};
  if(["forward","reverse","off"].includes(type)){
    const w=cmdWords[type];
    if(w!=null){
      sin_write(ch.unitid,wordAddr,w);
    }
  }
}
function sin_all_off_and_speed(){
  const {wordAddr,speedAddr}=sin_address();
  const cmdWords=cfg.sinamics?.command_words||{};
  for(const [name,ch] of Object.entries(cfg.sinamics?.channels||{})){
    if(cmdWords.off!=null) sin_write(ch.unitid,wordAddr,cmdWords.off);
    const sp=cfg.sinamics?.channels?.[name]?.speed_set_point ?? 100;
    sin_write(ch.unitid, speedAddr, sin_speedToValue(sp));
  }
}
function sin_fault_ack_all(){
  const {wordAddr}=sin_address();
  const set=cfg.sinamics?.command_words?.fault_ack_set;
  const res=cfg.sinamics?.command_words?.fault_ack_res;
  if(set==null||res==null) return;
  for(const [,ch] of Object.entries(cfg.sinamics?.channels||{})) sin_write(ch.unitid,wordAddr,set);
  for(const [,ch] of Object.entries(cfg.sinamics?.channels||{})) sin_write(ch.unitid,wordAddr,res);
}
function deepEqual(a,b){
  if(a===b) return true;
  if(!a || !b) return false;
  const ka=Object.keys(a), kb=Object.keys(b);
  if(ka.length!==kb.length) return false;
  for(const k of ka){
    if(typeof a[k]==="object" && typeof b[k]==="object"){
      if(!deepEqual(a[k],b[k])) return false;
    }else{
      if(a[k]!==b[k]) return false;
    }
  }
  return true;
}

const DEFAULT_FAULT_RETRY   = Number.isFinite(cfg.sinamics?.fault_ack_retry) ? cfg.sinamics.fault_ack_retry : 3;
const FAULT_ACK_ENABLED     = (cfg.sinamics?.fault_ack_enable !== false); // default:true

function desiredCmdFromStatus(stat){
  if (!stat || stat.work !== "on") return "off";
  return (stat.direction === "on") ? "forward" : "reverse";
}

function sin_evt_from_status(msg){
  const rawVal=Array.isArray(msg.payload)?msg.payload[0]:msg.payload;
  const unitid=msg.unitid??msg?.payload?.unitid??msg?.modbusRequest?.unitid;
  if(typeof rawVal!=="number"||unitid==null) return;

  let target=null;
  for(const [name,ch] of Object.entries(cfg.sinamics?.channels||{})){
    if(ch.unitid===unitid){ target=name; break; }
  }
  if(!target) return;

  const getBit=(v,i)=>( (v&(1<<i))!==0 );
  const map=cfg.sinamics?.status_word||{};
  const statusObj={};
  for(const [k,def] of Object.entries(map)) statusObj[k]=LABELS[getBit(rawVal,def.map)];

  const hch = ensure(hp, ["sinamics","channels",target]);
  if (typeof hch.fault_retry !== "number") hch.fault_retry = DEFAULT_FAULT_RETRY;

  const rroot=ensure(rt,["sinamics","channels"]);
  const prev = rroot[target]?.val || null;

  const changed = !prev || !deepEqual(prev, statusObj);
  if (changed){
    ensure(rroot,[target]);
    rroot[target].val = statusObj;
    tel({ [target]: { val: statusObj } });
  }

  // Fault ON → opsiyonel auto-recover
  if (statusObj.fault === "on") {
    // Auto-recover disable ise: sadece retry sayaç resetle ve çık
    if (!FAULT_ACK_ENABLED) {
      hch.fault_retry = DEFAULT_FAULT_RETRY;
      return;
    }

    const { wordAddr } = sin_address();
    const cmdWords = cfg.sinamics?.command_words || {};
    const ch = cfg.sinamics?.channels?.[target];
    if (!ch) return;

    const lastHealthy = hch.lastHealthy && hch.lastHealthy.fault === "off"
      ? hch.lastHealthy
      : (prev && prev.fault === "off" ? prev : { work:"off", fault:"off", warning:"off", direction:"on" });

    if (hch.fault_retry > 0) {
      if (cmdWords.fault_ack_set != null) {
        sin_write(ch.unitid, wordAddr, cmdWords.fault_ack_set);
      }
      const cmdType = desiredCmdFromStatus(lastHealthy);
      if (["forward","reverse","off"].includes(cmdType) && cmdWords[cmdType] != null) {
        sin_write(ch.unitid, wordAddr, cmdWords[cmdType]);
      }
      hch.fault_retry -= 1;
    }
  } else {
    // Fault OFF → bu durumu "sağlıklı" say ve retry resetle
    hch.lastHealthy = statusObj;
    hch.fault_retry = DEFAULT_FAULT_RETRY;
  }
}

// ==========================================================
// DIGITAL INPUTS
// ==========================================================
function setIfChanged(obj, pathArr, key, newVal, telemetryKey) {
  const bucket = ensure(obj, pathArr);
  const prev = bucket[key]?.val;
  if (prev !== newVal) {
    bucket[key] = { val: newVal };
    if (telemetryKey) tel({ [telemetryKey]: newVal });
    return true;
  }
  return false;
}

function handle_digital_inputs(msg){
  const channels=cfg.io?.digital_inputs?.channels||{};
  const raw=Array.isArray(msg.payload)?msg.payload[0]:msg.payload;
  if(typeof raw!=="number") return;
  const hroot=ensure(hp,["io","digital_inputs","channels"]);
  const rroot=ensure(rt,["io","digital_inputs","channels"]);
  for(const [key,def] of Object.entries(channels)){
    const bit=!!((raw>>def.map)&1);
    const label=LABELS[bit];
    if(!hroot[key]) hroot[key]={history:[]};
    const hist=hroot[key].history;
    hist.push(label);
    if(hist.length>2) hist.shift();
    if(hist.length===2&&hist[0]===hist[1]){
      const prev=rroot[key]?.val;
      if(prev!==hist[1]){
        rroot[key]={val:hist[1]};
        tel({[key]:hist[1]});
        loop({type:"evt.din", key, val:hist[1]});
      }
    }
  }
}

// ==========================================================
// ANALOG INPUTS  (static change + 2-sample debounce + pro)
// ==========================================================
function handle_analog_inputs(msg){
  const arr=msg.payload; if(!Array.isArray(arr)) return;
  const channels=cfg.io?.analog_inputs?.channels||{};
  const hroot=ensure(hp,["io","analog_inputs","channels"]);
  const rroot=ensure(rt,["io","analog_inputs","channels"]);

  for(const [key,def] of Object.entries(channels)){
    const i=def.map; if(!Number.isFinite(arr[i])) continue;
    let v=arr[i];

    if(Number.isFinite(def.factor)) v*=def.factor;
    if(def.scale){
      const {in_min,in_max,out_min,out_max}=def.scale;
      v=((v-in_min)/(in_max-in_min))*(out_max-out_min)+out_min;
    }
    v=Number.parseFloat(v.toFixed(3));

    let hch = hroot[key];
    if (!hch) {
      hch = {};
      hroot[key] = hch;
    }

    if (hch.lastStable == null && typeof hch.lastVal === "number") {
      hch.lastStable = hch.lastVal;
    }

    const chg = def.change ?? 0;

    // change <= 0 → her değişikliği al
    if (!(chg > 0)) {
      const prev = rroot[key]?.val;
      if (prev !== v) {
        rroot[key] = { val: v };
        tel({ [key]: v });
        if (def.pro) {
          for (const [det,th] of Object.entries(def.pro)) {
            if (!th || !Number.isFinite(th.low) || !Number.isFinite(th.high)) continue;
            const lowKey  = det + "_low";
            const highKey = det + "_high";
            const prevL = rroot[lowKey]?.val ?? "on";
            const prevH = rroot[highKey]?.val ?? "on";
            const newL = (v < th.low)  ? "off" : "on";
            const newH = (v > th.high) ? "off" : "on";
            if (newL !== prevL) {
              rroot[lowKey] = { val: newL };
              tel({ [lowKey]: newL });
              loop({ type:"evt.din", key:lowKey, val:newL });
            }
            if (newH !== prevH) {
              rroot[highKey] = { val: newH };
              tel({ [highKey]: newH });
              loop({ type:"evt.din", key:highKey, val:newH });
            }
          }
        }
      }
      continue;
    }

    // change > 0: STATIC deadband + 2-sample debounce
    let stable = (typeof hch.lastStable === "number")
      ? hch.lastStable
      : (typeof rroot[key]?.val === "number" ? rroot[key].val : null);

    if (stable == null) {
      // İlk stabil değer
      hch.lastStable = v;
      rroot[key] = { val: v };
      tel({ [key]: v });

      if (def.pro) {
        for (const [det,th] of Object.entries(def.pro)) {
          if (!th || !Number.isFinite(th.low) || !Number.isFinite(th.high)) continue;
          const lowKey  = det + "_low";
          const highKey = det + "_high";
          const newL = (v < th.low)  ? "off" : "on";
          const newH = (v > th.high) ? "off" : "on";
          rroot[lowKey] = { val: newL };
          rroot[highKey] = { val: newH };
          tel({ [lowKey]: newL, [highKey]: newH });
        }
      }
      continue;
    }

    const diff = v - stable;

    if (Math.abs(diff) < chg) {
      hch.pending   = null;
      hch.pendingOk = false;
      continue;
    }

    if (!hch.pendingOk) {
      hch.pending   = v;
      hch.pendingOk = true;
      continue;
    }

    hch.lastStable = v;
    hch.pending    = null;
    hch.pendingOk  = false;

    rroot[key] = { val: v };
    tel({ [key]: v });

    if (def.pro) {
      for (const [det,th] of Object.entries(def.pro)) {
        if (!th || !Number.isFinite(th.low) || !Number.isFinite(th.high)) continue;
        const lowKey  = det + "_low";
        const highKey = det + "_high";
        const prevL = rroot[lowKey]?.val ?? "on";
        const prevH = rroot[highKey]?.val ?? "on";
        const newL = (v < th.low)  ? "off" : "on";
        const newH = (v > th.high) ? "off" : "on";
        if (newL !== prevL) {
          rroot[lowKey] = { val: newL };
          tel({ [lowKey]: newL });
          loop({ type:"evt.din", key:lowKey, val:newL });
        }
        if (newH !== prevH) {
          rroot[highKey] = { val: newH };
          tel({ [highKey]: newH });
          loop({ type:"evt.din", key:highKey, val:newH });
        }
      }
    }
  }
}

// ==========================================================
// ENERGY METER
// ==========================================================
function handle_energy_meter(msg){
  const arr=msg.payload; if(!Array.isArray(arr)) return;
  const kDef={map:0,factor:0.01,change:2};
  let v=arr[kDef.map]*kDef.factor;
  v=Number.parseFloat(v.toFixed(3));
  const hpen=ensure(hp,["energy"]);
  const last=(typeof hpen.kwh_last==="number")?hpen.kwh_last:null;
  if(last===null||Math.abs(v-last)>=kDef.change){
    hpen.kwh_last=v;
    setIfChanged(rt,[], "kwh",v,"kwh");
  }
}

// ==========================================================
// DAY TIMER (HARİCİ TRIGGER — FIXED, runtime.timers.day_timer.val)
// ==========================================================
// hp.day_timer_just_started = true → day_timer_start içinde set edilir

function day_timer_start() {
  const tcfg = cfg.timers?.day_timer || {};
  const base = Number.isFinite(tcfg.base) ? tcfg.base : 0;

  const rtDay = ensure(rt, ["timers","day_timer"]);
  rtDay.val = base;

  // ESKİ: tel({ day: base });
  // YENİ: runtime ile paralel: day_timer
  tel({ day_timer: rtDay.val });

  hp.day_timer_just_started = true;

  out.push({ topic: "day_timer", payload: "day_timer" });
}

function day_timer_stop() {
  const rtDay = ensure(rt, ["timers","day_timer"]);
  rtDay.val = 0;

  // ESKİ: tel({ day: 0 });
  // YENİ:
  tel({ day_timer: rtDay.val });

  hp.day_timer_just_started = false;

  out.push({ topic: "day_timer", reset: true, payload: "day_timer" });
}

function day_timer_tick() {
  const f = fsm_state();
  if (f.val !== "processing") return;

  if (hp.day_timer_just_started) {
    hp.day_timer_just_started = false;
    return;
  }

  const rtDay = ensure(rt, ["timers","day_timer"]);
  let day = Number(rtDay.val) || 0;
  if (day <= 0) return;

  day -= 1;
  rtDay.val = day;

  // ESKİ: tel({ day });
  // YENİ:
  tel({ day_timer: rtDay.val });

  if (day <= 0) {
    fsm_cmd({ type: "complete", reason: "day0" });
  }
}

// ==========================================================
// WALKING FLOOR ENCODER + AUTO CYCLING (V51)
// ==========================================================
//
// - walking_floor_timer: her 100 ms tick (inject node).
// - Encoder:
//     direction=forward → pos++
//     direction=reverse → pos--
//     direction=off     → değişmez
//   direction bilgisi: rt.io.relay_groups.walking_floor.val
//   center'da pos=0.
//   Pozisyon helpers.walking_floor.position içinde tutulur,
//   runtime.walking_floor_position.val üzerinden telemetry edilir.
// - Auto state machine (helpers.walking_floor.auto):
//     mode: "off" | "entry" | "cycling" | "exit_center"
//     exit_requested: bool
//     tours: tam tur sayısı (uçtan uca)
//     last_edge: +1 (forward_end), -1 (reverse_end), null
//     dir: son komut yönü ("forward"/"reverse"/"off")
// - RUNTIME:
//     rt.walking_floor_auto.val = "off" | "on"  (auto aktif/pasif)
//     rt.walking_floor_position.val = number (encoder pozisyonu)
// - Entry ilk yön kuralları (start anındaki position’a göre):
//     0 .. +max-1      → forward
//     ≥ +max           → reverse
//     -1 .. -(max-1)   → reverse
//     ≤ -max           → forward
// - Exit:
//     exit_requested = true
//     tours < min_tours → cycling'e devam
//     tours ≥ min_tours → mode="exit_center"
//     exit_center:
//        pos>0 → reverse
//        pos<0 → forward
//        pos=0 → OFF + fan OFF + auto kapalı + (gerekirse) shutdown finalize

function wf_helper() {
  return ensure(hp, ["walking_floor"]);
}
function wf_auto_state() {
  const h = wf_helper();
  if (!h.auto) {
    h.auto = { mode:"off", exit_requested:false, tours:0, last_edge:null, dir:null };
  }
  return h.auto;
}
function wf_get_position() {
  const h = wf_helper();
  if (typeof h.position !== "number") {
    const existing = rt.walking_floor_position?.val;
    h.position = (typeof existing === "number") ? existing : 0;
  }
  return h.position;
}
function wf_set_position(pos) {
  const h = wf_helper();
  h.position = pos;
  setIfChanged(rt, ["walking_floor_position"], "val", pos, "walking_floor_position");
}
function wf_encoder_reset() {
  wf_set_position(0);
}
function wf_limits() {
  const tcfg = cfg.timers?.walking_floor_loop_timer || {};
  const intervalSec = Number(tcfg.interval) || 10;
  const maxPos = Math.max(1, Math.round((intervalSec / 2) / 0.1)); // default: 10s → 50
  const minTours = Math.max(0, Number.isFinite(tcfg.min_tours) ? tcfg.min_tours : 0);
  return { maxPos, minTours };
}
function wf_update_auto_runtime() {
  const a = wf_auto_state();
  const state = (a.mode === "off") ? "off" : "on";
  setIfChanged(rt, ["walking_floor_auto"], "val", state, "walking_floor_auto");
}
function wf_is_active() {
  const a = wf_auto_state();
  return a.mode !== "off";
}
function wf_auto_start(source) {
  const a = wf_auto_state();
  if (a.mode !== "off") {
    // Zaten aktif → sadece exit isteğini iptal et, state "on" kalır
    a.exit_requested = false;
    wf_update_auto_runtime();
    return;
  }

  const pos = wf_get_position();
  const { maxPos } = wf_limits();

  // Entry başlangıç yönü (senin tablon):
  // 0..+49 → forward
  // ≥+50   → reverse
  // -1..-49→ reverse
  // ≤-50   → forward
  let dir;
  if (pos >= maxPos) {
    dir = "reverse";
  } else if (pos <= -maxPos) {
    dir = "forward";
  } else if (pos >= 0) {
    dir = "forward";
  } else {
    dir = "reverse";
  }

  a.mode = "entry";
  a.exit_requested = false;
  a.tours = 0;
  a.last_edge = null;
  a.dir = dir;

  wf_update_auto_runtime();

  // İlk hareket ve fan paralel
  if (dir === "forward" || dir === "reverse") {
    walking_floor_cmd(dir);
  } else {
    walking_floor_cmd("off");
  }
  // Fan auto süresince ON (yön önemli değil)
  sin_cmd("fan", "forward");
}
function wf_auto_request_exit() {
  const a = wf_auto_state();
  if (a.mode === "off") return;
  a.exit_requested = true;
  wf_update_auto_runtime();
}
function wf_auto_force_stop() {
  const a = wf_auto_state();
  a.mode = "off";
  a.exit_requested = false;
  a.tours = 0;
  a.last_edge = null;
  a.dir = null;

  wf_update_auto_runtime();

  // Acil durdurma: walking floor ve fan tamamen kapalı
  walking_floor_cmd("off");
  sin_cmd("fan", "off");
}
function wf_after_auto_stopped() {
  // Yalnızca graceful exit-center sonrasında çağrılır.
  if (hp.shutdown_pending) {
    relays_reset({ preservePower: true });
    sin_all_off_and_speed();
    hp.shutdown_pending = false;
  }
}

// 100 ms tick handler
function walking_floor_timer_tick() {
  // 1) ENCODER: her tick, runtime yönüne göre pozisyonu güncelle
  const dirLabel = rt.io?.relay_groups?.walking_floor?.val || "off";
  let pos = wf_get_position();
  if (dirLabel === "forward") pos += 1;
  else if (dirLabel === "reverse") pos -= 1;
  wf_set_position(pos);

  // 2) AUTO CYCLING STATE MACHINE
  const a = wf_auto_state();
  const { maxPos, minTours } = wf_limits();

  if (a.mode === "off") {
    wf_update_auto_runtime();
    return; // auto devre dışı → encoder yalnız çalışıyor
  }

  wf_update_auto_runtime(); // mode != off → runtime.walking_floor_auto = "on"

  let desiredDir = a.dir || "off";

  // ENTRY: her durumda önce -max..+max bandına sokmaktan sorumlu
  if (a.mode === "entry") {
    if (pos > maxPos) {
      desiredDir = "reverse";
    } else if (pos < -maxPos) {
      desiredDir = "forward";
    } else {
      // Artık bandın içindeyiz → cycling'e bağlan
      a.mode = "cycling";
      if (pos >= maxPos)      a.last_edge = +1;
      else if (pos <= -maxPos) a.last_edge = -1;
      desiredDir = a.dir || desiredDir || "forward";
    }
  }
  else if (a.mode === "cycling") {
    // Exit isteği ve yeterli tur sayısı varsa → exit_center
    if (a.exit_requested && a.tours >= minTours) {
      a.mode = "exit_center";
    } else {
      const prevEdge = a.last_edge;
      if (pos >= maxPos) {
        if (prevEdge === -1) {
          a.tours += 1; // -max → +max tam tur
        }
        a.last_edge = +1;
        desiredDir = "reverse";
      } else if (pos <= -maxPos) {
        if (prevEdge === +1) {
          a.tours += 1; // +max → -max tam tur
        }
        a.last_edge = -1;
        desiredDir = "forward";
      } else {
        // Uçta değilsek mevcut yönü koru
        desiredDir = a.dir || desiredDir || "forward";
      }
    }
  }

  if (a.mode === "exit_center") {
    if (pos > 0) {
      desiredDir = "reverse";
    } else if (pos < 0) {
      desiredDir = "forward";
    } else {
      // center'a geldik → tamamen durdur
      desiredDir = "off";
      a.mode = "off";
      a.exit_requested = false;
      a.tours = 0;
      a.last_edge = null;
      a.dir = null;

      walking_floor_cmd("off");
      sin_cmd("fan", "off");

      wf_update_auto_runtime();
      wf_after_auto_stopped();
      return;
    }
  }

  // Komut uygula
  if (desiredDir !== a.dir) {
    a.dir = desiredDir;
    if (desiredDir === "off") {
      walking_floor_cmd("off");
    } else {
      walking_floor_cmd(desiredDir);
    }
  }
}

// ==========================================================
// FSM
// ==========================================================
function fsm_state(){ if(!rt.fsm) rt.fsm = { val:"completed" }; return rt.fsm; }
function fsm_transition(to){
  const f=fsm_state();
  if (f.val !== to) { f.val = to; tel({ fsm: to }); }
}

function fsm_event_from_digital(key, val) {
  const st = fsm_state().val;
  const lowKey  = "oxygen_detector_dig_low";
  const highKey = "oxygen_detector_dig_high";

  if (st !== "processing") return;

  if (key === lowKey && val === "off") {
    // Oksijen LOW → auto cycling başlat (fan paralel, encoder reset YOK)
    wf_auto_start("oxygen");
  }

  if (key === highKey && val === "off") {
    // Oksijen HIGH → auto cycling için exit isteği
    wf_auto_request_exit();
    // Fan, exit-center tamamlanana kadar ON kalır, exit_center sonunda OFF yapılır.
  }
}

function fsm_complete_common() {
  const st = fsm_state().val;
  fsm_transition("completed");

  day_timer_stop();

  if (wf_is_active()) {
    hp.shutdown_pending = true;
    wf_auto_request_exit();
  } else {
    relays_reset({ preservePower: true });
    sin_all_off_and_speed();
    hp.shutdown_pending = false;
  }
}

function fsm_cmd(cmd) {
  const type = cmd?.type;
  if (!type) return;

  if (type === "process") {

    day_timer_stop();
    // Yeni process: auto varsa temiz başlamak için durdur
    wf_auto_force_stop();
    hp.shutdown_pending = false;

    fsm_transition("processing");

    // Artık encoder reset YOK, sadece kullanıcı RPC reset ile yapabilir
    day_timer_start();

    const digHigh = rt.io?.digital_inputs?.channels?.oxygen_detector_dig_high?.val || "on";

    if (digHigh === "on") {
      // Oksijen uygunsa hemen auto başlat (entry’den)
      wf_auto_start("fsm");
    } else {
      // Oksijen yüksek → fan kapalı, walking floor off
      sin_cmd("fan", "off");
      walking_floor_cmd("off");
    }
  }
  else if (type === "complete") {
    fsm_complete_common();
  }
}

// ==========================================================
// RPC & POWER-ON
// ==========================================================
function handle_rpc(msg){
  const id=(msg.topic||"").split("/").pop();
  let p=msg.payload;
  try{ if(typeof p==="string") p=JSON.parse(p); }catch(e){}
  const method=p?.method;
  const params=p?.params||{};

  if(method==="cmd"){
    const {target,type} = params;

    if (target==="fsm") {
      fsm_cmd({ type, val: params?.val });
    }
    else if (target==="walking_floor") {
      // Manuel komutlar
      const autoActive = wf_is_active();

      if (type === "off") {
        // Tek gerçek acil durdurma: auto varsa da yoksa da her zaman çalışır
        wf_auto_force_stop();
      }
      else if (type === "forward" || type === "reverse") {
        // Auto ON iken manuel yön komutları yok sayılır
        if (!autoActive) {
          walking_floor_cmd(type);
        }
      }
      // Diğer type değerleri (örn. bilinmeyen) ignore
    }
    else if (target==="walking_floor_auto") {
      // Auto cycling’i RPC ile kontrol et (FSM/oxygen’den bağımsız tetik)
      if (type === "on") {
        wf_auto_start("rpc");
      } else if (type === "off") {
        wf_auto_request_exit();
        // Fan, exit-center tamamlanana kadar ON kalır
      }
    }
    else if (target==="walking_floor_encoder" && type==="reset") {
      // Yeni merkez: sadece encoder pozisyonunu 0 yap
      wf_encoder_reset();
    }
    else if (target==="roof") {
      roof_cmd(type);
    }
    else if (cfg.io?.relay_outputs_1?.channels?.[target] || cfg.io?.relay_outputs_2?.channels?.[target]) {
      const onOff = (type === "on");
      relay_set(target, onOff);
      relays_packAndSend();
    }
    else if (target==="power") {
      if (type==="off") {
        relays_reset({ setPower:false });
      } else if (type==="on") {
        relays_reset({ setPower:true });
        out.push({ topic:"power_on_delay", payload:{ type:"cmd.power_on_delay" } });
      }
    }
    else if (cfg.sinamics?.channels?.[target]) {
      sin_cmd(target,type);
    }
    else if (target==="sinamics" && type==="fault_ack") {
      sin_fault_ack_all();
    }

    rpcResp(id, { response: true });
    return;
  }

  if (typeof method === "string" && method.startsWith("get.")) {
    const path = method.split(".").slice(1);
    let cur = { config: cfg, runtime: rt, helpers: hp };
    for (const k of path) { cur = (cur && cur[k] !== undefined) ? cur[k] : undefined; }
    rpcResp(id, { value: cur ?? null });
    return;
  }

  if (typeof method === "string" && method.startsWith("set.")) {
    const path = method.split(".").slice(1);
    let cur = { config: cfg, runtime: rt, helpers: hp };
    for (let i=0;i<path.length-1;i++){
      const k = path[i];
      if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
      cur = cur[k];
    }
    cur[path[path.length-1]] = params?.value;

    if (path.length===5 &&
        path[0]==="config" && path[1]==="sinamics" && path[2]==="channels" &&
        path[4]==="speed_set_point") {
      const target = path[3];
      const ch = cfg.sinamics?.channels?.[target];
      const sp = Number(params?.value);
      if (ch && Number.isFinite(sp)) {
        const { speedAddr } = sin_address();
        sin_write(ch.unitid, speedAddr, sin_speedToValue(sp));
      }
    }

    rpcResp(id, { response: true });
    return;
  }

  rpcResp(id, { error: "unknown method" });
}

function handle_power_on(){
  relays_reset({ setPower:true });
  out.push({ topic:"power_on_delay", payload:{ type:"cmd.power_on_delay" } });
}

// ==========================================================
// MAIN DISPATCH
// ==========================================================
switch (msg.topic) {
  case "digital_inputs":        handle_digital_inputs(msg);   break;
  case "analog_inputs":         handle_analog_inputs(msg);    break;
  case "energy_meter":          handle_energy_meter(msg);     break;
  case "sinamics":              sin_evt_from_status(msg);     break;
  case "power_on":              handle_power_on();            break;
  case "power_on_delay":        sin_all_off_and_speed();      break;

  case "day_timer":             day_timer_tick();             break;

  // 100 ms encoder + auto tick
  case "walking_floor_timer":   walking_floor_timer_tick();   break;

  default:
    if (typeof msg.topic === "string" && msg.topic.indexOf("v1/devices/me/rpc/request/") === 0) {
      handle_rpc(msg);
    }
    break;
}

context.set("kernel", K);
return [ out.length ? out : null ];
