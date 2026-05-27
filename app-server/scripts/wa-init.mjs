// Standalone WhatsApp client initializer
// Run this in a separate terminal: node scripts/wa-init.mjs

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  acquireLock,
  releaseLock,
  readQueue,
  writeQueue,
} from '../app/lib/waQueue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = join(__dirname, '..');

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'aarogyam' }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
      || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
    ],
  },
});

let isReady = false;

client.on('qr', (qr) => {
  console.log('\n📱 SCAN THIS QR CODE WITH WHATSAPP:\n');
  qrcode.generate(qr, { small: true });
  console.log('\nWaiting for scan...\n');
});

client.on('ready', () => {
  isReady = true;
  console.log('✅ WhatsApp client is ready!');
  console.log('Polling for messages every 3 seconds...\n');
  pollQueue();
});

client.on('authenticated', () => {
  console.log('🔐 Authenticated successfully');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Auth failed:', msg);
});

client.on('disconnected', async (reason) => {
  isReady = false;
  console.log('⚠️ WhatsApp disconnected:', reason);
  console.log('🔄 Attempting to reinitialize in 5 seconds...');
  setTimeout(async () => {
    try {
      await client.initialize();
      console.log('🔄 Reinitialized successfully');
    } catch (err) {
      console.error('❌ Reinitialize failed:', err.message);
    }
  }, 5000);
});

async function pollQueue() {
  setInterval(async () => {
    if (!isReady) return;

    // ── Phase 1: Acquire lock → read → mark processing → write → release ──
    let pending;
    try {
      await acquireLock(BASE_DIR);
      try {
        const queue = readQueue(BASE_DIR);
        pending = queue.filter(m => !m.sent && !m.processing);
        if (pending.length === 0) return;

        // Mark as processing while under lock
        pending.forEach(m => { m.processing = true; });
        writeQueue(BASE_DIR, queue);
      } finally {
        releaseLock(BASE_DIR);
      }
    } catch (err) {
      console.error('Lock error (phase 1):', err.message);
      return;
    }

    // ── Phase 2: Send messages (lock-free, may take seconds) ────────────
    for (const msg of pending) {
      try {
        let phone = msg.phone.replace(/[^0-9]/g, '');
        if (phone.length === 10) phone = '91' + phone;
        const chatId = phone + '@c.us';
        console.log('Sending to chatId:', chatId);

        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
          console.error(`❌ ${phone} is not on WhatsApp`);
          msg.sent = true;
          msg.failed = true;
          msg.error = 'Not registered on WhatsApp';
          continue;
        }

        await client.sendMessage(chatId, msg.message);
        msg.sent = true;
        msg.processing = false;
        console.log(`✅ Sent to ${phone}`);
      } catch (err) {
        console.error(`❌ Failed:`, err.message);
        msg.sent = true;
        msg.failed = true;
        msg.processing = false;
        msg.error = err.message;
      }
    }

    // ── Phase 3: Acquire lock → read → update sent status → write → release ──
    try {
      await acquireLock(BASE_DIR);
      try {
        const queue = readQueue(BASE_DIR);
        // Merge updated statuses back into the persisted queue
        for (const sentMsg of pending) {
          const idx = queue.findIndex(m => m.id === sentMsg.id);
          if (idx !== -1) {
            queue[idx].sent = sentMsg.sent;
            queue[idx].processing = sentMsg.processing;
            queue[idx].failed = sentMsg.failed;
            queue[idx].error = sentMsg.error;
          }
        }
        writeQueue(BASE_DIR, queue);
      } finally {
        releaseLock(BASE_DIR);
      }
    } catch (err) {
      console.error('Lock error (phase 3):', err.message);
    }
  }, 5000);
}

try {
  console.log('🚀 Starting WhatsApp client...');
  console.log('Please wait 10-15 seconds for Chrome to load...\n');
  client.initialize();
} catch (err) {
  console.error('❌ Failed to initialize:', err.message);
  process.exit(1);
}
