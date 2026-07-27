const fs = require('fs');
const path = require('path');

const targetFile = process.argv[2] || path.join(__dirname, '..', 'dist', 'cloudflare-order-manager-web', 'index.html');
if (!fs.existsSync(targetFile)) {
  console.error(`Target file not found: ${targetFile}`);
  process.exit(1);
}

let html = fs.readFileSync(targetFile, 'utf8');
const version = process.env.PRINTMO_RELEASE_ID || String(Date.now());

// Replace ./filename.css and ./filename.js with ./filename.css?v=1785...
html = html.replace(/(href|src)=["']\.\/([^"']+\.(?:css|js))(?:\?v=[^"']*)?["']/g, `$1="./$2?v=${version}"`);
const releaseMeta = `<meta name="printmo-release" content="${version}">`;
if (/<meta\s+name=["']printmo-release["'][^>]*>/i.test(html)) {
  html = html.replace(/<meta\s+name=["']printmo-release["'][^>]*>/i, releaseMeta);
} else {
  html = html.replace(/<head(\s[^>]*)?>/i, match => `${match}\n  ${releaseMeta}`);
}

fs.writeFileSync(targetFile, html, 'utf8');
console.log(`Prepared release ${version} with cache-busted assets in ${targetFile}`);
