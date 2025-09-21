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
      queue_interval: 50,
      digital_inputs: {
        config_node: "201_115200_tcp_rtu_dig_inp",
        unitid: 11,
        channels: {        
          oxygen_detector_dig_alr_1: {map: 0, pro: {oxygen_detector_dig: "off"}},
          oxygen_detector_dig_alr_2: {map: 1, pro: {oxygen_detector_dig: "on"}},
          humidity_detector_dig_alr_1: {map: 2, pro: {humidity_detector_dig: "off"}},
          humidity_detector_dig_alr_2: {map: 3, pro: {humidity_detector_dig: "on"}},
          roof_forward_limit: {map: 4},
          roof_reverse_limit: {map: 5},
          cabinet_door: {map: 6},
          stop_button: {map: 15}
        }      
      },
      analog_inputs: {
        config_node: "204_9600_tcp_rtu_ang_inp_eng_met",
        unitid: 12,        
        channels: {
          oxygen: {map: 0, change: 0.2, factor: 0.01, scale: {in_min: 4, in_max: 20, out_min: 0.5, out_max: 20.9}, pro: {oxygen_detector_ang: {off: 3.2, on: 14.7}}},
          humidity: {map: 1, change: 3, factor: 0.01, scale: {in_min: 4, in_max: 20, out_min: 0, out_max: 100}, pro: {humidity_detector_ang: {off: 30, on: 60}}}
        }
      },
      relay_outputs_1: {
        config_node: "203_115200_tcp_rtu_rel_out",
        unitid: 13,
        channels: {
          light: {map: 6},
          buzzer: {map: 7}
        }
      },
      relay_outputs_2: {
        config_node: "203_115200_tcp_rtu_rel_out",
        unitid: 14,
        channels: {
          loader_forward_valve: {map: 4, group: "loader"},
          loader_reverse_valve: {map: 5, group: "loader"},
          loader_motor: {map: 6, group: "loader"},
          power_contactor: {map: 7}
        }
      },
      relay_groups: {
        loader: {
          loader_motor: null,
          loader_forward_valve: null,
          loader_reverse_valve: null    
        }
      }
    },
    energy_meter: {
      config_node: "204_9600_tcp_rtu_ang_inp_eng_met",
      unitid: 2,      
      channels: {
        kwh: {map: 0, factor: 0.01, change: 2, pro: {kwh_detector: {off: 30, on: 60}}}
      }
    },  
    sinamics: {
      config_node: "202_9600_tcp_rtu_sinamics",
      channels: {
        roof: {unitid: 11},
        fan: {unitid: 12},
        water_pump: {unitid: 13},
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
      queue_interval: 50,
      power_up_time: 10000
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
      water_pump_pwm: {
        form: "pwm",
        t_duty: 15, t_cycle: 360, unit: "min",
        pass: {
          1: {method: "cmd", params: {type: "forward", target: "water_pump"}, port: 2},
          2: {method: "cmd", params: {type: "off", target: "water_pump"}, port: 2}
        }
      },
      light_pulse: {
        form: "delay", duration: 2, unit: "s",
        pass: {
          1: {method: "cmd", params: {type: "on", target: "light"}, port: 2},
          2: {method: "cmd", params: {type: "off", target: "light"}, port: 2}
        }
      },
      light_pwm: {
        form: "pwm", t_duty: 2, t_cycle: 5, unit: "s",
        pass: {
          1: {method: "cmd", params: {type: "on", target: "light"}, port: 2},
          2: {method: "cmd", params: {type: "off", target: "light"}, port: 2}
        }        
      },
      buzzer_pulse: {
        form: "delay", duration: 2, unit: "s",
        pass: {
          1: {method: "cmd", params: {type: "on", target: "buzzer"}, port: 2},
          2: {method: "cmd", params: {type: "off", target: "buzzer"}, port: 2}
        }
      },
      buzzer_pwm: {
        form: "pwm", t_duty: 2, t_cycle: 5, unit: "s",
        pass: {
          1: {method: "cmd", params: {type: "on", target: "buzzer"}, port: 2},
          2: {method: "cmd", params: {type: "off", target: "buzzer"}, port: 2}
        }        
      },
      day_counter: {
        form: "counter", direction: "down", interval: 1, base: 21, signal: 3, unit: "d",
        pass: {
          2: {method: "cmd", params: {type: "dry", target: "fsm"}, port: 1},
          3: {method: "cmd", params: {type: "end", target: "fsm"}, port: 1},
          4: {method: "evt", params: {type: "day"}, port: 3} // val buradan sabit gelmeyecek
        }             
      }
    }
  },
  runtime: {
    oxygen_detector_dig_alr_1: {val: "on"},
    oxygen_detector_dig_alr_2: {val: "on"},
    humidity_detector_dig_alr_1: {val: "on"},
    humidity_detector_dig_alr_2: {val: "on"},
    roof_forward_limit: {val: "on"},
    roof_reverse_limit: {val: "on"},
    cabinet_door: {val: "on"},
    stop_button: {val: "on"},
    oxygen: {val: 0},
    humidity: {val: 0}, 
    loader_forward_valve: {val: "off"},
    loader_reverse_valve: {val: "off"},
    loader_motor: {val: "off"},
    power_contactor: {val: "off"},
    light: {val: "off"},
    buzzer: {val: "off"},  
    roof: {speed: {set_point: 100}, val: "off"},
    fan: {speed: {set_point: 100}, val: "off"},
    water_pump: {speed: {set_point: 100}, val: "off"},
    discharger: {speed: {set_point: 100}, val: "off"},
    loader: {val: "off"},
    kwh: {val: 0},
    oxygen_detector_dig: {val: "off"},
    oxygen_detector_ang: {val: "off"},
    humidity_detector_dig: {val: "off"},
    humidity_detector_ang: {val: "off"},
    kwh_detector: {val: "off"},
    fsm: {val: "end"}
  }
}

flow.set("flow", flowData);

return msg;
