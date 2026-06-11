import * as crypto from 'crypto';

function makeKey(prefix: string): { kid: string; secret: string } {
  const secret = crypto.randomBytes(48).toString('base64url');
  const kid = `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
  return { kid, secret };
}

const access = makeKey('access');
const refresh = makeKey('refresh');

const accessKeyring = [{ ...access, active: true }];
const refreshKeyring = [{ ...refresh, active: true }];

console.log('# Add these to the cloud server environment, then restart the API.');
console.log('# Keep the previous key in the same JSON array until old tokens expire.');
console.log(`JWT_ACCESS_KEYRING='${JSON.stringify(accessKeyring)}'`);
console.log(`JWT_REFRESH_KEYRING='${JSON.stringify(refreshKeyring)}'`);
console.log('');
console.log('# After rollout:');
console.log('# 1. Deploy with old + new keys, new key marked active.');
console.log('# 2. Wait at least 7 days for refresh tokens to expire.');
console.log('# 3. Remove old keys and restart again.');
