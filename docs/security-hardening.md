# Scholar Harness Security Hardening

## Cloud Runtime Controls

The cloud API now records security events in `security_events` and enforces in-process risk controls before sensitive routes.

Environment knobs:

- `SECURITY_GLOBAL_LIMIT_PER_MIN`: default `300`
- `SECURITY_AUTH_LIMIT_PER_MIN`: default `20`
- `SECURITY_PAYMENT_LIMIT_PER_MIN`: default `60`
- `SECURITY_HEAVY_LIMIT_PER_MIN`: default `90`
- `SECURITY_USER_IP_WARN_PER_DAY`: default `6`
- `SECURITY_USER_IP_BLOCK_PER_DAY`: default `12`
- `SECURITY_DEVICE_USER_WARN_PER_DAY`: default `2`
- `SECURITY_DEVICE_USER_BLOCK_PER_DAY`: default `4`

Admin endpoints:

- `GET /api/v1/admin/security/events`
- `GET /api/v1/admin/security/summary`
- `GET /api/v1/admin/security/jwt-key-status`

## Payment Callback Risk Checks

Payment callbacks are completed inside a database transaction:

- lock original payment row with `FOR UPDATE`
- verify payment method
- verify provider amount against local amount
- keep success callbacks idempotent
- activate related subscription only after payment passes checks
- record rejected callbacks in `security_events`

WeChat callback verification requires `WECHAT_PAY_PLATFORM_PUBLIC_KEY` in production. For local tests only, set `PAYMENT_ALLOW_UNSIGNED_CALLBACKS=true`.

## JWT Key Rotation

Generate a new keyring:

```bash
npm run security:generate-jwt-keyring
```

Rotation sequence:

1. Configure old and new keys together, with the new key marked active.
2. Restart the cloud API; new tokens use the new `kid`, old tokens still verify.
3. Wait at least 7 days for refresh tokens to expire.
4. Remove old keys and restart again.

Supported variables:

- `JWT_ACCESS_KEYRING`
- `JWT_REFRESH_KEYRING`
- legacy fallback: `JWT_SECRET`, `JWT_REFRESH_SECRET`

## Windows Code Signing

Release packaging should use:

```bash
set SIGN_RELEASE=1 && npm run electron:build:signed
```

Provide one signing configuration:

- `CSC_LINK` + `CSC_KEY_PASSWORD`
- `CSC_NAME`
- Azure Trusted Signing variables: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TRUSTED_SIGNING_ACCOUNT`, `AZURE_TRUSTED_SIGNING_PROFILE`
