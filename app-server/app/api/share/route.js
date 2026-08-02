import { NextResponse } from 'next/server';
import { sendWhatsAppMessage } from '@/app/lib/whatsappProvider';
import { requireRole } from '@/app/lib/authHelpers';
import { apiResponse, apiError, handleServerError } from '@/app/lib/apiResponse';

export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const authCheck = await requireRole(req, ['DOCTOR', 'COMPOUNDER']);
    if (authCheck.errorResponse) return authCheck.errorResponse;

    const { phone, message } = await req.json();
    if (!phone || !message) {
      return apiError('phone and message are required', 400);
    }

    try {
      await sendWhatsAppMessage(phone, message);
      console.log(`📬 Message sent/queued for ${phone}`);
      return apiResponse({ success: true, queued: true });
    } catch (waError) {
      console.error('WhatsApp Provider error:', waError);
      // Preserve Twilio error details: HTTP status, error code, and error message
      const statusCode = waError.status || 500;
      const detail = waError.twilioMoreInfo ? ` (see: ${waError.twilioMoreInfo})` : '';
      const errorMessage = waError.message || 'WhatsApp delivery failed';
      const responsePayload = { error: errorMessage };
      if (waError.code !== undefined) {
        responsePayload.twilioCode = waError.code;
      }
      // Map Twilio infrastructure errors (4xx) to 502 Bad Gateway
      if (statusCode >= 400 && statusCode < 500) {
        return apiError(`WhatsApp service error: ${errorMessage}${detail}`, 502);
      }
      return apiError(errorMessage, statusCode);
    }
  } catch (err) {
    console.error('Share route error:', err);
    return handleServerError(err);
  }
}
