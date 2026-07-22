// scripts/backup-redis-queue.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { createClient } = require('redis');

// Load environment variables from .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log(`[Backup] Loaded environment from ${envPath}`);
} else {
  console.warn(`[Backup] Warning: .env file not found at ${envPath}`);
}

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error('[Backup] Error: REDIS_URL environment variable is not defined.');
  process.exit(1);
}

const QUEUE_KEY = 'shopifyOrdersQueue';
const SENSITIVE_FIXTURE_KEY = /(customer|email|phone|address|company|first_?name|last_?name|note)/i;

function sanitizeFixture(value, key = '') {
  if (Array.isArray(value)) return value.map(item => sanitizeFixture(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitizeFixture(child, childKey)]));
  }
  if (key === 'name' && typeof value === 'string') {
    return `${value.split(' – ')[0]} – [REDACTED]`;
  }
  if (key === 'data' && typeof value === 'string' && /^data:.*;base64,/i.test(value)) {
    return '[BASE64_TRUNCATED_FOR_FIXTURE]';
  }
  if (SENSITIVE_FIXTURE_KEY.test(key) && value !== null && value !== undefined) return '[REDACTED]';
  return value;
}

async function runBackup() {
  console.log(`[Backup] Connecting to Redis...`);
  const client = createClient({ url: REDIS_URL });

  client.on('error', (err) => {
    console.error('[Backup] Redis error:', err);
  });

  await client.connect();
  console.log(`[Backup] Successfully connected to Redis.`);

  console.log(`[Backup] Fetching all records from list key '${QUEUE_KEY}'...`);
  const rawList = await client.lRange(QUEUE_KEY, 0, -1);
  console.log(`[Backup] Fetched ${rawList.length} raw order items.`);

  const masterHasher = crypto.createHash('sha256');
  masterHasher.update(JSON.stringify(rawList));
  const masterSha256 = masterHasher.digest('hex');

  const orders = [];
  const statusCounts = {};
  const attachmentManifest = [];
  let totalAttachments = 0;
  let parseErrors = 0;

  for (let i = 0; i < rawList.length; i++) {
    const raw = rawList[i];
    try {
      const order = typeof raw === 'string' ? JSON.parse(raw) : raw;
      orders.push(order);

      const status = order.status || 'unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      if (Array.isArray(order.attachments)) {
        for (const att of order.attachments) {
          totalAttachments++;
          let sizeBytes = 0;
          let attSha256 = '';

          if (typeof att.data === 'string') {
            const base64Content = att.data.replace(/^data:.*?;base64,/, '');
            const buffer = Buffer.from(base64Content, 'base64');
            sizeBytes = buffer.length;
            attSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          }

          attachmentManifest.push({
            orderIndex: i,
            orderName: order.name || order.id || `index_${i}`,
            filename: att.name || 'unnamed',
            mimeType: att.type || 'unknown',
            sizeBytes,
            sha256: attSha256
          });
        }
      }
    } catch (err) {
      parseErrors++;
      console.error(`[Backup] Failed to parse item at index ${i}:`, err.message);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupFileName = `shopifyOrdersQueue-backup-${timestamp}.json`;
  const backupFilePath = path.join(backupDir, backupFileName);

  const backupPayload = {
    metadata: {
      backedUpAt: new Date().toISOString(),
      queueKey: QUEUE_KEY,
      totalOrders: orders.length,
      parseErrors,
      statusCounts,
      totalAttachments,
      masterSha256
    },
    attachmentManifest,
    rawQueue: rawList,
    queue: orders
  };

  fs.writeFileSync(backupFilePath, JSON.stringify(backupPayload, null, 2), 'utf8');
  console.log(`[Backup] Full backup saved to: ${backupFilePath}`);

  if (parseErrors) throw new Error(`Backup contains ${parseErrors} unparseable queue item(s); fixture generation aborted`);

  // Preserve shape while redacting customer fields, names, notes, and attachment bytes.
  const sampleFixtures = orders.slice(0, 10).map(ord => sanitizeFixture(ord));

  const fixtureFilePath = path.join(backupDir, 'fixtures-sample.json');
  fs.writeFileSync(fixtureFilePath, JSON.stringify(sampleFixtures, null, 2), 'utf8');
  console.log(`[Backup] Sanitized fixtures saved to: ${fixtureFilePath}`);

  console.log('\n--- BACKUP SUMMARY ---');
  console.log(`Total Orders:        ${orders.length}`);
  console.log(`Status Breakdown:    ${JSON.stringify(statusCounts)}`);
  console.log(`Total Attachments:   ${totalAttachments}`);
  console.log(`Master SHA-256:      ${masterSha256}`);
  console.log('----------------------\n');

  await client.disconnect();
  console.log('[Backup] Redis connection closed. Backup complete.');
}

runBackup().catch((err) => {
  console.error('[Backup] Fatal error executing backup:', err);
  process.exit(1);
});
