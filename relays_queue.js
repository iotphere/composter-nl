// === RELAYS_QUEUE.JS ===
// relays_write port1’den gelen fc:6 write mesajlarını sıraya alır ve
// relays_writer node’una gönderir.

const queueInterval = flow.get("flow")?.config?.io?.queue_interval || 50;

let sendQueue = context.get("sendQueue") || [];
sendQueue = sendQueue.concat(Array.isArray(msg) ? msg : [msg]); // gelen mesaj dizisi olabilir
context.set("sendQueue", sendQueue);

if (!context.get("isSending")) processQueue();

function processQueue() {
  let q = context.get("sendQueue") || [];
  if (q.length === 0) {
    context.set("isSending", false);
    return;
  }
  context.set("isSending", true);
  const m = q.shift();
  context.set("sendQueue", q);
  node.send(m); // relays_writer’a tek tek gönder
  setTimeout(processQueue, queueInterval);
}

return null;
