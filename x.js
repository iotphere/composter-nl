// Sabitler
const TELEMETRY_TOPIC = "v1/devices/me/telemetry";
const RPC_RESPONSE_PREFIX = "v1/devices/me/rpc/response/";

const topic = msg.topic || "";
const payload = msg.payload || {};
const method = payload?.method || "";
const params = payload?.params || {};

const flowData = flow.get("flow") || {};

// Güvenli msgId (topic beklenen formatta değilse 'unknown' kullan)
const msgId = (topic.split("/").pop()) || "unknown";

function getValueAtPath(obj, path) {
    if (!Array.isArray(path) || path.length === 0) return obj;
    return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), obj);
}

function setValueAtPath(obj, path, value) {
    if (!Array.isArray(path) || path.length === 0) {
        throw new Error("Invalid path for set");
    }
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
            current[key] = {};
        }
        current = current[key];
    }
    current[path[path.length - 1]] = value;
}

function buildRpcResponse(id, content) {
    return {
        topic: RPC_RESPONSE_PREFIX + id,
        payload: content
    };
}

function buildTelemetryMsg(content) {
    return {
        topic: TELEMETRY_TOPIC,
        payload: content
    };
}

// 1) evt
if (method === "evt") {
    const subType = params?.type;
    if (subType === "telemetry_periodical") {
        return [buildTelemetryMsg(flowData.runtime || {}), null];
    } else {
        const key = params?.type;

        // Hem val hem speed varsa
        if (params?.val !== undefined && params?.speed !== undefined) {
            const formatted = { [key]: { val: params.val, speed: params.speed } };
            return [buildTelemetryMsg(formatted), null];
        }
        // Sadece val varsa
        else if (params?.val !== undefined) {
            const formatted = { [key]: { val: params.val } };
            return [buildTelemetryMsg(formatted), null];
        }
        // Sadece speed varsa (garanti olsun)
        else if (params?.speed !== undefined) {
            const formatted = { [key]: { speed: params.speed } };
            return [buildTelemetryMsg(formatted), null];
        }

        return [null, null];
    }
}

// 2) cmd
if (method === "cmd") {
    return [buildRpcResponse(msgId, { response: true }), { payload }];
}

// 3) set/get tipi dot-path'li method'lar
const [action, ...pathParts] = method.split(".");

if (action === "get") {
    try {
        const value = getValueAtPath(flowData, pathParts);
        return [buildRpcResponse(msgId, { value: value === undefined ? null : value }), null];
    } catch (err) {
        return [buildRpcResponse(msgId, { error: err.message }), null];
    }
}

if (action === "set") {
    try {
        if (!pathParts || pathParts.length === 0) {
            return [buildRpcResponse(msgId, { error: "Invalid set path" }), null];
        }
        const newValue = params?.value;
        setValueAtPath(flowData, pathParts, newValue);
        flow.set("flow", flowData);
        return [buildRpcResponse(msgId, { response: true }), null];
    } catch (err) {
        return [buildRpcResponse(msgId, { error: err.message }), null];
    }
}

// Bilinmeyen method'lar
return [null, null];
