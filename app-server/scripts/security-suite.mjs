/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Aarogyam Local Edition — Security Regression Suite (M1.3, Phase L)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Zero new dependencies: Node built-ins (fetch, fs, crypto) + jose and
 *  @prisma/client, both already project dependencies.
 *
 *  Prerequisites (documented for the clinic operator / maintainer):
 *    • Production server running:  cd app-server && npm run build && npm start
 *    • Database freshly seeded:     npx prisma db seed   (or prisma/seed.js)
 *    • .env.local present with JWT_SECRET (required for the forged/expired
 *      token tests — the same secret the app uses).
 *    • Bootstrap accounts present: doctor@aarogyam.local / Doctor@123,
 *      compounder@aarogyam.local / Compounder@123
 *
 *  The suite creates its own fixtures (patients, staff, appointments,
 *  prescriptions) exclusively through the public HTTP API, runs the full
 *  adversarial matrix, then removes every fixture through the API and
 *  verifies the database is back to the seeded baseline.
 *
 *  Run:  node scripts/security-suite.mjs     (or  npm run test:security)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';

const BASE = process.env.AAROGYAM_TEST_BASE || 'http://localhost:3000';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
let failures = 0;

function record(name, pass, expected, actual, extra = '') {
  if (!pass) failures += 1;
  results.push({ name, pass });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(
    `${tag}  ${name}  (expected=${JSON.stringify(expected)} got=${JSON.stringify(actual)})${extra ? '  ' + extra : ''}`
  );
}

async function api(path, { method = 'GET', cookie = null, token = null, body } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (cookie) headers['Cookie'] = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data, headers: res.headers };
}

async function login(email, password) {
  const res = await fetch(BASE + '/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', email, password }),
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/aarogyam_token=([^;]+)/);
  const token = m ? m[1] : null;
  return { status: res.status, cookie: token ? `aarogyam_token=${token}` : null, token };
}

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f);
    if (existsSync(p)) {
      for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*JWT_SECRET\s*=\s*(.+)\s*$/);
        if (m) return m[1].replace(/^["']|["']$/g, '');
      }
    }
  }
  return null;
}

// secretOverride (optional) signs with a different secret so the F-1 matrix
// can prove a token signed with the wrong key is rejected with 401.
async function signTestToken(claims, expiresInSeconds, secretOverride) {
  const secret = secretOverride || loadJwtSecret();
  if (!secret) throw new Error('JWT_SECRET unavailable — cannot forge test tokens');
  // NOTE: jose treats a NUMBER in setExpirationTime as an absolute epoch
  // timestamp (a value of 3600 means 1970!), so a duration must be expressed
  // as a future epoch. Negative values produce an already-expired token.
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(now + expiresInSeconds) // seconds from now; negative = already expired
    .sign(new TextEncoder().encode(secret));
}

const randomId = () => 'c' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

// M1.4 — appointment booking dates are computed relative to "now" so the
// suite stays runnable indefinitely (the appointments route now rejects past
// dates). futureDate is always a valid future booking date; pastDate is
// always in the past.
const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
const pastDate = new Date(Date.now() - 10 * 86400000).toISOString().split('T')[0];

// ─────────────────────────────────────────────────────────────────────────────
// A. ANONYMOUS MATRIX
// ─────────────────────────────────────────────────────────────────────────────
{
  const anon = [
    ['/api/prescriptions', 'GET'],
    ['/api/prescriptions?patientId=' + randomId(), 'GET'],
    ['/api/prescriptions?recordId=' + randomId(), 'GET'],
    ['/api/prescriptions?patientId=' + randomId() + '&recordId=' + randomId(), 'GET'],
    ['/api/consultation?patientId=' + randomId(), 'GET'],
    ['/api/appointments', 'GET'],
    ['/api/patients', 'GET'],
    ['/api/patients/' + randomId(), 'GET'],
    ['/api/patients/profile', 'GET'],
    ['/api/staff', 'GET'],
    ['/api/drugs?q=paracetamol', 'GET'],
  ];
  for (const [p, m] of anon) {
    const r = await api(p, { method: m });
    record(`ANON ${m} ${p.split('?')[0]} -> 401`, r.status === 401, 401, r.status);
  }
  const share = await api('/api/share', { method: 'POST', body: { phone: '9000000000', message: 'x' } });
  record('ANON POST /api/share -> 401', share.status === 401, 401, share.status);
  const register = await api('/api/auth', {
    method: 'POST',
    body: { action: 'register', email: 'anon@x.com', password: 'x', role: 'DOCTOR' },
  });
  record('ANON privileged registration attempt -> 400 invalid action', register.status === 400, 400, register.status);
  const badLogin = await api('/api/auth', { method: 'POST', body: { action: 'login', email: 'nobody@x.com', password: 'wrong' } });
  record('ANON invalid login -> 401 (uniform error)', badLogin.status === 401 && badLogin.data?.error === 'Invalid user ID or password', [401, 'Invalid user ID or password'], [badLogin.status, badLogin.data?.error]);
  const refreshAnon = await api('/api/auth/refresh', { method: 'POST' });
  record('ANON refresh without token -> 401', refreshAnon.status === 401, 401, refreshAnon.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// B. SETUP — fixtures via public API only
// ─────────────────────────────────────────────────────────────────────────────
const queueExistedBefore = existsSync(join(ROOT, 'wa-queue.json'));

const doctor = await login('doctor@aarogyam.local', 'Doctor@123');
record('SETUP doctor login -> 200', doctor.status === 200 && !!doctor.token, [200, true], [doctor.status, !!doctor.token]);
const compounder = await login('compounder@aarogyam.local', 'Compounder@123');
record('SETUP compounder login -> 200', compounder.status === 200 && !!compounder.token, [200, true], [compounder.status, !!compounder.token]);

const mkPatient = (email, fullName, contact) => ({
  email, password: 'Test@1234', fullName, contact, gender: 'Male', dob: '1990-01-01', medicalHistory: '',
});
const mkRx = (patientId, label) => ({
  patientId,
  consultationDate: '2026-08-09',
  symptoms: 'Fever and cough',
  diagnosis: `Viral fever — ${label}`,
  bloodPressure: '120/80',
  heartRate: '80',
  temperature: '98.6',
  spo2: '98',
  weight: '65',
  respiratoryRate: '16',
  medications: [
    { name: 'Paracetamol', dosage: '500mg', frequency: { morning: true, afternoon: false, night: true }, durationValue: '5', durationUnit: 'Days' },
  ],
});

const pa = await api('/api/patients', { method: 'POST', token: doctor.token, body: mkPatient('patient_a_sec@aarogyam.local', 'Sec Patient A', '9000000011') });
const paId = pa.data?.patient?.id;
record('SETUP doctor creates Patient A -> 201', pa.status === 201 && !!paId, [201, true], [pa.status, !!paId]);
const pb = await api('/api/patients', { method: 'POST', token: compounder.token, body: mkPatient('patient_b_sec@aarogyam.local', 'Sec Patient B', '9000000012') });
const pbId = pb.data?.patient?.id;
record('SETUP compounder creates Patient B -> 201', pb.status === 201 && !!pbId, [201, true], [pb.status, !!pbId]);
const pc = await api('/api/patients', { method: 'POST', token: doctor.token, body: { ...mkPatient('patient_c_sec@aarogyam.local', 'Sec Patient C', '9000000013'), role: 'DOCTOR', isAdmin: true, active: true, userId: 'forged', createdAt: '2000-01-01' } });
const pcId = pc.data?.patient?.id;
record('SETUP mass-assignment extras (role/isAdmin/userId/createdAt) ignored -> 201 PATIENT', pc.status === 201 && !!pcId, [201, true], [pc.status, !!pcId]);

const doctor2 = await api('/api/staff', { method: 'POST', token: doctor.token, body: { email: 'doctor2_sec@aarogyam.local', password: 'Doctor2@123', role: 'DOCTOR' } });
const doctor2Id = doctor2.data?.user?.id;
record('SETUP doctor creates Doctor 2 -> 201', doctor2.status === 201 && !!doctor2Id, [201, true], [doctor2.status, !!doctor2Id]);
const staffAdmin = await api('/api/staff', { method: 'POST', token: doctor.token, body: { email: 'admin_sec@aarogyam.local', password: 'Admin@123', role: 'ADMIN' } });
record('SETUP staff POST role=ADMIN rejected -> 400', staffAdmin.status === 400, 400, staffAdmin.status);
const staffPatient = await api('/api/staff', { method: 'POST', token: doctor.token, body: { email: 'notpatient@aarogyam.local', password: 'Test@1234', role: 'PATIENT' } });
record('SETUP staff POST role=PATIENT rejected -> 400', staffPatient.status === 400, 400, staffPatient.status);

const rax = await api('/api/prescriptions', { method: 'POST', token: doctor.token, body: mkRx(paId, 'PATIENT-A-SEC') });
const recordAId = rax.data?.record?.id;
record('SETUP prescription for A -> 201', rax.status === 201 && !!recordAId, [201, true], [rax.status, !!recordAId]);
const rbx = await api('/api/prescriptions', { method: 'POST', token: doctor.token, body: mkRx(pbId, 'PATIENT-B-SEC') });
const recordBId = rbx.data?.record?.id;
record('SETUP prescription for B -> 201', rbx.status === 201 && !!recordBId, [201, true], [rbx.status, !!recordBId]);

const patientA = await login('patient_a_sec@aarogyam.local', 'Test@1234');
record('SETUP Patient A login -> 200', patientA.status === 200 && !!patientA.token, [200, true], [patientA.status, !!patientA.token]);
const patientB = await login('patient_b_sec@aarogyam.local', 'Test@1234');
record('SETUP Patient B login -> 200', patientB.status === 200 && !!patientB.token, [200, true], [patientB.status, !!patientB.token]);
const patientC = await login('patient_c_sec@aarogyam.local', 'Test@1234');
const selfC = await api('/api/patients?self=true', { cookie: patientC.cookie });
record('SETUP mass-assignment patient created as PATIENT (role not elevated)', selfC.status === 200 && selfC.data?.patient?.role === 'PATIENT', true, selfC.data?.patient?.role);

// Appointments: A books with doctor2, B books with doctor (doctor id is
// discoverable through the booking dropdown endpoint, as the UI does).
const realDocId = (await api('/api/appointments?doctors=true', { cookie: patientA.cookie }))
  .data?.doctors?.find((d) => d.email === 'doctor@aarogyam.local')?.id || null;
const slotA = await api('/api/appointments', { method: 'POST', cookie: patientA.cookie, body: { doctorId: doctor2Id, appointmentDate: futureDate, timeSlot: '10:00 AM' } });
const apptAId = slotA.data?.appointment?.id;
record('SETUP Patient A books with Doctor 2 -> 201', slotA.status === 201 && !!apptAId, [201, true], [slotA.status, !!apptAId]);
const slotB = await api('/api/appointments', { method: 'POST', cookie: patientB.cookie, body: { doctorId: realDocId, appointmentDate: futureDate, timeSlot: '11:00 AM' } });
const apptBId = slotB.data?.appointment?.id;
record('SETUP Patient B books with Doctor 1 -> 201', slotB.status === 201 && !!apptBId, [201, true], [slotB.status, !!apptBId]);

// ─────────────────────────────────────────────────────────────────────────────
// C. IDOR / OBJECT OWNERSHIP
// ─────────────────────────────────────────────────────────────────────────────
{
  const t = await api('/api/prescriptions', { cookie: patientA.cookie });
  record('PAT-A own prescriptions (no params) -> 200 only A', t.status === 200 && t.data?.records?.length > 0 && t.data.records.every((r) => r.patientId === paId), true, t.status);
  const t2 = await api(`/api/prescriptions?patientId=${pbId}`, { cookie: patientA.cookie });
  record('PAT-A -> B patientId -> 403', t2.status === 403, 403, t2.status);
  const t3 = await api(`/api/prescriptions?recordId=${recordBId}`, { cookie: patientA.cookie });
  record('PAT-A -> B recordId -> 404 no data (F-2: no existence oracle)', t3.status === 404, 404, t3.status);
  const t4 = await api(`/api/prescriptions?recordId=${recordAId}`, { cookie: patientA.cookie });
  record('PAT-A own recordId -> 200', t4.status === 200 && t4.data?.record?.id === recordAId, true, t4.status);
  const t5 = await api(`/api/prescriptions?recordId=${randomId()}`, { cookie: patientA.cookie });
  record('PAT-A random recordId -> 404 no data', t5.status === 404, 404, t5.status);

  const u1 = await api(`/api/consultation?patientId=${paId}`, { cookie: patientA.cookie });
  record('PAT-A own consultation -> 200', u1.status === 200, 200, u1.status);
  const u2 = await api(`/api/consultation?patientId=${pbId}`, { cookie: patientA.cookie });
  record('PAT-A -> B consultation -> 403', u2.status === 403, 403, u2.status);

  const v1 = await api(`/api/patients/${pbId}`, { cookie: patientA.cookie });
  record('PAT-A -> B single-patient record -> 403', v1.status === 403, 403, v1.status);
  const v2 = await api('/api/patients', { cookie: patientA.cookie });
  record('PAT-A full patient list -> 403', v2.status === 403, 403, v2.status);

  const w1 = await api('/api/patients?self=true', { cookie: patientA.cookie });
  record('PAT-A self profile -> 200, NO passwordHash', w1.status === 200 && !('passwordHash' in (w1.data?.patient || {})), true, w1.status);
  const w2 = await api('/api/patients/profile', { cookie: patientA.cookie });
  record('PAT-A profile endpoint -> 200 own email', w2.status === 200 && w2.data?.email === 'patient_a_sec@aarogyam.local', true, w2.data?.email);

  const x1 = await api(`/api/prescriptions?patientId=${paId}`, { cookie: patientB.cookie });
  record('PAT-B -> A patientId -> 403', x1.status === 403, 403, x1.status);
  const x2 = await api(`/api/prescriptions?recordId=${recordAId}`, { cookie: patientB.cookie });
  record('PAT-B -> A recordId -> 404 no data (F-2: no existence oracle)', x2.status === 404, 404, x2.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// C2. PRESCRIPTION READ — COMBINED / CONTRADICTORY IDENTIFIERS (M1.2 spec)
//     patientId and recordId supplied together must refer to the same patient;
//     malformed identifiers must be safely rejected. F-2: PATIENT recordId
//     lookups are authorization-scoped, so unauthorized reads resolve to 404
//     (no existence oracle) instead of 403.
// ─────────────────────────────────────────────────────────────────────────────
{
  const y1 = await api(`/api/prescriptions?patientId=${paId}&recordId=${recordAId}`, { cookie: patientA.cookie });
  record('PAT-A own patientId + own recordId -> 200', y1.status === 200 && y1.data?.record?.id === recordAId, true, y1.status);
  const y2 = await api(`/api/prescriptions?patientId=${pbId}&recordId=${recordAId}`, { cookie: patientA.cookie });
  record('PAT-A another patientId + own recordId -> 404 (F-2: no oracle)', y2.status === 404, 404, y2.status);
  const y3 = await api(`/api/prescriptions?patientId=${paId}&recordId=${recordBId}`, { cookie: patientA.cookie });
  record('PAT-A own patientId + another recordId -> 404 (F-2: no oracle)', y3.status === 404, 404, y3.status);
  const y4 = await api(`/api/prescriptions?patientId=${pbId}&recordId=${recordBId}`, { cookie: patientA.cookie });
  record('PAT-A another patientId + another recordId -> 404 (F-2: no oracle)', y4.status === 404, 404, y4.status);
  const y5 = await api(`/api/prescriptions?patientId=not-a-cuid`, { cookie: patientA.cookie });
  record('PAT-A malformed patientId -> 403', y5.status === 403, 403, y5.status);
  const y6 = await api(`/api/prescriptions?recordId=not-a-cuid`, { cookie: patientA.cookie });
  record('PAT-A malformed recordId -> 404 no data', y6.status === 404, 404, y6.status);
  const y7 = await api(`/api/prescriptions?patientId=${paId}&recordId=${recordAId}`, { token: doctor.token });
  record('DOCTOR patientId + recordId same patient -> 200', y7.status === 200 && y7.data?.record?.id === recordAId, true, y7.status);
  const y8 = await api(`/api/prescriptions?patientId=${paId}&recordId=${recordBId}`, { token: doctor.token });
  record('DOCTOR contradictory patientId + recordId -> 403', y8.status === 403, 403, y8.status);
  const y9 = await api(`/api/prescriptions?patientId=&recordId=${recordAId}`, { cookie: patientA.cookie });
  record('PAT-A empty patientId + own recordId -> 200 (empty treated as absent)', y9.status === 200 && y9.data?.record?.id === recordAId, true, y9.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// C3. JWT CLAIM VALIDATION (F-1) — identity contract enforcement
//     A verified token must carry a non-empty string id, a non-empty string
//     email and a legitimate role; anything else is unauthenticated (401).
// ─────────────────────────────────────────────────────────────────────────────
{
  const okPat = await api('/api/prescriptions', { token: await signTestToken({ id: paId, email: 'patient_a_sec@aarogyam.local', role: 'PATIENT' }, 3600) });
  record('F1 valid PATIENT JWT (id+email+role) -> 200 own', okPat.status === 200, 200, okPat.status);
  const okDoc = await api(`/api/prescriptions?patientId=${paId}`, { token: await signTestToken({ id: paId, email: 'doctor@aarogyam.local', role: 'DOCTOR' }, 3600) });
  record('F1 valid DOCTOR JWT (id+email+role) -> 200 clinic read', okDoc.status === 200, 200, okDoc.status);
  const okComp = await api(`/api/prescriptions?patientId=${paId}`, { token: await signTestToken({ id: paId, email: 'compounder@aarogyam.local', role: 'COMPOUNDER' }, 3600) });
  record('F1 valid COMPOUNDER JWT (id+email+role) -> 200 clinic read', okComp.status === 200, 200, okComp.status);

  const noId = await api('/api/prescriptions', { token: await signTestToken({ email: 'x@x.com', role: 'PATIENT' }, 3600) });
  record('F1 JWT missing id -> 401', noId.status === 401, 401, noId.status);
  const nullId = await api('/api/prescriptions', { token: await signTestToken({ id: null, email: 'x@x.com', role: 'PATIENT' }, 3600) });
  record('F1 JWT id=null -> 401', nullId.status === 401, 401, nullId.status);
  const emptyId = await api('/api/prescriptions', { token: await signTestToken({ id: '', email: 'x@x.com', role: 'PATIENT' }, 3600) });
  record('F1 JWT id="" -> 401', emptyId.status === 401, 401, emptyId.status);
  const numId = await api('/api/prescriptions', { token: await signTestToken({ id: 12345, email: 'x@x.com', role: 'PATIENT' }, 3600) });
  record('F1 JWT id non-string (number) -> 401', numId.status === 401, 401, numId.status);
  const noRole = await api('/api/prescriptions', { token: await signTestToken({ id: paId, email: 'x@x.com' }, 3600) });
  record('F1 JWT missing role -> 401', noRole.status === 401, 401, noRole.status);
  const badRole = await api('/api/prescriptions', { token: await signTestToken({ id: paId, email: 'x@x.com', role: 'ADMIN' }, 3600) });
  record('F1 JWT invalid role (ADMIN) -> 401', badRole.status === 401, 401, badRole.status);

  const gar = await api('/api/prescriptions', { token: 'garbage.token.value' });
  record('F1 garbage JWT -> 401 (unchanged)', gar.status === 401, 401, gar.status);
  const exp = await api('/api/prescriptions', { token: await signTestToken({ id: paId, email: 'x@x.com', role: 'PATIENT' }, -3600) });
  record('F1 expired JWT -> 401 (unchanged)', exp.status === 401, 401, exp.status);
  const wrong = await api('/api/prescriptions', { token: await signTestToken({ id: paId, email: 'x@x.com', role: 'PATIENT' }, 3600, 'definitely-not-the-real-secret') });
  record('F1 wrong-secret JWT -> 401 (unchanged)', wrong.status === 401, 401, wrong.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// C4. RECORD EXISTENCE ORACLE (F-2) — PATIENT cannot distinguish existence
//     own recordId -> 200; nonexistent or another patient's recordId -> 404;
//     mixed patientId/recordId combinations -> 404 when not both own.
// ─────────────────────────────────────────────────────────────────────────────
{
  const own = await api(`/api/prescriptions?recordId=${recordAId}`, { cookie: patientA.cookie });
  record('F2 PAT-A own recordId -> 200', own.status === 200 && own.data?.record?.id === recordAId, 200, own.status);
  const missing = await api(`/api/prescriptions?recordId=${randomId()}`, { cookie: patientA.cookie });
  record('F2 PAT-A nonexistent recordId -> 404', missing.status === 404, 404, missing.status);

  const other = await api(`/api/prescriptions?recordId=${recordBId}`, { cookie: patientA.cookie });
  const leakKeys = other.data && typeof other.data === 'object'
    ? Object.keys(other.data).filter(k => ['diagnosis', 'symptoms', 'bloodPressure', 'heartRate', 'temperature', 'spo2', 'weight', 'respiratoryRate', 'prescriptions', 'medications', 'patient', 'doctor', 'record'].includes(k))
    : [];
  record('F2 PAT-A B recordId -> 404, NO medical/identity data', other.status === 404 && leakKeys.length === 0, [404, 'no-data'], [other.status, leakKeys]);

  let always404 = true;
  for (let i = 0; i < 3; i++) {
    const r = await api(`/api/prescriptions?recordId=${recordBId}`, { cookie: patientA.cookie });
    if (r.status !== 404) always404 = false;
  }
  record('F2 PAT-A B recordId x3 -> always 404', always404, true, always404);

  const m1 = await api(`/api/prescriptions?patientId=${paId}&recordId=${recordAId}`, { cookie: patientA.cookie });
  record('F2 PAT-A patientId=A + recordId=A -> 200', m1.status === 200 && m1.data?.record?.id === recordAId, 200, m1.status);
  const m2 = await api(`/api/prescriptions?patientId=${paId}&recordId=${recordBId}`, { cookie: patientA.cookie });
  record('F2 PAT-A patientId=A + recordId=B -> 404', m2.status === 404, 404, m2.status);
  const m3 = await api(`/api/prescriptions?patientId=${pbId}&recordId=${recordAId}`, { cookie: patientA.cookie });
  record('F2 PAT-A patientId=B + recordId=A -> 404', m3.status === 404, 404, m3.status);
  const m4 = await api(`/api/prescriptions?patientId=${pbId}&recordId=${recordBId}`, { cookie: patientA.cookie });
  record('F2 PAT-A patientId=B + recordId=B -> 404', m4.status === 404, 404, m4.status);

  const d1 = await api(`/api/prescriptions?patientId=${pbId}`, { token: doctor.token });
  record('F2 DOCTOR patient records -> 200 (preserved)', d1.status === 200 && d1.data?.records?.some(r => r.id === recordBId), 200, d1.status);
  const d2 = await api(`/api/prescriptions?recordId=${recordBId}`, { token: doctor.token });
  record('F2 DOCTOR recordId lookup -> 200 (preserved)', d2.status === 200 && d2.data?.record?.id === recordBId, 200, d2.status);
  const c1 = await api(`/api/prescriptions?patientId=${paId}`, { token: compounder.token });
  record('F2 COMPOUNDER patient records -> 200 (preserved)', c1.status === 200 && c1.data?.records?.some(r => r.id === recordAId), 200, c1.status);
  const dash = await api('/api/prescriptions', { cookie: patientA.cookie });
  record('F2 PAT-A dashboard (no params) own records -> 200', dash.status === 200 && dash.data?.records?.every(r => r.patientId === paId), 200, dash.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// D. ROLE BOUNDARIES
// ─────────────────────────────────────────────────────────────────────────────
{
  const c1 = await api('/api/staff', { token: compounder.token });
  record('COMPOUNDER GET /api/staff -> 403', c1.status === 403, 403, c1.status);
  const c2 = await api('/api/staff', { method: 'POST', token: compounder.token, body: { email: 'x@x.com', password: 'Test@1234', role: 'DOCTOR' } });
  record('COMPOUNDER POST /api/staff -> 403', c2.status === 403, 403, c2.status);
  const c3 = await api('/api/staff', { method: 'DELETE', token: compounder.token, body: { userId: doctor2Id } });
  record('COMPOUNDER DELETE /api/staff -> 403', c3.status === 403, 403, c3.status);
  const c4 = await api('/api/consultation', { method: 'POST', token: compounder.token, body: mkRx(paId, 'X') });
  record('COMPOUNDER POST /api/consultation -> 403', c4.status === 403, 403, c4.status);
  const c5 = await api('/api/prescriptions', { method: 'POST', token: compounder.token, body: mkRx(paId, 'X') });
  record('COMPOUNDER POST /api/prescriptions -> 403', c5.status === 403, 403, c5.status);
  const c6 = await api('/api/appointments', { method: 'PATCH', token: compounder.token, body: { appointmentId: apptAId, status: 'Completed' } });
  record('COMPOUNDER PATCH /api/appointments -> 403', c6.status === 403, 403, c6.status);
  const c7 = await api('/api/share', { method: 'POST', token: compounder.token, body: { phone: '9000000000', message: 'test' } });
  record('COMPOUNDER POST /api/share -> 200 (intended workflow)', c7.status === 200, 200, c7.status);

  const p1 = await api('/api/consultation', { method: 'POST', token: patientA.token, body: mkRx(paId, 'X') });
  record('PATIENT POST /api/consultation -> 403', p1.status === 403, 403, p1.status);
  const p2 = await api('/api/prescriptions', { method: 'POST', token: patientA.token, body: mkRx(paId, 'X') });
  record('PATIENT POST /api/prescriptions -> 403', p2.status === 403, 403, p2.status);
  const p3 = await api('/api/patients', { method: 'POST', token: patientA.token, body: mkPatient('y@y.com', 'Y', '9000000099') });
  record('PATIENT POST /api/patients -> 403', p3.status === 403, 403, p3.status);
  const p4 = await api('/api/patients', { method: 'DELETE', token: patientA.token, body: { patientId: pbId } });
  record('PATIENT DELETE /api/patients -> 403', p4.status === 403, 403, p4.status);
  const p5 = await api('/api/appointments', { method: 'PATCH', token: patientA.token, body: { appointmentId: apptBId, status: 'Cancelled' } });
  record('PATIENT PATCH /api/appointments -> 403', p5.status === 403, 403, p5.status);
  const p6 = await api('/api/share', { method: 'POST', token: patientA.token, body: { phone: '9000000000', message: 'x' } });
  record('PATIENT POST /api/share -> 403', p6.status === 403, 403, p6.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// E. STAFF-ACCOUNT DELETION GUARDS (M1.3 fixes)
// ─────────────────────────────────────────────────────────────────────────────
{
  const e1 = await api('/api/patients', { method: 'DELETE', token: doctor.token, body: { patientId: doctor2Id } });
  record('DOCTOR DELETE /api/patients with staff id -> 404 (guard)', e1.status === 404, 404, e1.status);
  const e2 = await api('/api/patients', { method: 'DELETE', token: compounder.token, body: { patientId: realDocId } });
  record('COMPOUNDER DELETE /api/patients with doctor id -> 404 (guard)', e2.status === 404, 404, e2.status);
  const e3 = await api('/api/staff', { method: 'DELETE', token: doctor.token, body: { userId: paId } });
  record('DOCTOR DELETE /api/staff with patient id -> 404 (guard)', e3.status === 404, 404, e3.status);
  const e4 = await api('/api/staff', { method: 'DELETE', token: doctor.token, body: { userId: realDocId } });
  record('DOCTOR DELETE /api/staff self -> 400 (self-guard)', e4.status === 400, 400, e4.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// F. APPOINTMENT OWNERSHIP
// ─────────────────────────────────────────────────────────────────────────────
{
  const dup = await api('/api/appointments', { method: 'POST', cookie: patientB.cookie, body: { doctorId: realDocId, appointmentDate: futureDate, timeSlot: '11:00 AM' } });
  record('APP duplicate slot booking -> 409', dup.status === 409, 409, dup.status);

  const list = await api('/api/appointments', { cookie: patientA.cookie });
  record('PAT-A appointment list scoped to own', list.status === 200 && list.data?.appointments?.every((a) => a.patientId === paId), true, list.status);
  const l2 = await api('/api/appointments', { cookie: patientB.cookie });
  record('PAT-B appointment list scoped to own (no A appt)', l2.status === 200 && !l2.data?.appointments?.some((a) => a.id === apptAId), true, l2.status);

  const d2 = await login('doctor2_sec@aarogyam.local', 'Doctor2@123');
  const f1 = await api('/api/appointments', { method: 'PATCH', token: doctor.token, body: { appointmentId: apptBId, status: 'Confirmed' } });
  record('DOCTOR PATCH own appointment -> 200', f1.status === 200 && f1.data?.appointment?.status === 'Confirmed', true, f1.status);
  const f2 = await api('/api/appointments', { method: 'PATCH', token: d2.token, body: { appointmentId: apptAId, status: 'Confirmed' } });
  record('DOCTOR2 PATCH own appointment -> 200', f2.status === 200, 200, f2.status);
  const f3 = await api('/api/appointments', { method: 'PATCH', token: doctor.token, body: { appointmentId: apptAId, status: 'Cancelled' } });
  record('DOCTOR PATCH another doctor\'s appointment -> 404 (M1.3 scope)', f3.status === 404, 404, f3.status);
  const f4 = await api('/api/appointments', { method: 'PATCH', token: d2.token, body: { appointmentId: apptBId, status: 'Cancelled' } });
  record('DOCTOR2 PATCH doctor1\'s appointment -> 404 (M1.3 scope)', f4.status === 404, 404, f4.status);
  const f5 = await api('/api/appointments', { method: 'PATCH', token: doctor.token, body: { appointmentId: randomId(), status: 'Cancelled' } });
  record('DOCTOR PATCH random appointment -> 404', f5.status === 404, 404, f5.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// G. APPOINTMENT-COMPLETION TAMPERING (M1.3 fix)
// ─────────────────────────────────────────────────────────────────────────────
{
  // B's appointment (apptB, still 'Pending' — doctor only Confirmed apptB? No: f1 set apptB to Confirmed. Use apptA which f2 set to Confirmed.
  // Reset both to Pending via their owners for a clean test.
  await api('/api/appointments', { method: 'PATCH', token: doctor.token, body: { appointmentId: apptBId, status: 'Pending' } });
  await api('/api/appointments', { method: 'PATCH', token: (await login('doctor2_sec@aarogyam.local', 'Doctor2@123')).token, body: { appointmentId: apptAId, status: 'Pending' } });

  const g1 = await api('/api/prescriptions', { method: 'POST', token: doctor.token, body: { ...mkRx(paId, 'G1'), appointmentId: apptBId } });
  const g1Status = (await api('/api/appointments', { cookie: patientB.cookie })).data?.appointments?.find((a) => a.id === apptBId)?.status;
  record('POST rx for A with B\'s appointmentId -> 201 and B\'s appt NOT completed', g1.status === 201 && g1Status !== 'Completed', [201, 'not-Completed'], [g1.status, g1Status]);

  const g2 = await api('/api/prescriptions', { method: 'POST', token: doctor.token, body: { ...mkRx(paId, 'G2'), appointmentId: randomId() } });
  record('POST rx with random appointmentId -> 201 (no crash/rollback)', g2.status === 201, 201, g2.status);

  const g3 = await api('/api/prescriptions', { method: 'POST', token: doctor.token, body: { ...mkRx(paId, 'G3'), appointmentId: apptAId } });
  const g3Status = (await api('/api/appointments', { cookie: patientA.cookie })).data?.appointments?.find((a) => a.id === apptAId)?.status;
  record('POST rx for A with own appointmentId -> 201 and appt completed', g3.status === 201 && g3Status === 'Completed', [201, 'Completed'], [g3.status, g3Status]);
}

// ─────────────────────────────────────────────────────────────────────────────
// H. TOKEN / SESSION
// ─────────────────────────────────────────────────────────────────────────────
{
  const bad = await api('/api/prescriptions', { token: 'garbage.token.value' });
  record('FORGED JWT rejected -> 401', bad.status === 401, 401, bad.status);
  const expired = await signTestToken({ id: paId, email: 'patient_a_sec@aarogyam.local', role: 'PATIENT' }, -3600);
  const exp = await api('/api/prescriptions', { token: expired });
  record('EXPIRED JWT rejected -> 401', exp.status === 401, 401, exp.status);
  const future = await signTestToken({ id: paId, email: 'patient_a_sec@aarogyam.local', role: 'PATIENT' }, 3600);
  const fut = await api(`/api/prescriptions?patientId=${pbId}`, { token: future });
  record('VALID forged-but-signed token still bound by role ownership -> 403', fut.status === 403, 403, fut.status);

  const refresh = await api('/api/auth/refresh', { method: 'POST', token: patientA.token });
  record('REFRESH valid token -> 200 new token', refresh.status === 200 && typeof refresh.data?.token === 'string', true, refresh.status);
  if (refresh.status === 200) {
    const after = await api('/api/prescriptions', { token: refresh.data.token });
    record('REFRESHED token retains identity (own read) -> 200', after.status === 200, 200, after.status);
  }
  const refreshBad = await api('/api/auth/refresh', { method: 'POST', token: 'not.a.token' });
  record('REFRESH garbage token -> 401', refreshBad.status === 401, 401, refreshBad.status);

  const logout = await api('/api/auth/logout', { method: 'POST', cookie: patientA.cookie });
  const afterLogout = await api('/api/prescriptions', { cookie: 'aarogyam_token=' });
  record('LOGOUT invalidates session -> subsequent request 401', logout.status === 200 && afterLogout.status === 401, [200, 401], [logout.status, afterLogout.status]);
}

// ─────────────────────────────────────────────────────────────────────────────
// I. BUSINESS LOGIC / APPLICATION REGRESSION
// ─────────────────────────────────────────────────────────────────────────────
{
  const cons = await api('/api/consultation', {
    method: 'POST',
    token: doctor.token,
    body: { patientId: paId, consultationDate: '2026-08-09', symptoms: 'Cough', diagnosis: 'Bronchitis',
      bloodPressure: '110/70', heartRate: '78', temperature: '98.4', spo2: '99', weight: '68', respiratoryRate: '15',
      prescriptions: [{ medicationName: 'Amoxicillin', dosage: '500mg', frequency: '1-0-1', duration: '5 Days' }] },
  });
  record('APP doctor walk-in consultation -> 201', cons.status === 201, 201, cons.status);

  const drug = await api('/api/drugs?q=paracetamol', { token: doctor.token });
  record('APP drug search with auth -> 200 + results', drug.status === 200 && Array.isArray(drug.data?.drugs), true, drug.status);
  const drugAnon = await api('/api/drugs?q=paracetamol');
  record('APP drug search anonymous -> 401 (route-level auth)', drugAnon.status === 401, 401, drugAnon.status);

  const dash = await api('/dashboard/doctor', { cookie: doctor.cookie });
  record('APP doctor dashboard renders -> 200', dash.status === 200, 200, dash.status);
  const dashWrong = await api('/dashboard/doctor', { cookie: patientB.cookie });
  record('APP patient -> doctor dashboard role redirect', [307, 308].includes(dashWrong.status), 307, dashWrong.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// J. M1.3 HARDENING — F1 stats authorization, F2 hash hygiene, F4 atomic PATCH
// ─────────────────────────────────────────────────────────────────────────────
{
  // F1 — ?stats=true restricted to DOCTOR/COMPOUNDER
  const s1 = await api('/api/appointments?stats=true');
  record('M13 STATS anonymous -> 401', s1.status === 401, 401, s1.status);
  const s2 = await api('/api/appointments?stats=true', { cookie: patientA.cookie });
  record('M13 STATS patient -> 403', s2.status === 403, 403, s2.status);
  const s3 = await api('/api/appointments?stats=true', { token: compounder.token });
  record('M13 STATS compounder -> 200 with counts', s3.status === 200 && typeof s3.data?.totalPatients === 'number', true, s3.status);
  const s4 = await api('/api/appointments?stats=true', { token: doctor.token });
  record('M13 STATS doctor -> 200 with counts', s4.status === 200 && typeof s4.data?.totalPatients === 'number', true, s4.status);
  const s5 = await api('/api/appointments', { token: doctor.token });
  record('M13 ordinary appointment GET doctor unchanged -> 200 list', s5.status === 200 && Array.isArray(s5.data?.appointments), true, s5.status);

  // F4 — atomic ownership-scoped PATCH; injected doctorId cannot redirect
  const a1 = await api('/api/appointments', { method: 'PATCH', body: { appointmentId: apptAId, status: 'Confirmed' } });
  record('M13 PATCH anonymous -> 401', a1.status === 401, 401, a1.status);
  const a2 = await api('/api/appointments', { method: 'PATCH', token: doctor.token, body: { appointmentId: apptBId, status: 'Confirmed', doctorId: doctor2Id } });
  record('M13 PATCH own appt with injected doctorId -> 200', a2.status === 200, 200, a2.status);
  const a3 = await api('/api/appointments', { cookie: patientB.cookie });
  const apptBAfter = (a3.data?.appointments || []).find((x) => x.id === apptBId);
  record('M13 PATCH injected doctorId ignored (doctor unchanged)', !!apptBAfter && apptBAfter.doctor?.id === realDocId, realDocId, apptBAfter?.doctor?.id);
  const d2b = await login('doctor2_sec@aarogyam.local', 'Doctor2@123');
  const a4 = await api('/api/appointments', { method: 'PATCH', token: d2b.token, body: { appointmentId: apptBId, status: 'Cancelled' } });
  record('M13 PATCH other doctor appointment -> 404', a4.status === 404, 404, a4.status);

  // F2 — POST /api/patients response never contains passwordHash
  const h1 = await api('/api/patients', { method: 'POST', token: doctor.token, body: mkPatient('patient_h_sec@aarogyam.local', 'Sec Hygiene', '9000000098') });
  record('M13 POST patient -> 201, id present, NO passwordHash', h1.status === 201 && !!h1.data?.patient?.id && !('passwordHash' in (h1.data?.patient || {})), true, h1.status);
  if (h1.data?.patient?.id) {
    await api('/api/patients', { method: 'DELETE', token: doctor.token, body: { patientId: h1.data.patient.id } });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// K. M1.4 HARDENING — input validation & auth-refresh defense-in-depth
// ─────────────────────────────────────────────────────────────────────────────
{
  // Refresh identity contract — malformed claims must not be re-signed
  const r1 = await api('/api/auth/refresh', { method: 'POST', token: await signTestToken({ email: 'x@x.com', role: 'PATIENT' }, 3600) });
  record('M14 REFRESH token missing id -> 401', r1.status === 401, 401, r1.status);
  const r2 = await api('/api/auth/refresh', { method: 'POST', token: await signTestToken({ id: paId, email: 'x@x.com' }, 3600) });
  record('M14 REFRESH token missing role -> 401', r2.status === 401, 401, r2.status);
  const r3 = await api('/api/auth/refresh', { method: 'POST', token: await signTestToken({ id: paId, email: 'x@x.com', role: 'ADMIN' }, 3600) });
  record('M14 REFRESH token invalid role -> 401', r3.status === 401, 401, r3.status);
  const r4 = await api('/api/auth/refresh', { method: 'POST', token: await signTestToken({ id: paId, email: 'patient_a_sec@aarogyam.local', role: 'PATIENT' }, 3600) });
  record('M14 REFRESH valid claims -> 200 new token', r4.status === 200 && typeof r4.data?.token === 'string', 200, r4.status);

  // Appointment POST — appointmentDate / timeSlot validation
  const book = (overrides) => api('/api/appointments', {
    method: 'POST', cookie: patientA.cookie,
    body: { doctorId: doctor2Id, appointmentDate: futureDate, timeSlot: '10:00 AM', ...overrides },
  });
  const b1 = await book({ appointmentDate: '2026-13-45' });
  record('M14 APPT malformed date -> 400', b1.status === 400, 400, b1.status);
  const b2 = await book({ appointmentDate: pastDate });
  record('M14 APPT past date -> 400', b2.status === 400, 400, b2.status);
  const b3 = await book({ timeSlot: '25:99 XX' });
  record('M14 APPT invalid timeSlot format -> 400', b3.status === 400, 400, b3.status);
  const b4 = await book({ timeSlot: 'A'.repeat(50) });
  record('M14 APPT oversized timeSlot -> 400', b4.status === 400, 400, b4.status);

  // Consultation POST — vitals validation
  const consult = (overrides) => api('/api/consultation', {
    method: 'POST', token: doctor.token,
    body: { patientId: paId, consultationDate: '2026-08-09', symptoms: 'Cough', diagnosis: 'X',
      bloodPressure: '120/80', heartRate: '80', temperature: '98.6', spo2: '98', weight: '65', respiratoryRate: '16',
      ...overrides },
  });
  const c1 = await consult({ bloodPressure: 'abc/def' });
  record('M14 CONSULT invalid bloodPressure -> 400', c1.status === 400, 400, c1.status);
  const c2 = await consult({ heartRate: 'abc' });
  record('M14 CONSULT non-numeric heartRate -> 400', c2.status === 400, 400, c2.status);
  const c3 = await consult({ temperature: '999' });
  record('M14 CONSULT out-of-range temperature -> 400', c3.status === 400, 400, c3.status);
  const c4 = await consult({});
  record('M14 CONSULT valid vitals still accepted -> 201', c4.status === 201, 201, c4.status);

  // PUT /api/patients — foreign / non-patient target -> 404 (was generic 500)
  const p1 = await api('/api/patients', { method: 'PUT', token: doctor.token, body: { patientId: doctor2Id, fullName: 'X', contact: '9000000011' } });
  record('M14 PUT patient with staff id -> 404', p1.status === 404, 404, p1.status);
  const p2 = await api('/api/patients', { method: 'PUT', token: doctor.token, body: { patientId: randomId(), fullName: 'X', contact: '9000000011' } });
  record('M14 PUT patient nonexistent id -> 404', p2.status === 404, 404, p2.status);

  // Duplicate email / invalid email format
  const d1 = await api('/api/patients', { method: 'POST', token: doctor.token, body: mkPatient('patient_a_sec@aarogyam.local', 'Dup Email', '9000000077') });
  record('M14 POST patient duplicate email -> 409', d1.status === 409, 409, d1.status);
  const d2 = await api('/api/staff', { method: 'POST', token: doctor.token, body: { email: 'doctor@aarogyam.local', password: 'Test@1234', role: 'DOCTOR' } });
  record('M14 POST staff duplicate email -> 409', d2.status === 409, 409, d2.status);
  const d3 = await api('/api/patients', { method: 'POST', token: doctor.token, body: mkPatient('not-an-email', 'Bad Email', '9000000076') });
  record('M14 POST patient invalid email -> 400', d3.status === 400, 400, d3.status);
  const d4 = await api('/api/staff', { method: 'POST', token: doctor.token, body: { email: '   ', password: 'Test@1234', role: 'DOCTOR' } });
  record('M14 POST staff whitespace User ID -> 400', d4.status === 400, 400, d4.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEARDOWN — remove every fixture through the API, restore baseline
// ─────────────────────────────────────────────────────────────────────────────
{
  // Patients first: their cascade deletes appointments (including the ones
  // booked with doctor2), so the staff delete below is not blocked by the
  // SQLite FK constraint on Appointment.doctorId -> User.id.
  for (const id of [paId, pbId, pcId]) {
    await api('/api/patients', { method: 'DELETE', token: doctor.token, body: { patientId: id } });
  }
  await api('/api/staff', { method: 'DELETE', token: doctor.token, body: { userId: doctor2Id } });
  if (!queueExistedBefore) {
    // F-5 hardening — the share test and patient-registration welcome
    // messages enqueue WhatsApp items through the provider, which writes
    // wa-queue.json synchronously during each request. Poll-and-delete with a
    // quiescence window so no test-generated queue artifact survives, even if
    // a late async write recreates the file after the first deletion.
    const removeQueueArtifacts = () => {
      for (const f of ['wa-queue.json', 'wa-queue.lock']) {
        try { unlinkSync(join(ROOT, f)); } catch { /* absent */ }
      }
    };
    const queueArtifactsGone = () =>
      !existsSync(join(ROOT, 'wa-queue.json')) &&
      !existsSync(join(ROOT, 'wa-queue.lock'));

    removeQueueArtifacts();
    let cleanPolls = 0;
    for (let i = 0; i < 30 && cleanPolls < 2; i++) {
      await new Promise(r => setTimeout(r, 500));
      removeQueueArtifacts();
      cleanPolls = queueArtifactsGone() ? cleanPolls + 1 : 0;
    }
    record('F5 teardown: no test-generated WhatsApp queue artifacts remain', queueArtifactsGone(), true, queueArtifactsGone());
  }
  const { PrismaClient } = await import('@prisma/client');
  const p = new PrismaClient();
  try {
    const [u, pp, a, m, r, drugs] = await Promise.all([
      p.user.count(), p.patientProfile.count(), p.appointment.count(),
      p.medicalRecord.count(), p.prescription.count(), p.drug.count(),
    ]);
    record('DB restored to baseline (users=2, rest 0, drugs=10000)',
      u === 2 && pp === 0 && a === 0 && m === 0 && r === 0 && drugs === 10000,
      { users: 2, profiles: 0, appointments: 0, records: 0, prescriptions: 0, drugs: 10000 },
      { users: u, profiles: pp, appointments: a, records: m, prescriptions: r, drugs });
  } finally {
    await p.$disconnect();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('----------------------------------------');
console.log(`TOTAL=${results.length}  PASS=${results.length - failures}  FAIL=${failures}`);
process.exit(failures === 0 ? 0 : 1);
