import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  resolveSafePath,
  parseSafeStartupCommand,
  parseDotEnvContent,
  isValidEnvKey,
  validateEmail,
  validateServerName,
  validateServerPort,
  allocateNextPort,
} from './security';

test('resolveSafePath allows paths strictly inside base directory', () => {
  const base = '/tmp/cmnty-test/server-1';
  assert.equal(resolveSafePath(base, ''), path.resolve(base));
  assert.equal(resolveSafePath(base, 'index.js'), path.resolve(base, 'index.js'));
  assert.equal(resolveSafePath(base, 'src/routes/api.ts'), path.resolve(base, 'src/routes/api.ts'));
});

test('resolveSafePath blocks directory traversal attempts', () => {
  const base = '/tmp/cmnty-test/server-1';
  assert.throws(() => resolveSafePath(base, '../server-2/secret.txt'));
  assert.throws(() => resolveSafePath(base, '../../etc/passwd'));
});

test('parseSafeStartupCommand accepts allowed per-runtime Node.js and Python commands', () => {
  assert.deepEqual(parseSafeStartupCommand('node bot.js', 'nodejs'), {
    executable: 'node',
    args: ['bot.js'],
    scriptArg: 'bot.js',
    pythonModule: null,
    npmScriptName: null,
  });
  assert.deepEqual(parseSafeStartupCommand('npm start', 'nodejs'), {
    executable: 'npm',
    args: ['start'],
    scriptArg: null,
    pythonModule: null,
    npmScriptName: 'start',
  });
  assert.deepEqual(parseSafeStartupCommand('npx tsx src/index.ts', 'nodejs'), {
    executable: 'npx',
    args: ['tsx', 'src/index.ts'],
    scriptArg: 'src/index.ts',
    pythonModule: null,
    npmScriptName: null,
  });
  assert.deepEqual(parseSafeStartupCommand('python bot.py', 'python'), {
    executable: 'python',
    args: ['bot.py'],
    scriptArg: 'bot.py',
    pythonModule: null,
    npmScriptName: null,
  });
  assert.deepEqual(parseSafeStartupCommand('python3 -m uvicorn main:app --reload', 'python'), {
    executable: 'python3',
    args: ['-m', 'uvicorn', 'main:app', '--reload'],
    scriptArg: 'main:app',
    pythonModule: 'uvicorn',
    npmScriptName: null,
  });
  assert.deepEqual(parseSafeStartupCommand('uvicorn main:app --port 4001', 'python'), {
    executable: 'uvicorn',
    args: ['main:app', '--port', '4001'],
    scriptArg: 'main:app',
    pythonModule: 'uvicorn',
    npmScriptName: null,
  });
});

test('parseSafeStartupCommand enforces strict runtime isolation and blocks path traversal or eval flags', () => {
  assert.throws(() => parseSafeStartupCommand('python3 -u bot.py', 'nodejs'));
  assert.throws(() => parseSafeStartupCommand('node bot.js', 'python'));
  assert.throws(() => parseSafeStartupCommand('node ../other-server/bot.js', 'nodejs'));
  assert.throws(() => parseSafeStartupCommand('python3 /etc/passwd', 'python'));
  assert.throws(() => parseSafeStartupCommand('node --require=../evil.js bot.js', 'nodejs'));
  assert.throws(() => parseSafeStartupCommand('node -e "process.exit(1)"', 'nodejs'));
  assert.throws(() => parseSafeStartupCommand('python3 -c "import os"', 'python'));
  assert.throws(() => parseSafeStartupCommand('python3 -m ../evil', 'python'));
  assert.throws(() => parseSafeStartupCommand('node bot.js && rm -rf /', 'nodejs'));
  assert.throws(() => parseSafeStartupCommand('bash -c "whoami"'));
});

test('parseDotEnvContent parses valid variables and blocks unsafe overrides', () => {
  const parsed = parseDotEnvContent(`
# Comment line
PORT=4005
API_KEY="secret-value-123"
PATH=/tmp/evil
LD_PRELOAD=/tmp/hook.so
PYTHONPATH=/tmp/py
invalid-key=skip
`);
  assert.deepEqual(parsed, {
    PORT: '4005',
    API_KEY: 'secret-value-123',
  });
  assert.equal(isValidEnvKey('PORT'), true);
  assert.equal(isValidEnvKey('bad-key'), false);
});

test('validateEmail and validateServerName sanitize inputs', () => {
  assert.equal(validateEmail('  User@Example.COM '), 'user@example.com');
  assert.throws(() => validateEmail('not-an-email'));
  assert.equal(validateServerName('api-gateway-01'), 'api-gateway-01');
  assert.throws(() => validateServerName('a'));
  assert.throws(() => validateServerName('bad/name'));
});

test('allocateNextPort and validateServerPort validate internal server ports', () => {
  assert.equal(allocateNextPort([4001, 4002]), 4003);
  assert.equal(allocateNextPort([4002]), 4001);
  assert.equal(validateServerPort(8080, [4001, 4002], 3000), 8080);
  assert.throws(() => validateServerPort(3000, [4001], 3000));
  assert.throws(() => validateServerPort(4001, [4001], 3000));
  assert.throws(() => validateServerPort(80, [], 3000));
});
