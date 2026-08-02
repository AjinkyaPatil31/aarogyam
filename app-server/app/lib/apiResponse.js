export function apiResponse(data, status = 200) {
  return Response.json(data, { status });
}

export function apiError(message, status = 500, errorCode = null) {
  const payload = { error: message };
  if (errorCode) {
    payload.code = errorCode;
  }
  return Response.json(payload, { status });
}

export function handleServerError(err) {
  console.error('[SERVER_ERROR]', err);
  // Never expose raw error details to the client in production
  return apiError('Internal server error', 500);
}
