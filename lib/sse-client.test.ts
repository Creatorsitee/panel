import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSseBuffer } from './sse-client.ts';

test('parseSseBuffer parses multiple SSE frames, comments, and preserves incomplete trailing buffer', () => {
  const chunk1 =
    ': connected\n\n' +
    'event: snapshot\ndata: {"servers":[]}\n\n' +
    'event: metrics\ndata: {"cpu":';

  const res1 = parseSseBuffer(chunk1);
  assert.equal(res1.frames.length, 2);
  assert.equal(res1.frames[0].isComment, true);
  assert.equal(res1.frames[1].isComment, false);
  assert.equal(res1.frames[1].event, 'snapshot');
  assert.equal(res1.frames[1].data, '{"servers":[]}');
  assert.equal(res1.remainder, 'event: metrics\ndata: {"cpu":');

  const chunk2 = res1.remainder + '1.5}\r\n\r\n';
  const res2 = parseSseBuffer(chunk2);
  assert.equal(res2.frames.length, 1);
  assert.equal(res2.frames[0].event, 'metrics');
  assert.equal(res2.frames[0].data, '{"cpu":1.5}');
  assert.equal(res2.remainder, '');
});
