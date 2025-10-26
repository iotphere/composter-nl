const flowData = flow.get("flow");
if (!flowData) return null;

const runtime = flowData.runtime || {};
const payload = msg.payload || {};
const { method, params } = payload;
const type = params?.type;
const val = params?.val;
const target = params?.target;
let currentState = runtime.fsm?.val;

const outputs = [[], []];

function transition(toState) {
  if (toState !== currentState) {
    currentState = toState;
    flowData.runtime.fsm.val = currentState;
    flow.set("flow", flowData);
    sendEvt("fsm", { val: currentState });
  }
}

function sendCmd(type, target, extraParams = {}) {
  const msg = {
    payload: {
      method: "cmd",
      params: { type, target, ...extraParams }
    }
  };
  outputs[0].push(msg);
}

function sendEvt(type, extraParams = {}) {
  const msg = {
    payload: {
      method: "evt",
      params: { type, ...extraParams }
    }
  };
  outputs[1].push(msg);
}

// --- Ana mesaj işleme ---
if (method === "evt") {

  if (type === "oxygen_detector_dig_low" && val === "off") {
    if (currentState === "started") {
      sendCmd("on", "loader_counter");
    }
  }
  else if (type === "oxygen_detector_dig_high" && val === "off") {
    if (currentState === "started") {
      sendCmd("off", "loader_counter");
      sendCmd("off", "loader");
      sendCmd("off", "fan_pwm");
    }
  }

} else if (method === "cmd") {

  if (target === "fsm") {

    if (type === "loader_counter") {
      const n = Number(params?.val);
      if (Number.isFinite(n)) {
        if (n > 0) {
          if (n % 2 === 0) sendCmd("forward", "loader");
          else sendCmd("reverse", "loader");
        } else {
          sendCmd("off", "loader");
          sendCmd("on", "fan_pwm");
        }
      }
    }
    else if (type === "start") {
      if (runtime.oxygen_detector_dig_high?.val === "on") {
        sendCmd("on", "loader_counter");
      } else {
        sendCmd("off", "loader_counter");
        sendCmd("off", "loader");
        sendCmd("off", "fan_pwm");
      }
      sendCmd("on", "water_valve_pwm");    
      sendCmd("on", "day_counter");
      transition("started");

    }    
    else if (type === "dry") {      
      sendCmd("on", "fan_pwm");
      sendCmd("off", "water_valve_pwm");
      sendCmd("skip", "day_counter");
      transition("drying");
    }    
    else if (type === "finish") {
      sendCmd("off", "timers");
      sendCmd("off", "actuators");
      transition("finished");
    }

  } else {
    outputs[0].push(msg);
  }
}

return outputs;
