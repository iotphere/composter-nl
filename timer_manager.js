const flowData = flow.get("flow");
const timers = flowData.config.timers;

const method = msg?.payload?.method || msg?.method;
const params = msg?.payload?.params || msg?.params || {};
const target = params.target;
const type = params.type;

const out = [[], [], []]; // Port 1,2,3
let runtime = context.get("runtime") || {};

function toMs(val, unit) {
  const map = { s: 1000, min: 60000, h: 3600000, d: 86400000 };
  return val * (map[unit] ?? 1000);
}

function pushMessage(timer, passKey, out, runtime = {}, target = null) {
  const entry = timer.pass?.[passKey];
  if (!entry) return;

  const message = RED.util.cloneMessage(entry);
  const port = (entry.port ?? 0) - 1;
  if (port < 0 || port > 2) return;

  delete message.port;

  if (message.params && target && runtime[target]) {
    for (const [key, val] of Object.entries(message.params)) {
      if (val === null && runtime[target][key] !== undefined) {
        message.params[key] = runtime[target][key];
      } else if (typeof val === "object" && val !== null && "val" in val) {
        message.params[key].val = runtime[target].count;
      }
    }

    if (timer.form === "counter" && passKey === 4 && message.params.val === undefined) {
      message.params.val = runtime[target].count;
    }
  }

  out[port].push({ payload: message });
}

function timerOn(timer, rt, now, out, target, forcedCount = null) {
  rt.state = "on";

  switch (timer.form) {
    case "delay":
      rt.on_time = now;
      rt.done = false;
      rt.phase_until = now + toMs(timer.duration, timer.unit);
      pushMessage(timer, 1, out);
      break;

    case "pwm":
      rt.on_time = now;
      rt.phase = "a";
      rt.phase_until = now + toMs(timer.t_duty, timer.unit);
      pushMessage(timer, 1, out);
      break;

    case "loop":
      rt.on_time = now;
      rt.next_time = now + toMs(timer.interval, timer.unit);
      pushMessage(timer, 1, out);
      break;

    case "counter":
      rt.on_time = now;
      rt.count = forcedCount !== null ? forcedCount : timer.base;
      rt.next_time = now + toMs(timer.interval, timer.unit);

      const entry4 = timer.pass?.[4];
      if (entry4) {
        entry4.params = entry4.params || {};
        // ÖNEMLİ: sabit değer atamak yerine val özelliğini sil
        // böylece pushMessage her seferinde runtime[target].count koyar
        delete entry4.params.val;
      }

      pushMessage(timer, 1, out, runtime, target);
      pushMessage(timer, 4, out, runtime, target);
      break;
  }
}

function timerOff(timer, rt, out, target, suppressMessages = false) {
  rt.state = "off";

  switch (timer.form) {
    case "delay":
      rt.done = true;
      if (!suppressMessages) pushMessage(timer, 2, out);
      break;

    case "pwm":
      rt.phase = null;
      if (!suppressMessages) pushMessage(timer, 2, out);
      break;

    case "loop":
      if (!suppressMessages) pushMessage(timer, 1, out);
      break;

    case "counter":
      rt.count = 0;
      if (!suppressMessages) {
        pushMessage(timer, 3, out, runtime, target);
        pushMessage(timer, 4, out, runtime, target);
      }

      // day_counter için evt day 0 mesajı her koşulda
      if (target === "day_counter") {
        out[2].push({
          payload: {
            method: "evt",
            params: { type: "day", val: 0 }
          }
        });
      }
      break;
  }

  // Genel reset: runtime içindeki yardımcı alanlar
  rt.on_time = null;
  rt.next_time = null;
  rt.phase_until = null;
  rt.phase = null;
}

function timerTick(timers, runtime, now, out) {
  for (const [key, timer] of Object.entries(timers)) {
    const rt = runtime[key];
    if (!rt || rt.state !== "on") continue;

    switch (timer.form) {
      case "delay":
        if (!rt.done && now >= rt.phase_until) {
          rt.done = true;
          pushMessage(timer, 2, out);
        }
        break;

      case "pwm":
        if (now >= rt.phase_until) {
          if (rt.phase === "a") {
            rt.phase = "b";
            rt.phase_until = now + toMs(timer.t_cycle - timer.t_duty, timer.unit);
            pushMessage(timer, 2, out);
          } else {
            rt.phase = "a";
            rt.phase_until = now + toMs(timer.t_duty, timer.unit);
            pushMessage(timer, 1, out);
          }
        }
        break;

      case "loop":
        if (now >= rt.next_time) {
          rt.next_time = now + toMs(timer.interval, timer.unit);
          pushMessage(timer, 1, out);
        }
        break;

      case "counter":
        if (now >= rt.next_time && rt.count > 0) {
          rt.count -= 1;
          rt.next_time = now + toMs(timer.interval, timer.unit);

          if (timer.signal !== undefined && rt.count === timer.signal) {
            pushMessage(timer, 2, out, runtime, key);
          }

          pushMessage(timer, 4, out, runtime, key);

          if (rt.count === 0) {
            rt.state = "off";
            pushMessage(timer, 3, out, runtime, key);

            // Son kalan gün evt day 0 mesajı
            if (key === "day_counter") {
              out[2].push({
                payload: {
                  method: "evt",
                  params: { type: "day", val: 0 }
                }
              });
            }

            // Reset runtime yardımcı alanlar
            rt.on_time = null;
            rt.next_time = null;
            rt.phase_until = null;
            rt.phase = null;
          }
        }
        break;
    }
  }
}

// --- CMD handling ---
if (method === "cmd") {
  // --- Special skip for day_counter ---
  if (type === "skip" && target === "day_counter") {
    if (!runtime[target]) runtime[target] = {};
    const rt = runtime[target];

    // day_counter'ı signal anına getir ve timerOn gibi başlat
    timerOn(timers[target], rt, Date.now(), out, target, timers[target].signal);

  } else if (timers[target]) {
    if (!runtime[target]) runtime[target] = {};
    if (type === "on") {
      timerOn(timers[target], runtime[target], Date.now(), out, target);
    } else if (type === "off") {
      timerOff(timers[target], runtime[target], out, target);
    }
  } else if (type === "off" && target === "timers") {
    for (const [key, timer] of Object.entries(timers)) {
      if (key === "telemetry_periodical") continue;
      if (!runtime[key]) runtime[key] = {};
      timerOff(timer, runtime[key], out, key, true);
    }
  } else {
    out[1].push(msg);
  }

} else if (method === "evt" && type === "timer_tick") {
  timerTick(timers, runtime, Date.now(), out);
} else {
  out[1].push(msg);
}

context.set("runtime", runtime);

return out.some(arr => arr.length) ? out : null;
