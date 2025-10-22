const flowData = flow.get("flow");
const runtime = flowData.runtime;
let currentState = runtime.fsm.val;

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
if (method === "cmd") {

  if (target === "fsm") {

    if (type === "start") {
      sendCmd("on", "water_valve_pwm");
      sendCmd("on", "fan_pwm");
      sendCmd("on", "day_counter");
      transition("start");

    } else if (type === "dry") {
      sendCmd("skip", "day_counter");
      sendCmd("on", "fan_pwm");
      sendCmd("off", "water_valve_pwm");
      transition("dry");

    } else if (type === "end") {
      sendCmd("off", "timers");
      sendCmd("off", "actuators");
      transition("end");
    }

  } else {
    outputs[0].push(msg);
  }
}

return outputs;
