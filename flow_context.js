const payload = msg.payload || {};
const method = payload.method || "";
const params = payload.params || {};

if (!(method === "cmd" && params.type === "inject" && params.target === "flow_context")) {
    return null; // diğer tüm mesajları görmezden gel
}

const flowData = {
  config: {
    labels: {true: "on", false: "off"},
    io: {
      queue_interval: 100,
      digital_inputs: {
        config_node: "201_115200_tcp_rtu_dig_inp",
        unitid: 11,
        channels: {        
          oxygen_detector_dig_low: {map: 0},
          oxygen_detector_dig_high: {map: 1},
          //stop_button: {map: 15}
        }      
      },
      analog_inputs: {
        config_node: "204_9600_tcp_rtu_ang_inp_eng_met",
        unitid: 12,        
        channels: {
          temperature: {map: 5, change: 1, factor: 0.01, scale: {in_min: 4, in_max: 20, out_min: 0, out_max: 100}},
          //humidity: {map: 6, change: 3, factor: 0.01, scale: {in_min: 4, in_max: 20, out_min: 0, out_max: 100}, pro: {humidity_detector_ang: {low: 30, high: 60}}},
          oxygen: {map: 7, change: 0.2, factor: 0.01, scale: {in_min: 4.81, in_max: 20, out_min: 1.63, out_max: 21.53}} // +0.63 offset to out_min 1 and out_max 20.9
        }
      },
      relay_outputs_1: {
        config_node: "203_115200_tcp_rtu_rel_out",
        unitid: 13,
        channels: {
          roof_forward_contactor: {map: 0},
          roof_reverse_contactor: {map: 1},
          light: {map: 6},
          water_valve: {map: 7}
        }
      },
      relay_outputs_2: {
        config_node: "203_115200_tcp_rtu_rel_out",
        unitid: 14,
        channels: {
          walking_floor_forward_valve: {map: 4},
          walking_floor_reverse_valve: {map: 5},
          walking_floor_motor: {map: 6},
          power_contactor: {map: 7}
        }
      },
      relay_groups: {
        roof: {
          roof_forward_contactor: null,
          roof_reverse_contactor: null,
        },
        walking_floor: {
          walking_floor_motor: null,
          walking_floor_forward_valve: null,
          walking_floor_reverse_valve: null    
        }
      }
    },
    energy_meter: {
      config_node: "204_9600_tcp_rtu_ang_inp_eng_met",
      unitid: 2,      
      channels: {
        kwh: {map: 0, factor: 0.01, change: 2}
      }
    },  
    sinamics: {
      config_node: "202_9600_tcp_rtu_sinamics",
      channels: {
        fan: {unitid: 12},
        discharger: {unitid: 14}
      },
      command_words: {forward: 1151, reverse: 3199, off: 1150, fault_ack_res: 1150, fault_ack_set: 1278},
      status_word: {
        work: {map: 2},
        fault: {map: 3},
        warning: {map: 7},
        direction: {map: 14}
      },
      speed_max: 16384, // modbus send >> set_point / 100 * speed_max
      queue_interval: 100,
      power_up_time: 15000
    },
    timers: {      
      fan_pwm: {
        form: "pwm",
        t_duty: 10, t_cycle: 180, unit: "min",
        pass: {
          1: {method: "cmd", params: {type: "forward", target: "fan"}, port: 2},
          2: {method: "cmd", params: {type: "off", target: "fan"}, port: 2}
        }
      },
      light_pulse: {
        form: "delay", duration: 2, unit: "s",
        pass: {
          1: {method: "cmd", params: {type: "on", target: "light"}, port: 2},
          2: {method: "cmd", params: {type: "off", target: "light"}, port: 2}
        }
      },
      water_valve_pwm: {
        form: "pwm", t_duty: 15, t_cycle: 1440, unit: "min",
        pass: {
          1: {method: "cmd", params: {type: "on", target: "water_valve"}, port: 2},
          2: {method: "cmd", params: {type: "off", target: "water_valve"}, port: 2}
        }        
      },
      day_counter: {
        form: "counter", direction: "down", interval: 1, base: 21, signal: 3, unit: "d",
        pass: {
          2: {method: "cmd", params: {type: "dry", target: "fsm"}, port: 1},
          3: {method: "cmd", params: {type: "complete", target: "fsm"}, port: 1},
          4: {method: "evt", params: {type: "day"}, port: 3} // val buradan sabit gelmeyecek
        }             
      },
      walking_floor_counter: {
        form: "counter", direction: "down", interval: 20, base: 10, unit: "s",
        pass: {
          4: {method: "cmd", params: {type: "walking_floor_counter", target: "fsm"}, port: 1}
        }             
      }

    }
  },
  runtime: {
    oxygen: {val: 0},
    oxygen_detector_dig_low: {val: "on"},
    oxygen_detector_dig_high: {val: "on"},
    //humidity: {val: 0}, 
    //humidity_detector_ang_low: {val: "on"},
    //humidity_detector_ang_high: {val: "on"},
    temperature: {val: 0},
    kwh: {val: 0},
    //stop_button: {val: "on"},
    power_contactor: {val: "off"},
    water_valve: {val: "off"},  
    light: {val: "off"},
    roof: {val: "off"},
    roof_forward_contactor: {val: "off"},
    roof_reverse_contactor: {val: "off"},
    walking_floor: {val: "off"},
    walking_floor_forward_valve: {val: "off"},
    walking_floor_reverse_valve: {val: "off"},
    walking_floor_motor: {val: "off"},
    fan: {val: "off", speed_set_point: 100},
    discharger: {val: "off", speed_set_point: 100},
    fsm: {val: "completed"}
  }
}

flow.set("flow", flowData);

return msg;
