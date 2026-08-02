import { SignJWT, jwtVerify } from 'jose';

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set in .env');
  return new TextEncoder().encode(secret);
};

export async function signToken(payload) {
  const idleMinutes = process.env.SESSION_IDLE_TIMEOUT_MINUTES || '60';
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${idleMinutes}m`)
    .sign(getSecret());
}

export async function verifyToken(token) {
  try {
    const clockTolerance = parseInt(process.env.SESSION_CLOCK_SKEW_SECONDS || '30', 10);
    const { payload } = await jwtVerify(token, getSecret(), {
      clockTolerance
    });
    return payload;
  } catch (err) {
    return null;
  }
}
