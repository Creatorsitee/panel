import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeConsoleLine } from './console-highlighter.ts';

test('tokenizeConsoleLine parses ANSI SGR color sequences cleanly', () => {
  const tokens = tokenizeConsoleLine('\x1b[32mServer ready\x1b[0m on \x1b[1;36mhttp://localhost:4001\x1b[0m');
  assert.equal(tokens[0].text, 'Server ready');
  assert.match(tokens[0].className, /text-emerald-400/);
  assert.ok(tokens.some((t) => t.text === 'http://localhost:4001' && t.className.includes('text-cyan-400')));
});

test('tokenizeConsoleLine highlights HTTP logs, timestamps, errors, and file locations', () => {
  const httpTokens = tokenizeConsoleLine('[16:24:51] GET /api/health 200 12.4ms');
  assert.ok(httpTokens.some((t) => t.text === '[16:24:51]' && t.className.includes('text-zinc-500')));
  assert.ok(httpTokens.some((t) => t.text === 'GET' && t.className.includes('text-sky-400')));
  assert.ok(httpTokens.some((t) => t.text === '200' && t.className.includes('text-emerald-400')));
  assert.ok(httpTokens.some((t) => t.text === '12.4ms' && t.className.includes('text-amber-300')));

  const errTokens = tokenizeConsoleLine('ERROR TypeError at src/index.ts:42:10');
  assert.ok(errTokens.some((t) => t.text === 'ERROR' && t.className.includes('text-red-400')));
  assert.ok(errTokens.some((t) => t.text === 'TypeError' && t.className.includes('text-red-400')));
  assert.ok(errTokens.some((t) => t.text === 'src/index.ts:42:10' && t.className.includes('text-amber-300')));
});

test('tokenizeConsoleLine highlights env pairs, CLI flags, and quoted strings', () => {
  const tokens = tokenizeConsoleLine('PORT=4001 uvicorn main:app --reload "listening"');
  assert.ok(tokens.some((t) => t.text === 'PORT' && t.className.includes('text-sky-300')));
  assert.ok(tokens.some((t) => t.text === '4001' && t.className.includes('text-teal-300')));
  assert.ok(tokens.some((t) => t.text === '--reload' && t.className.includes('text-violet-300')));
  assert.ok(tokens.some((t) => t.text === '"listening"' && t.className.includes('text-teal-300')));
});
