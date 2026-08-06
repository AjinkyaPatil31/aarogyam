/**
 * WhatsApp Provider Abstraction
 * Routes messages dynamically based on the configured provider
 * (config.whatsapp.provider — Milestone 3.1).
 */
import { acquireLock, releaseLock, readQueue, writeQueue } from './waQueue';
import { config } from '@/app/lib/config/index.mjs';

const BASE_DIR = process.cwd();

export async function sendWhatsAppMessage(phone, message) {
  const provider = config.whatsapp.provider;

  if (provider === 'twilio') {
    return await sendViaTwilio(phone, message);
  } else {
    return await sendViaWebJS(phone, message);
  }
}

async function sendViaTwilio(phone, message) {
  const { accountSid, authToken, fromNumber } = config.whatsapp.twilio;
  
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error('Twilio configuration is missing');
  }

  // Always use WhatsApp protocol for Twilio WhatsApp provider.
  // Ensure From has whatsapp: prefix even if config is just a bare number.
  const rawFrom = fromNumber.replace(/^whatsapp:/i, '');
  const formattedFrom = `whatsapp:${rawFrom.startsWith('+') ? rawFrom : '+' + rawFrom}`;
  // Always prefix To with whatsapp: and country code for WhatsApp delivery.
  const formattedTo = `whatsapp:+91${phone.replace(/[^0-9]/g, '').slice(-10)}`;

  const url = `${config.whatsapp.twilio.apiBase}${accountSid}/Messages.json`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const params = new URLSearchParams();
    params.append('To', formattedTo);
    params.append('From', formattedFrom);
    params.append('Body', message);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'},
      body: params,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Twilio API Error:', errorData);
      const err = new Error(errorData.message || 'Provider delivery failed');
      err.status = response.status;
      err.code = errorData.code;
      err.twilioMoreInfo = errorData.more_info;
      throw err;
    }

    return { success: true, queued: false, provider: 'twilio' };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('WhatsApp Provider Error (Twilio):', error.message);
    // Preserve original Twilio error details if this is a Twilio response error
    if (error.code !== undefined) {
      throw error; // re-throw with status, code, and message intact
    }
    throw new Error('Failed to deliver WhatsApp message via provider');
  }
}

async function sendViaWebJS(phone, message) {
  // Original queue-based approach for local SQLite environment
  await acquireLock(BASE_DIR);
  try {
    const queue = readQueue(BASE_DIR);

    const maxQueueSize = config.whatsapp.queue.maxSize;
    if (queue.length >= maxQueueSize) {
      const unSent = queue.filter(q => !q.sent);
      if (unSent.length >= maxQueueSize) {
        throw new Error('Queue is full');
      }
      queue.splice(0, queue.length - unSent.length); 
    }

    queue.push({
      id: Date.now().toString(),
      phone: phone.replace(/[^0-9]/g, ''),
      message,
      createdAt: new Date().toISOString(),
      sent: false});

    writeQueue(BASE_DIR, queue);
  } finally {
    releaseLock(BASE_DIR);
  }

  return { success: true, queued: true, provider: 'webjs' };
}
