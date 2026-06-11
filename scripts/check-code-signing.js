#!/usr/bin/env node

const required = process.argv.includes('--required') || process.env.SIGN_RELEASE === '1' || process.env.CI_SIGN_RELEASE === '1';

const hasFileCertificate = Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD);
const hasWindowsStoreCertificate = Boolean(process.env.CSC_NAME);
const hasAzureTrustedSigning = Boolean(
  process.env.AZURE_TENANT_ID &&
  process.env.AZURE_CLIENT_ID &&
  process.env.AZURE_CLIENT_SECRET &&
  process.env.AZURE_TRUSTED_SIGNING_ACCOUNT &&
  process.env.AZURE_TRUSTED_SIGNING_PROFILE
);

if (!required) {
  console.log('[CodeSign] SIGN_RELEASE is not enabled; skipping mandatory signing check.');
  process.exit(0);
}

if (hasFileCertificate || hasWindowsStoreCertificate || hasAzureTrustedSigning) {
  console.log('[CodeSign] Windows signing configuration detected.');
  process.exit(0);
}

console.error('[CodeSign] Missing Windows code signing configuration.');
console.error('');
console.error('Set one of these before release packaging:');
console.error('  1. CSC_LINK + CSC_KEY_PASSWORD for a .pfx/.p12 certificate');
console.error('  2. CSC_NAME for a certificate installed in the Windows certificate store');
console.error('  3. Azure Trusted Signing variables:');
console.error('     AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET,');
console.error('     AZURE_TRUSTED_SIGNING_ACCOUNT, AZURE_TRUSTED_SIGNING_PROFILE');
console.error('');
console.error('Recommended command: set SIGN_RELEASE=1 && npm run electron:build:signed');
process.exit(1);
