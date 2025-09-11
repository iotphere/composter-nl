// Sabitler
const TELEMETRY_TOPIC = "v1/devices/me/telemetry";
const RPC_RESPONSE_PREFIX = "v1/devices/me/rpc/response/";

const topic = msg.topic || "";
const payload = msg.payload || {};
const method = payload?.method || "";
const params = payload?.params || {};

const flowData = flow.get("flow") || {};

// Güvenli msgId
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

// 1) EVT — esnek versiyon
if (method === "evt") {
    const subType = params?.type;

    // subtype = telemetry_periodical → flowData.runtime
    if (subType === "telemetry_periodical") {
        return [buildTelemetryMsg(flowData.runtime || {}), null, null];
    }

    // Geri kalan tüm evt’ler için esnek format:
    // params.type dışındaki her şeyi otomatik kapsar
    if (subType) {
        // type dışındaki tüm alanları bir objeye kopyala
        const { type, ...rest } = params;
        // örn. { motor1: {x:10,y:20,speed:100}} gibi
        const formatted = { [subType]: rest };
        return [buildTelemetryMsg(formatted), null, null];
    }

    // params.type yoksa: params doğrudan telemetry payload olarak gönderilir
    return [buildTelemetryMsg(params), null, null];
}

// 2) CMD
if (method === "cmd") {
    // Özel "inject → flow_context" komutu kontrolü
    if (params?.type === "inject" && params?.target === "flow_context") {
        return [buildRpcResponse(msgId, { response: true }), null, { payload }];
    }
    // Normal cmd
    return [buildRpcResponse(msgId, { response: true }), { payload }, null];
}

// 3) set/get tipi dot-path'li method'lar
const [action, ...pathParts] = method.split(".");

if (action === "get") {
    try {
        const value = getValueAtPath(flowData, pathParts);
        return [buildRpcResponse(msgId, { value: value === undefined ? null : value }), null, null];
    } catch (err) {
        return [buildRpcResponse(msgId, { error: err.message }), null, null];
    }
}

if (action === "set") {
    try {
        if (!pathParts || pathParts.length === 0) {
            return [buildRpcResponse(msgId, { error: "Invalid set path" }), null, null];
        }
        const newValue = params?.value;
        setValueAtPath(flowData, pathParts, newValue);
        flow.set("flow", flowData);
        return [buildRpcResponse(msgId, { response: true }), null, null];
    } catch (err) {
        return [buildRpcResponse(msgId, { error: err.message }), null, null];
    }
}

// Bilinmeyen method'lar
return [null, null, null];
