import { SignJWT, jwtVerify } from 'jose';
import { config } from '@/app/lib/config/index.mjs';

const getSecret = () => {
  const secret = config.jwt.secret;
  if (!secret) throw new Error('JWT_SECRET is not set in .env');
  return new TextEncoder().encode(secret);
};

export async function signToken(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.session.idleTimeoutMinutes}m`)
    .sign(getSecret());
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      clockTolerance: config.session.clockSkewSeconds,
    });
    return payload;
  } catch (err) {
    return null;
  }
}
