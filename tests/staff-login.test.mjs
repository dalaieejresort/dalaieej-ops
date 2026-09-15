import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as crypto from 'node:crypto';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../lib/server/auth.ts', import.meta.url),'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', compiled)(name => {
  if (name === 'node:crypto') return crypto;
  if (['server-only', 'next/headers', 'next/navigation', 'next/server'].includes(name)) return {};
  throw new Error(`Unexpected dependency ${name}`);
}, loaded, loaded.exports);
const auth = loaded.exports;

test('staff selection exposes names only, verifies PINs and revokes inactive waiter sessions', () => {
  const keys = ['OPS_AUTH_ACCOUNTS','OPS_WAITER_ACCOUNTS','OPS_KITCHEN_ACCOUNT','OPS_SESSION_SECRET'];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    const make = (username, displayName, role, password) => {
      const salt = crypto.randomBytes(16);
      return { username, displayName, role, active: true, salt: salt.toString('base64url'),
        passwordHash: crypto.scryptSync(password,salt,32).toString('base64url') };
    };
    const owner = make('owner','Owner','owner','owner-test-password');
    const waiter = make('waiter-1','Билгүүн','waiter','1003');
    const other = make('waiter-2','Саруул','waiter','1003');
    process.env.OPS_AUTH_ACCOUNTS = JSON.stringify([owner]);
    process.env.OPS_WAITER_ACCOUNTS = JSON.stringify([waiter,other]);
    delete process.env.OPS_KITCHEN_ACCOUNT;
    process.env.OPS_SESSION_SECRET = 'test-only-secret-that-is-longer-than-32-characters';
    assert.deepEqual(auth.getWaiterLoginOptions(), [
      {username:'waiter-1',displayName:'Билгүүн'}, {username:'waiter-2',displayName:'Саруул'},
    ]);
    assert.equal(auth.authenticateAccount('waiter-1','0000'),null);
    assert.equal(auth.authenticateAccount('owner','1003'),null);
    const account = auth.authenticateAccount('waiter-1','1003');
    assert.deepEqual(account,{username:'waiter-1',displayName:'Билгүүн',role:'waiter'});
    const token = auth.createSessionToken(account);
    assert.equal(auth.verifySessionToken(token).username,'waiter-1');
    assert.equal(auth.authenticateAccount('waiter-2','1003').displayName,'Саруул');
    process.env.OPS_WAITER_ACCOUNTS = JSON.stringify([{...waiter,active:false},other]);
    assert.equal(auth.authenticateAccount('waiter-1','1003'),null);
    assert.equal(auth.verifySessionToken(token),null);
    assert.deepEqual(auth.getWaiterLoginOptions(),[{username:'waiter-2',displayName:'Саруул'}]);
    process.env.OPS_WAITER_ACCOUNTS = JSON.stringify([{...waiter,role:'owner'}]);
    assert.throws(()=>auth.getWaiterLoginOptions(), /only waiter/);
  } finally {
    for (const key of keys) { if(old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
  }
});
