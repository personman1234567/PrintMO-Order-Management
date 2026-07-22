const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  workerApiUrl: process.env.WORKER_API_URL || 'https://order-manager-proxy.printmobusiness.workers.dev',
  oidcIssuer: process.env.OIDC_ISSUER || '',
  oidcClientId: process.env.OIDC_CLIENT_ID || '',
  oidcScopes: process.env.OIDC_SCOPES || 'openid profile offline_access'
};
if (!config.oidcIssuer || !config.oidcClientId) {
  throw new Error('OIDC_ISSUER and OIDC_CLIENT_ID are required before packaging Electron');
}
const outputDir = path.join(__dirname, '..', '.build');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'app-config.json'), JSON.stringify(config, null, 2));
console.log('Prepared non-secret Electron runtime configuration.');
