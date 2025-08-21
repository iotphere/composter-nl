// Flow verilerini çek
const flowData = flow.get("flow") || {};
const runtime = flowData.runtime || {};
const config = flowData.config || {};

// bekle ve emergency_contactor'u ON yap
setTimeout(() => {
    
    node.send({
        payload: {
            method: "cmd",
            params: { type: "on", target: "emergency_contactor" }
        }
    });

    // bekle ve ALL OFF gönder (emergency_contactor hariç)
    setTimeout(() => {

        node.send({
            payload: {
                method: "cmd",
                params: { type: "off", target: "all" }
            }
        });

        // bekle ve yalnızca sinamics speed komutları restore et
        setTimeout(() => {

            const cmds = [];

            for (const [target, sin] of Object.entries(config.sinamics?.channels || {})) {
                const state = runtime[target];
                if (state?.speed && typeof state.speed.set_point === "number") {
                    cmds.push({
                        payload: {
                            method: "cmd",
                            params: {
                                type: "speed",
                                target: target,
                                set_point: state.speed.set_point
                            }
                        }
                    });
                }
            }

            // Tüm sinamics speed komutlarını sırayla gönder
            function sendSequentially(messages, delayMs) {
                messages.forEach((msg, index) => {
                    setTimeout(() => {
                        node.send(msg);
                    }, index * delayMs);
                });
            }

            sendSequentially(cmds, 100);

        }, 5000);

    }, 10000);

}, 5000);
