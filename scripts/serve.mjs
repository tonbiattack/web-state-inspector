import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT ?? 4173);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (request, response) => {
  const requestPath = new URL(request.url ?? '/', `http://${request.headers.host}`).pathname;
  if (requestPath === '/api/debug-context/ok') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Debug-Scenario': 'success' });
    response.end(JSON.stringify({ customerId: 123, status: 'ok' }));
    return;
  }
  if (requestPath === '/api/debug-context/fail') {
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'X-Debug-Scenario': 'server-error' });
    response.end(JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Intentional demo failure' }));
    return;
  }
  if (requestPath === '/api/debug-context/echo') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    response.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'X-Debug-Scenario': 'xhr-post' });
    response.end(JSON.stringify({ received: body || null, status: 'created' }));
    return;
  }
  const candidate = requestPath.endsWith('/') ? `${requestPath}index.html` : requestPath;
  const filePath = resolve(root, `.${normalize(candidate)}`);
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`Web State Inspector demo is available at http://localhost:${port}/sample/`);
});
