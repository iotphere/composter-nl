const flowData = flow.get("flow");
const runtime = flowData.runtime;
let currentState = runtime.fsm.state;

const payload = msg.payload;
if (!payload || typeof payload !== "object") return null;

const method = payload.method;
const params = payload.params || {};
const type = params.type;
const target = params.target;
const val = params.val;

const outputs = [[], []];

function transition(toState) {
  if (toState !== currentState) {
    currentState = toState;
    flowData.runtime.fsm.state = currentState;
    flow.set("flow", flowData);
    sendEvt("fsm", { state: currentState });
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

  if (type === "oxygen_detector_dig") {
    if (currentState === "start") {
      if (val === "off") {
        sendCmd("on", "fan_pwm");
      } else if (val === "on") {
        sendCmd("off", "fan_pwm");
      }
    }

  } else if (type === "humidity_detector_ang") {
    if (currentState === "start") {
      if (val === "off") {
        sendCmd("on", "water_pump_pwm");
      } else if (val === "on") {
        sendCmd("off", "water_pump_pwm");
      }
    }

  } else if (type === "roof_forward_limit") {
    if (val === "off") {
      sendCmd("off", "roof");
    }

  } else if (type === "roof_reverse_limit") {
    if (val === "off") {
      sendCmd("off", "roof");
    }

  } else if (type === "cabinet_door") {
    // boş

  } else if (type === "stop_button") {
    // boş
  }

} else if (method === "cmd") {

  if (target === "fsm") {

    if (type === "start") {
      if (runtime.oxygen_detector_dig.val === "off") {
        sendCmd("on", "fan_pwm");
      } else if (runtime.oxygen_detector_dig.val === "on") {
        sendCmd("off", "fan_pwm");
      }
      if (runtime.humidity_detector_ang.val === "off") {
        sendCmd("on", "water_pump_pwm");
      } else if (runtime.humidity_detector_ang.val === "on") {
        sendCmd("off", "water_pump_pwm");
      }
      sendCmd("on", "day_counter");
      transition("start");

    } else if (type === "dry") {
      sendCmd("skip", "day_counter");
      sendCmd("on", "fan_pwm");
      sendCmd("off", "water_pump_pwm");
      transition("dry");

    } else if (type === "end") {
      sendCmd("off", "timers");
      sendCmd("off", "actuators");
      transition("end");
    }

  } else if (target === "roof") {

    if (type === "forward_on") {
      if (runtime.roof_forward_limit.val === "off") {
        return;
      }
    } else if (type === "reverse_on") {
      if (runtime.roof_reverse_limit.val === "off") {
        return;
      }
    }
    outputs[0].push(msg);     
    
  } else {
    outputs[0].push(msg);
  }
}

return outputs;
