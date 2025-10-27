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
    if (currentState === "processing") {
      sendCmd("on", "walking_floor_counter");
    }
  }
  else if (type === "oxygen_detector_dig_high" && val === "off") {
    if (currentState === "processing") {
      sendCmd("off", "walking_floor_counter");
      sendCmd("off", "walking_floor");
      sendCmd("off", "fan_pwm");
    }
  }

} else if (method === "cmd") {

  if (target === "fsm") {

    if (type === "walking_floor_counter") {
      const n = Number(params?.val);
      if (Number.isFinite(n)) {
        if (n > 0) {
          if (n % 2 === 0) sendCmd("forward", "walking_floor");
          else sendCmd("reverse", "walking_floor");
        } else {
          sendCmd("off", "walking_floor");
          sendCmd("on", "fan_pwm");
        }
      }
    }
    else if (type === "process") {
      if (runtime.oxygen_detector_dig_high?.val === "on") {
        sendCmd("on", "walking_floor_counter");
      } else {
        sendCmd("off", "walking_floor_counter");
        sendCmd("off", "walking_floor");
        sendCmd("off", "fan_pwm");
      }
      sendCmd("on", "water_valve_pwm");    
      sendCmd("on", "day_counter");
      transition("processing");

    }    
    else if (type === "dry") {      
      sendCmd("on", "fan_pwm");
      sendCmd("off", "water_valve_pwm");
      sendCmd("skip", "day_counter");
      transition("drying");
    }    
    else if (type === "complete") {
      sendCmd("off", "timers");
      sendCmd("off", "actuators");
      transition("completed");
    }

  } else {
    outputs[0].push(msg);
  }
}

return outputs;
