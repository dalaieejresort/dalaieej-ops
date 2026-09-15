// Local preview setup only. Does not update deployed staff accounts.
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';

const file = '.env.development.local';
const names = ['Билгүүн', 'Саруул', 'Болор', 'Номин'];
const accounts = names.map((displayName, i) => {
  const salt = randomBytes(16);
  return { username: `waiter-${i + 1}`, displayName, role: 'waiter', active: true,
    salt: salt.toString('base64url'), passwordHash: scryptSync('1003', salt, 32).toString('base64url') };
});
const old = existsSync(file) ? readFileSync(file, 'utf8') : '';
if (/^OPS_WAITER_ACCOUNTS=/m.test(old)) throw new Error('Local waiter accounts already exist. Refusing to reset their PINs or names.');
writeFileSync(file, old + `\nOPS_WAITER_ACCOUNTS='${JSON.stringify(accounts)}'\n`, { mode: 0o600 });
chmodSync(file, 0o600);
console.log('Four local placeholder waiters configured. Initial PIN: 1003.');
