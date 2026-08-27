const endpoint = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9223';
const targetUrl = process.env.TARGET_URL;
const targetUrlIncludes = process.env.TARGET_URL_INCLUDES;
const expression = process.env.EXPRESSION;

if ((!targetUrl && !targetUrlIncludes) || !expression) {
  throw new Error('Either TARGET_URL or TARGET_URL_INCLUDES, plus EXPRESSION, are required.');
}

const targets = await (await fetch(`${endpoint}/json/list`)).json();
const target = targets.find((item) => targetUrl ? item.url === targetUrl : item.url.includes(targetUrlIncludes));
if (!target?.webSocketDebuggerUrl) {
  throw new Error(`Target not found: ${targetUrl ?? targetUrlIncludes}`);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const resolver = pending.get(message.id);
  if (!resolver) return;
  pending.delete(message.id);
  resolver(message);
});

function command(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 10000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  });
}

const result = await command('Runtime.evaluate', {
  expression,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,
});

if (result.exceptionDetails) {
  throw new Error(result.exceptionDetails.text ?? 'Runtime evaluation failed.');
}
console.log(JSON.stringify(result.result.value, null, 2));
socket.close();
