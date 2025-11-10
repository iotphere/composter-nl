/************************************************************
 * PLC (Single Function Node) — V30
 * - v223 tabanlı
 * - Fault Recovery: sinamics status fault:"on" gelince
 *   * helpers.sinamics.channels.<ch>.fault_retry sayacı (config.sinamics.fault_ack_retry, yoksa 3)
 *   * ack-set (fault_ack_set) + önceki sağlıklı duruma (work/direction) göre komut (forward/reverse/off)
 *   * fault:"off" görülünce lastHealthy güncellenir ve sayaç resetlenir
 * - speed_set_point CONFIG altında; set.* ile yazılır, telemetry YOK (yalnız Modbus speed write)
 * - runtime.sinamics.channels.<ch>.val = {work,fault,warning,direction}
 *   * yalnız status değişince güncellenir ve telemetry çıkar
 * - fsm: { val: "..." } olarak tutulur
 * - plc_switch yok; loop() iç çağrı
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

function now(){ return Date.now(); }
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }

function toMs(val, unit) {
  const u = (unit || "s").toLowerCase();
  if (u === "ms")  return val;
  if (u === "s")   return val * 1000;
  if (u === "min") return val * 60000;
  if (u === "h")   return val * 3600000;
  if (u === "d")   return val * 86400000;
  return val * 1000;
}

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
  // telemetry payload’larını runtime benzeri {key:{val:...}} formunda üret
  if (!obj || !Object.keys(obj).length) return;
  const formatted = {};
  for (const [k,v] of Object.entries(obj)) {
    if (v && typeof v === "object" && ("val" in v)) {
      formatted[k] = v;            // zaten {val:...}
    } else {
      formatted[k] = { val: v };   // string/number -> {val:...}
    }
  }
  const payload = nested ? { data: formatted } : formatted;
  out.push({ topic:"v1/devices/me/telemetry", payload });
}

function rpcResp(id, content) {
  out.push({ topic: "v1/devices/me/rpc/response/" + id, payload: content });
}

// ==========================================================
// [no self-loop] loop(): iç yönlendirme
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
  // NOTE: hız artık cmd ile yönetilmiyor; yalnız set.* ile (aşağıdaki set hook)
  const ch=cfg.sinamics?.channels?.[target];
  if(!ch) return;
  const {wordAddr}=sin_address();
  const cmdWords=cfg.sinamics?.command_words||{};
  if(["forward","reverse","off"].includes(type)){
    const w=cmdWords[type];
    if(w!=null){
      sin_write(ch.unitid,wordAddr,w);
      // runtime güncellenmez; status getter değişince runtime & telemetry üretilecek
    }
  }
}
function sin_all_off_and_speed(){
  // OFF -> SPEED sırası (senin v223 düzenin korunuyor)
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

// ---- Fault Recovery helpers ----
const DEFAULT_FAULT_RETRY = Number.isFinite(cfg.sinamics?.fault_ack_retry) ? cfg.sinamics.fault_ack_retry : 3;
function desiredCmdFromStatus(stat){
  // stat: {work:"on/off", direction:"on/off"} -> "forward" | "reverse" | "off"
  if (!stat || stat.work !== "on") return "off";
  // direction bit: "on" -> forward, "off" -> reverse (basit ve belirgin sözleşme)
  return (stat.direction === "on") ? "forward" : "reverse";
}

function sin_evt_from_status(msg){
  // Modbus status word çözümle -> {work,fault,warning,direction} ve sadece değişimde runtime&telemetry
  const rawVal=Array.isArray(msg.payload)?msg.payload[0]:msg.payload;
  const unitid=msg.unitid??msg?.payload?.unitid??msg?.modbusRequest?.unitid;
  if(typeof rawVal!=="number"||unitid==null) return;

  let target=null;
  for(const [name,ch] of Object.entries(cfg.sinamics?.channels||{})){ if(ch.unitid===unitid){ target=name; break; } }
  if(!target) return;

  const getBit=(v,i)=>( (v&(1<<i))!==0 );
  const map=cfg.sinamics?.status_word||{};
  const statusObj={};
  for(const [k,def] of Object.entries(map)) statusObj[k]=LABELS[getBit(rawVal,def.map)];

  // helpers channel bucket
  const hch = ensure(hp, ["sinamics","channels",target]);
  if (typeof hch.fault_retry !== "number") hch.fault_retry = DEFAULT_FAULT_RETRY;
  // runtime önceki değer (karşılaştırma ve lastHealthy güncellemesi için)
  const rroot=ensure(rt,["sinamics","channels"]);
  const prev = rroot[target]?.val || null;

  // Runtime değişim varsa güncelle + telemetry
  const changed = !prev || !deepEqual(prev, statusObj);
  if (changed){
    ensure(rroot,[target]);
    rroot[target].val = statusObj;
    tel({ [target]: { val: statusObj } });
  }

  // ----- Fault handling -----
  if (statusObj.fault === "on") {
    // Fault ON: recovery denemesi
    const { wordAddr } = sin_address();
    const cmdWords = cfg.sinamics?.command_words || {};
    const ch = cfg.sinamics?.channels?.[target];
    if (!ch) return;

    // Son sağlıklı (fault:"off") durumumuz yoksa, prev içinde fault off olan son hal olabilir;
    // garantiye almak için helpers.lastHealthy yoksa "off" kabul et.
    const lastHealthy = hch.lastHealthy && hch.lastHealthy.fault === "off"
      ? hch.lastHealthy
      : (prev && prev.fault === "off" ? prev : { work:"off", fault:"off", warning:"off", direction:"on" });

    // Retry varsa ack-set + lastHealthy komutu gönder
    if (hch.fault_retry > 0) {
      // 1) fault ack set
      if (cmdWords.fault_ack_set != null) {
        sin_write(ch.unitid, wordAddr, cmdWords.fault_ack_set);
      }
      // 2) eski durumu yansıt (forward/reverse/off)
      const cmdType = desiredCmdFromStatus(lastHealthy);
      if (["forward","reverse","off"].includes(cmdType) && cmdWords[cmdType] != null) {
        sin_write(ch.unitid, wordAddr, cmdWords[cmdType]);
      }
      hch.fault_retry -= 1;
    }
    // Retry yoksa artık bir şey yapmıyoruz; sonraki fault off’da resetlenecek.
  } else {
    // Fault OFF: bu durumu "sağlıklı" olarak işaretle ve retry resetle
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
        loop({type:"evt.din", key, val:hist[1]}); // iç çağrı
      }
    }
  }
}

// ==========================================================
// ANALOG INPUTS + analog_pro thresholds
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

    if(!hroot[key]) hroot[key]={lastVal:null};
    const last=hroot[key].lastVal;
    const chg=def.change??0;

    if(last===null||Math.abs(v-last)>=chg){
      hroot[key].lastVal=v;
      rroot[key]={val:v};
      tel({[key]:v});

      // analog_pro türetilmiş dijitaller (varsa)
      if(def.pro){
        for(const [det,th] of Object.entries(def.pro)){
          if(!th || !Number.isFinite(th.low) || !Number.isFinite(th.high)) continue;
          const lowKey  = det + "_low";
          const highKey = det + "_high";
          const prevL=rroot[lowKey]?.val??"on";
          const prevH=rroot[highKey]?.val??"on";
          const newL=(v<th.low) ?"off":"on";
          const newH=(v>th.high)?"off":"on";
          if(newL!==prevL){
            rroot[lowKey]={val:newL};
            tel({[lowKey]:newL});
            loop({type:"evt.din", key:lowKey,  val:newL});
          }
          if(newH!==prevH){
            rroot[highKey]={val:newH};
            tel({[highKey]:newH});
            loop({type:"evt.din", key:highKey, val:newH});
          }
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
// TIMERS
// ==========================================================
function t_rt(name){ const root=ensure(rt,["timers"]); if(!root[name]) root[name]={state:"off"}; return root[name]; }

function timer_on(name, forcedCount=null) {
  const t = cfg.timers?.[name]; if (!t) return;
  const r = t_rt(name);
  r.state = "on";
  r.on_time = now();
  r.phase = null; r.phase_until = null; r.next_time = null;

  if (t.form === "delay") {
    r.done = false;
    r.phase_until = now() + toMs(t.duration, t.unit);
    timer_apply_phase(name, "a");
  }
  else if (t.form === "pwm") {
    r.phase = "a";
    r.phase_until = now() + toMs(t.t_duty, t.unit);
    timer_apply_phase(name, "a");
  }
  else if (t.form === "counter") {
    r.count = (forcedCount != null) ? forcedCount : t.base;
    r.next_time = now() + toMs(t.interval, t.unit);
    tel({ [name]: r.count });
    if (name === "day_counter") tel({ day: r.count });
  }
}

function timer_off(name) {
  const t = cfg.timers?.[name]; if (!t) return;
  const r = t_rt(name);
  r.state = "off";

  if (t.form === "delay") {
    r.done = true;
    timer_apply_phase(name, "b");
  }
  else if (t.form === "pwm") {
    r.phase = null;
    timer_apply_phase(name, "b");
  }
  else if (t.form === "counter") {
    r.count = 0;
    tel({ [name]: 0 });
    if (name === "day_counter") tel({ day: 0 });
  }

  r.on_time = r.next_time = r.phase_until = null;
  r.phase = null;
}

function timers_tick() {
  const nowt = now();
  for (const [name, t] of Object.entries(cfg.timers || {})) {
    const r = t_rt(name);
    if (r.state !== "on") continue;

    if (t.form === "delay") {
      if (!r.done && nowt >= r.phase_until) {
        r.done = true;
        timer_apply_phase(name, "b");
      }
    }
    else if (t.form === "pwm") {
      if (nowt >= r.phase_until) {
        if (r.phase === "a") {
          r.phase = "b";
          r.phase_until = nowt + toMs(t.t_cycle - t.t_duty, t.unit);
          timer_apply_phase(name, "b");
        } else {
          r.phase = "a";
          r.phase_until = nowt + toMs(t.t_duty, t.unit);
          timer_apply_phase(name, "a");
        }
      }
    }
    else if (t.form === "counter") {
      if (nowt >= r.next_time && r.count > 0) {
        r.count -= 1;
        r.next_time = nowt + toMs(t.interval, t.unit);
        tel({ [name]: r.count });

        if (name === "day_counter") {
          const sig = cfg.timers.day_counter.signal;
          if (sig != null && r.count === sig) fsm_cmd({ type: "dry" });
          if (r.count === 0) fsm_cmd({ type: "complete" });
          tel({ day: r.count });
        }
        else if (name === "walking_floor_counter") {
          fsm_cmd({ type: "walking_floor_counter", val: r.count });
          if (r.count === 0) timer_off("walking_floor_counter");
        }
      }
    }
  }
}

function timer_apply_phase(name, phase) {
  if (name === "fan_pwm") {
    if (phase === "a") sin_cmd("fan", "forward");
    else               sin_cmd("fan", "off");
  }
  else if (name === "water_valve_pwm") {
    if (phase === "a") relay_set("water_valve", true);
    else               relay_set("water_valve", false);
    relays_packAndSend();
  }
  else if (name === "light_pulse") {
    if (phase === "a") { relay_set("light", true); relays_packAndSend(); }
    else               { relay_set("light", false); relays_packAndSend(); }
  }
}

// ==========================================================
// FSM  (fsm:{val:"..."})
// ==========================================================
function fsm_state(){ if(!rt.fsm) rt.fsm = { val:"completed" }; return rt.fsm; }
function fsm_transition(to){
  const f=fsm_state();
  if (f.val !== to) { f.val = to; tel({ fsm: to }); }
}

function fsm_event_from_digital(key, val) {
  const st = fsm_state().val;
  if (key === "oxygen_detector_dig_low" && val === "off") {
    if (st === "processing") { timer_on("walking_floor_counter"); }
  } else if (key === "oxygen_detector_dig_high" && val === "off") {
    if (st === "processing") {
      timer_off("walking_floor_counter");
      walking_floor_cmd("off");
      timer_off("fan_pwm");
    }
  }
}

function fsm_cmd(cmd) {
  const type = cmd?.type;
  if (!type) return;

  if (type === "process") {
    const digHigh = rt.io?.digital_inputs?.channels?.oxygen_detector_dig_high?.val || "on";
    if (digHigh === "on") timer_on("walking_floor_counter");
    else {
      timer_off("walking_floor_counter");
      walking_floor_cmd("off");
      timer_off("fan_pwm");
    }
    timer_on("water_valve_pwm");
    timer_on("day_counter");
    fsm_transition("processing");
  }
  else if (type === "dry") {
    timer_on("fan_pwm");
    timer_off("water_valve_pwm");
    const sig = cfg.timers?.day_counter?.signal ?? null;
    timer_on("day_counter", sig);
    fsm_transition("drying");
  }
  else if (type === "complete") {
    for (const name of Object.keys(cfg.timers || {})) timer_off(name);
    relays_reset({ preservePower: true });
    sin_all_off_and_speed();
    fsm_transition("completed");
  }
  else if (type === "walking_floor_counter") {
    const n = Number(cmd?.val);
    if (Number.isFinite(n)) {
      if (n > 0) {
        if (n % 2 === 0) walking_floor_cmd("forward");
        else             walking_floor_cmd("reverse");
      } else {
        walking_floor_cmd("off");
        timer_on("fan_pwm");
      }
    }
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

    if (target==="fsm") { fsm_cmd({ type, val: params?.val }); }
    else if (target==="timers" && type==="off") { for (const n of Object.keys(cfg.timers||{})) timer_off(n); }
    else if (target==="actuators" && type==="off") { relays_reset({ preservePower:true }); sin_all_off_and_speed(); }
    else if (target==="walking_floor") { walking_floor_cmd(type); }
    else if (target==="roof") { roof_cmd(type); }
    else if (cfg.io?.relay_outputs_1?.channels?.[target] || cfg.io?.relay_outputs_2?.channels?.[target]) {
      // tekil röle kontrolü
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
    else if (target==="day_counter" && type==="skip") {
      const sig = cfg.timers?.day_counter?.signal ?? null;
      timer_on("day_counter", sig);
    }
    else if (cfg.sinamics?.channels?.[target]) { sin_cmd(target,type); } // speed YOK; sadece forward/reverse/off
    else if (target==="sinamics" && type==="fault_ack") { sin_fault_ack_all(); }

    rpcResp(id, { response: true });
    return;
  }

  // get.*  (kernel tamamına erişim)
  if (typeof method === "string" && method.startsWith("get.")) {
    const path = method.split(".").slice(1);
    let cur = { config: cfg, runtime: rt, helpers: hp };
    for (const k of path) { cur = (cur && cur[k] !== undefined) ? cur[k] : undefined; }
    rpcResp(id, { value: cur ?? null });
    return;
  }

  // set.*  (kernel tamamına yazma) + HOOK: speed_set_point -> Modbus speed write & NO telemetry
  if (typeof method === "string" && method.startsWith("set.")) {
    const path = method.split(".").slice(1); // ["config","sinamics","channels","fan","speed_set_point"]
    let cur = { config: cfg, runtime: rt, helpers: hp };
    for (let i=0;i<path.length-1;i++){
      const k = path[i];
      if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
      cur = cur[k];
    }
    cur[path[path.length-1]] = params?.value;

    // HOOK: speed_set_point mi?
    if (path.length===5 &&
        path[0]==="config" && path[1]==="sinamics" && path[2]==="channels" &&
        path[4]==="speed_set_point") {
      const target = path[3];
      const ch = cfg.sinamics?.channels?.[target];
      const sp = Number(params?.value);
      if (ch && Number.isFinite(sp)) {
        const { speedAddr } = sin_address();
        sin_write(ch.unitid, speedAddr, sin_speedToValue(sp));
        // Telemetry YOK; runtime dokunulmaz
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
  case "digital_inputs":   handle_digital_inputs(msg); break;
  case "analog_inputs":    handle_analog_inputs(msg);  break;
  case "energy_meter":     handle_energy_meter(msg);   break;
  case "sinamics":         sin_evt_from_status(msg);   break;
  case "timer":            timers_tick();              break;
  case "power_on":         handle_power_on();          break;
  case "power_on_delay":   sin_all_off_and_speed();    break;
  default:
    if (typeof msg.topic === "string" && msg.topic.indexOf("v1/devices/me/rpc/request/") === 0) {
      handle_rpc(msg);
    }
    break;
}

// persist & emit
context.set("kernel", K);

// SINGLE OUTPUT: multiple messages as an array on port#1
return [ out.length ? out : null ];
