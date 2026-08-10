import { NextResponse } from 'next/server';
import { sendWhatsAppMessage } from '@/app/lib/whatsappProvider';
import { requireRole } from '@/app/lib/authHelpers';
import { apiResponse, apiError, handleServerError } from '@/app/lib/apiResponse';

export const runtime = 'nodejs';

// ── M1.5-F3 — bounded input caps. phone mirrors the M1.4 contact cap (20
// chars); message is generously capped so a full prescription share (a few
// hundred characters, well under WhatsApp's own 4096-char hard limit) is
// never blocked.
const MAX_PHONE_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 5000;

export async function POST(req) {
  try {
    const authCheck = await requireRole(req, ['DOCTOR', 'COMPOUNDER']);
    if (authCheck.errorResponse) return authCheck.errorResponse;

    const { phone, message } = await req.json();

    // M1.5-F3 — type-check before trim()/length checks and before any
    // provider invocation, so malformed input returns 400, never a 500.
    if (typeof phone !== 'string' || typeof message !== 'string') {
      return apiError('phone and message must be strings', 400);
    }
    const trimmedPhone = phone.trim();
    const trimmedMessage = message.trim();
    if (!trimmedPhone || !trimmedMessage) {
      return apiError('phone and message are required', 400);
    }
    if (trimmedPhone.length > MAX_PHONE_LENGTH) {
      return apiError('phone exceeds maximum allowed length', 400);
    }
    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      return apiError('message exceeds maximum allowed length', 400);
    }

    try {
      await sendWhatsAppMessage(trimmedPhone, trimmedMessage);
      return apiResponse({ success: true, queued: true });
    } catch (waError) {
      // M1.5-F3 — provider details (waError.message, twilioCode,
      // twilioMoreInfo, provider objects) are logged server-side only and are
      // never echoed to the client. The client always receives a generic
      // delivery failure. The existing 4xx -> 502 mapping for provider-side
      // infrastructure errors is preserved.
      console.error('WhatsApp Provider error:', waError);
      const statusCode = waError.status || 500;
      if (statusCode >= 400 && statusCode < 500) {
        return apiError('WhatsApp delivery failed. Please try again later.', 502);
      }
      return apiError('WhatsApp delivery failed. Please try again later.', statusCode);
    }
  } catch (err) {
    console.error('Share route error:', err);
    return handleServerError(err);
  }
}
