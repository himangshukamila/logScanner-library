import { randomUUID } from 'node:crypto';
import express from 'express';
import { createNodeLogScanner } from '../src/node/index.js';

const app = express();
const enabled = process.env.NODE_ENV !== 'production';
const scanner = createNodeLogScanner({
  enabled,
  allowedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
});

app.use(express.json({ limit: '2kb' }));
if (enabled) app.get(scanner.path, scanner.handleRequest);
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/check', (req, res) => {
  const message: unknown = req.body?.message;
  if (typeof message !== 'string' || message.length > 200) {
    res.status(400).json({ error: 'A message of at most 200 characters is required.' });
    return;
  }
  console.info('Node.js received a server check', { message });
  const response = { requestId: randomUUID(), uptime: process.uptime(), node: process.version, request: { message } };
  console.log('this is server responce', response);
  res.json(response);
});

const server = app.listen(4318, '127.0.0.1', () => {
  console.info('Log Scanner example server listening on http://127.0.0.1:4318');
});
server.on('error', (error) => {
  console.error('Example server could not start', error);
  scanner.dispose();
  process.exitCode = 1;
});

function shutdown() {
  scanner.dispose();
  server.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
