import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeConsoleLine } from './console-highlighter.ts';

test('tokenizeConsoleLine parses ANSI SGR 16-color, 256-color, and truecolor sequences cleanly', () => {
  const tokens = tokenizeConsoleLine('\x1b[32mServer ready\x1b[0m on \x1b[1;36mhttp://localhost:4001\x1b[0m');
  assert.equal(tokens[0].text, 'Server ready');
  assert.match(tokens[0].className, /text-emerald-400/);
  assert.ok(tokens.some((t) => t.text === 'http://localhost:4001' && t.className.includes('text-cyan-400')));

  const rgbTokens = tokenizeConsoleLine('\x1b[38;2;255;128;0mOrange\x1b[0m \x1b[38;5;196mRed256\x1b[0m');
  assert.equal(rgbTokens[0].text, 'Orange');
  assert.equal(rgbTokens[0].style?.color, 'rgb(255, 128, 0)');
  assert.equal(rgbTokens[2].text, 'Red256');
  assert.ok(rgbTokens[2].style?.color?.startsWith('rgb('));
});

test('tokenizeConsoleLine handles carriage returns and inverse ANSI styling', () => {
  const progressTokens = tokenizeConsoleLine('Downloading 20%\rDownloading 100%');
  assert.equal(progressTokens.map((t) => t.text).join(''), 'Downloading 100%');

  const invTokens = tokenizeConsoleLine('\x1b[7mPASS\x1b[0m');
  assert.equal(invTokens[0].text, 'PASS');
  assert.match(invTokens[0].className, /bg-zinc-200/);
});

test('tokenizeConsoleLine highlights HTTP logs, timestamps, errors, and file locations cleanly', () => {
  const httpTokens = tokenizeConsoleLine('[16:24:51] GET /api/health 200 12.4ms');
  assert.ok(httpTokens.some((t) => t.text === '[16:24:51]' && t.className.includes('text-zinc-500')));
  assert.ok(httpTokens.some((t) => t.text === 'GET' && t.className.includes('text-sky-300')));
  assert.ok(httpTokens.some((t) => t.text === '/api/health' && t.className.includes('text-zinc-300')));
  assert.ok(httpTokens.some((t) => t.text === '200' && t.className.includes('text-emerald-400')));
  assert.ok(httpTokens.some((t) => t.text === '12.4ms' && t.className.includes('text-amber-300')));

  const errTokens = tokenizeConsoleLine('ERROR TypeError at src/index.ts:42:10');
  assert.ok(errTokens.some((t) => t.text === 'ERROR' && t.className.includes('text-red-400')));
  assert.ok(errTokens.some((t) => t.text === 'TypeError' && t.className.includes('text-red-400')));
  assert.ok(errTokens.some((t) => t.text === 'src/index.ts:42:10' && t.className.includes('text-amber-300')));
});

test('tokenizeConsoleLine highlights CLI commands, env vars, flags, strings, booleans, and JSON keys', () => {
  const cliTokens = tokenizeConsoleLine('PORT=4001 uvicorn main:app --reload "listening" true', 'text-zinc-200');
  assert.ok(cliTokens.some((t) => t.text === 'PORT' && t.className.includes('text-violet-400')));
  assert.ok(cliTokens.some((t) => t.text === '4001' && t.className.includes('text-emerald-300')));
  assert.ok(cliTokens.some((t) => t.text === '--reload' && t.className.includes('text-sky-300')));
  assert.ok(cliTokens.some((t) => t.text === '"listening"' && t.className.includes('text-emerald-300')));
  assert.ok(cliTokens.some((t) => t.text === 'true' && t.className.includes('text-violet-400')));

  const jsonTokens = tokenizeConsoleLine('{"status": "ok", "count": 42, "active": false}');
  assert.ok(jsonTokens.some((t) => t.text === '"status"' && t.className.includes('text-sky-300')));
  assert.ok(jsonTokens.some((t) => t.text === '"ok"' && t.className.includes('text-emerald-300')));
  assert.ok(jsonTokens.some((t) => t.text === '42' && t.className.includes('text-amber-300')));
  assert.ok(jsonTokens.some((t) => t.text === 'false' && t.className.includes('text-violet-400')));
});
