import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

let client = null;
let isReady = false;

export function getWhatsAppClient() {
  if (client) return client;

  client = new Client({
    authStrategy: new LocalAuth({ clientId: 'aarogyam' }),
    puppeteer: {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('qr', (qr) => {
    console.log('\n📱 SCAN THIS QR CODE WITH WHATSAPP:\n');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    isReady = true;
    console.log('✅ WhatsApp client is ready');
  });

  client.on('disconnected', () => {
    isReady = false;
    console.log('⚠️ WhatsApp client disconnected');
  });

  client.initialize();
  return client;
}

export async function sendWhatsAppMessage(phone, message) {
  const wa = getWhatsAppClient();
  if (!isReady) {
    console.warn('WhatsApp not ready yet — message queued');
    await new Promise(resolve => {
      wa.once('ready', resolve);
    });
  }
  const chatId = phone.replace(/[^0-9]/g, '') + '@c.us';
  await wa.sendMessage(chatId, message);
  console.log(`✅ WhatsApp message sent to ${phone}`);
}
