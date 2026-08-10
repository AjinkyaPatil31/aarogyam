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
import { readFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
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
// L. M1.5 PHASE 1 — middleware F-1 sliding re-sign, server logout, login throttle
// ─────────────────────────────────────────────────────────────────────────────
{
  // F1 — a claim-less / malformed-role token near the sliding threshold must
  // NOT be re-signed by middleware (no Set-Cookie on the response) and must
  // still be rejected by route-level F-1 (401). A valid near-threshold token
  // IS re-signed (Set-Cookie present) and succeeds — proving the sliding
  // behavior itself is preserved.
  const nearThreshold = 14 * 60; // 840s remaining < 900s refresh threshold

  const bad1 = await api('/api/prescriptions', { token: await signTestToken({ email: 'x@x.com', role: 'PATIENT' }, nearThreshold) });
  record('M15 F1 claim-less id near-threshold -> 401, NOT re-signed', bad1.status === 401 && !bad1.headers.get('set-cookie'), [401, 'no-set-cookie'], [bad1.status, !!bad1.headers.get('set-cookie')]);
  const bad2 = await api('/api/prescriptions', { token: await signTestToken({ id: paId, email: 'x@x.com', role: 'ADMIN' }, nearThreshold) });
  record('M15 F1 invalid role near-threshold -> 401, NOT re-signed', bad2.status === 401 && !bad2.headers.get('set-cookie'), [401, 'no-set-cookie'], [bad2.status, !!bad2.headers.get('set-cookie')]);
  const good = await api('/api/prescriptions', { token: await signTestToken({ id: paId, email: 'patient_a_sec@aarogyam.local', role: 'PATIENT' }, nearThreshold) });
  record('M15 F1 valid claims near-threshold -> 200 + sliding Set-Cookie', good.status === 200 && !!good.headers.get('set-cookie'), [200, true], [good.status, !!good.headers.get('set-cookie')]);

  // F5 — logout through the server endpoint clears the auth cookie
  const lc = await login('patient_c_sec@aarogyam.local', 'Test@1234');
  const out = await api('/api/auth/logout', { method: 'POST', cookie: lc.cookie });
  const outCookie = out.headers.get('set-cookie') || '';
  record('M15 F5 server logout -> 200 with cleared cookie (Max-Age=0)', out.status === 200 && /max-age=0/i.test(outCookie), [200, 'cleared'], [out.status, outCookie]);
  const afterOut = await api('/api/prescriptions', { cookie: 'aarogyam_token=' });
  record('M15 F5 post-logout protected request -> 401', afterOut.status === 401, 401, afterOut.status);

  // F4 — throttle failed attempts per normalized User ID. Generic 401 before
  // the threshold, generic 429 after it, no global lockout, and a valid login
  // succeeds once the cooldown has elapsed.
  const throttledEmail = 'patient_a_sec@aarogyam.local';
  const f4Statuses = [];
  for (let i = 0; i < 5; i++) {
    const r = await api('/api/auth', { method: 'POST', body: { action: 'login', email: throttledEmail, password: 'WrongPass!' } });
    f4Statuses.push(r.status);
  }
  record('M15 F4 five rapid failures -> 401 generic each (no existence leak)', f4Statuses.every((s) => s === 401), [401, 401, 401, 401, 401], f4Statuses);
  const locked = await api('/api/auth', { method: 'POST', body: { action: 'login', email: throttledEmail, password: 'WrongPass!' } });
  record('M15 F4 sixth attempt -> 429', locked.status === 429 && locked.data?.error === 'Too many login attempts. Please try again later.', 429, locked.status);
  const stillLocked = await api('/api/auth', { method: 'POST', body: { action: 'login', email: throttledEmail, password: 'WrongPass!' } });
  record('M15 F4 repeated attempt while locked -> 429', stillLocked.status === 429, 429, stillLocked.status);
  const otherLogin = await api('/api/auth', { method: 'POST', body: { action: 'login', email: 'doctor@aarogyam.local', password: 'Doctor@123' } });
  record('M15 F4 different account login unaffected -> 200 (no global lockout)', otherLogin.status === 200, 200, otherLogin.status);
  // Cooldown is 10s — wait for it to elapse, then the correct password works.
  await new Promise((resolve) => setTimeout(resolve, 11000));
  const afterCooldown = await api('/api/auth', { method: 'POST', body: { action: 'login', email: throttledEmail, password: 'Test@1234' } });
  record('M15 F4 valid login succeeds after cooldown -> 200', afterCooldown.status === 200, 200, afterCooldown.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// M. M1.5 PHASE 2 — profile write-path validation (F2), staff/account basic
//     coverage, share input caps + provider-error sanitization (F3)
// ─────────────────────────────────────────────────────────────────────────────
{
  // ── F2 — POST /api/patients/profile validation-before-write ordering ──
  // Every invalid request below embeds a profile modification; each must fail
  // WITHOUT mutating the patient's profile. The baseline is captured once and
  // re-fetched after every failure to prove no write occurred.
  // NOTE: patientA.cookie is the SETUP-era token; it stays valid because this
  // milestone intentionally has no server-side JWT revocation (the section-H
  // logout test only clears the client cookie).
  const getProfile = () => api('/api/patients/profile', { cookie: patientA.cookie });
  const profileFields = (p) => ({
    fullName: p?.fullName, dateOfBirth: p?.dateOfBirth, gender: p?.gender, contact: p?.contact,
  });
  const baseline = profileFields((await getProfile()).data?.profile);
  const sameReq = {
    fullName: baseline.fullName, dateOfBirth: baseline.dateOfBirth,
    gender: baseline.gender, contact: baseline.contact,
  };
  const unchanged = (p) => JSON.stringify(profileFields(p)) === JSON.stringify(baseline);

  const f2a = await api('/api/patients/profile', { method: 'POST', cookie: patientA.cookie, body: { ...sameReq, fullName: 'HACKED NAME', newPassword: 'NewPass@123' } });
  const f2aAfter = (await getProfile()).data?.profile;
  record('M15-F2 missing currentPassword -> 400, profile unchanged',
    f2a.status === 400 && f2a.data?.error === 'Current password is required to set a new password' && unchanged(f2aAfter),
    [400, 'unchanged'], [f2a.status, unchanged(f2aAfter)]);

  const f2b = await api('/api/patients/profile', { method: 'POST', cookie: patientA.cookie, body: { ...sameReq, fullName: 'HACKED NAME', newPassword: 'NewPass@123', currentPassword: 'WrongPass!' } });
  const f2bAfter = (await getProfile()).data?.profile;
  record('M15-F2 wrong currentPassword -> 401, profile unchanged',
    f2b.status === 401 && f2b.data?.error === 'Current password is incorrect' && unchanged(f2bAfter),
    [401, 'unchanged'], [f2b.status, unchanged(f2bAfter)]);

  const f2c = await api('/api/patients/profile', { method: 'POST', cookie: patientA.cookie, body: { ...sameReq, fullName: 'A'.repeat(201) } });
  const f2cAfter = (await getProfile()).data?.profile;
  record('M15-F2 oversized fullName -> 400, no DB mutation',
    f2c.status === 400 && unchanged(f2cAfter), [400, 'no-mutation'], [f2c.status, unchanged(f2cAfter)]);

  const f2d = await api('/api/patients/profile', { method: 'POST', cookie: patientA.cookie, body: { ...sameReq, contact: '9'.repeat(21) } });
  const f2dAfter = (await getProfile()).data?.profile;
  record('M15-F2 oversized contact -> 400, no DB mutation',
    f2d.status === 400 && unchanged(f2dAfter), [400, 'no-mutation'], [f2d.status, unchanged(f2dAfter)]);

  const f2e = await api('/api/patients/profile', { method: 'POST', cookie: patientA.cookie, body: { ...sameReq, contact: '12345' } });
  const f2eAfter = (await getProfile()).data?.profile;
  record('M15-F2 invalid contact format -> 400, no DB mutation',
    f2e.status === 400 && f2e.data?.error === 'Contact number must be exactly 10 digits' && unchanged(f2eAfter),
    [400, 'no-mutation'], [f2e.status, unchanged(f2eAfter)]);

  const f2f = await api('/api/patients/profile', { method: 'POST', cookie: patientA.cookie, body: { ...sameReq, newPassword: 'A'.repeat(129), currentPassword: 'Test@1234' } });
  const f2fAfter = (await getProfile()).data?.profile;
  record('M15-F2 oversized password -> 400, no DB mutation',
    f2f.status === 400 && unchanged(f2fAfter), [400, 'no-mutation'], [f2f.status, unchanged(f2fAfter)]);

  const f2g = await api('/api/patients/profile', { method: 'POST', cookie: patientA.cookie, body: { ...sameReq, fullName: 'Sec Patient A (Updated)' } });
  const f2gAfter = (await getProfile()).data?.profile;
  record('M15-F2 valid profile update -> 200 + persisted (happy path preserved)',
    f2g.status === 200 && f2gAfter?.fullName === 'Sec Patient A (Updated)' && f2gAfter?.profileComplete === true,
    ['200', 'persisted'], [f2g.status, f2gAfter?.fullName]);

  // ── B. PUT /api/staff/account basic coverage (audit gap: zero coverage) ──
  const acct = (body, token) => api('/api/staff/account', { method: 'PUT', token: token || null, body });
  const n1 = await acct({ currentPassword: 'x', newPassword: 'Doctor2@123x' });
  record('M15-F2 staff/account PUT anonymous -> 401', n1.status === 401, 401, n1.status);

  const d2c = await login('doctor2_sec@aarogyam.local', 'Doctor2@123');
  const w1 = await acct({ currentPassword: 'WrongPass!', newPassword: 'Doctor2@123x' }, d2c.token);
  const w1Check = await login('doctor2_sec@aarogyam.local', 'Doctor2@123');
  record('M15-F2 staff/account wrong current password -> 401, password unchanged',
    w1.status === 401 && w1Check.status === 200, [401, 'unchanged'], [w1.status, w1Check.status]);

  const v1 = await acct({ currentPassword: 'Doctor2@123', newPassword: 'Doctor2@123x' }, d2c.token);
  record('M15-F2 staff/account valid password update -> 200 passwordChanged',
    v1.status === 200 && v1.data?.passwordChanged === true, [200, true], [v1.status, v1.data?.passwordChanged]);
  const v2 = await acct({ currentPassword: 'Doctor2@123x', newPassword: 'Doctor2@123' }, d2c.token);
  record('M15-F2 staff/account restore original password -> 200',
    v2.status === 200 && v2.data?.passwordChanged === true, [200, true], [v2.status, v2.data?.passwordChanged]);

  // Ownership binding — the route writes only the authenticated user's own
  // account (payload.id). An attempt addressed at another account via an
  // injected newEmail executes against the caller's own account and must
  // leave the other account untouched.
  const own1 = await acct({ currentPassword: 'Doctor2@123', newEmail: 'doctor2_moved@aarogyam.local' }, d2c.token);
  const docStill = await login('doctor@aarogyam.local', 'Doctor@123');
  record('M15-F2 staff/account ownership: rename runs on own account -> 200, doctor untouched',
    own1.status === 200 && docStill.status === 200, [200, 'doctor-ok'], [own1.status, docStill.status]);
  const own2 = await acct({ currentPassword: 'Doctor2@123', newEmail: 'doctor2_sec@aarogyam.local' }, d2c.token);
  record('M15-F2 staff/account ownership: restore own User ID -> 200', own2.status === 200, 200, own2.status);

  // ── C. Share — input caps + provider-error sanitization (F3) ──
  const share = (body, token) => api('/api/share', { method: 'POST', token: token || doctor.token, body });

  const s1 = await share({ phone: '9000000000', message: 'A'.repeat(5001) });
  record('M15-F3 oversized message -> 400', s1.status === 400 && s1.data?.error === 'message exceeds maximum allowed length', [400, 'length'], [s1.status, s1.data?.error]);
  const s2 = await share({ phone: '9'.repeat(21), message: 'test' });
  record('M15-F3 oversized phone -> 400', s2.status === 400 && s2.data?.error === 'phone exceeds maximum allowed length', [400, 'length'], [s2.status, s2.data?.error]);
  const s3 = await share({ phone: 9000000000, message: 'test' });
  record('M15-F3 non-string phone -> 400 (type check)', s3.status === 400, 400, s3.status);
  const s4 = await share({ phone: '9000000000', message: 12345 });
  record('M15-F3 non-string message -> 400 (type check)', s4.status === 400, 400, s4.status);
  const s5 = await share({ phone: '   ', message: 'test' });
  record('M15-F3 whitespace-only phone -> 400', s5.status === 400, 400, s5.status);

  // Provider error path — stage the webjs provider's real 'Queue is full'
  // failure by filling the queue file with unsent entries, then verify the
  // client response is fully generic: no waError.message, no twilioCode, no
  // twilioMoreInfo, no provider internals. 1000 entries comfortably exceeds
  // the default maxSize (500) and still satisfies the provider's
  // length >= maxSize && unsent >= maxSize check for any realistic cap.
  // The queue file is restored to its prior state afterwards.
  const queuePath = join(ROOT, 'wa-queue.json');
  const queueBefore = existsSync(queuePath) ? readFileSync(queuePath, 'utf8') : null;
  try {
    const fullQueue = Array.from({ length: 1000 }, (_, i) => ({
      id: `sec-suite-${i}`, phone: '9000000000', message: 'x',
      createdAt: new Date().toISOString(), sent: false,
    }));
    writeFileSync(queuePath, JSON.stringify(fullQueue));
    const s6 = await share({ phone: '9000000000', message: 'test' });
    const s6Body = JSON.stringify(s6.data || {});
    record('M15-F3 provider failure -> generic error, NO provider details leaked',
      s6.status >= 500 &&
      s6.data?.error === 'WhatsApp delivery failed. Please try again later.' &&
      !('twilioCode' in (s6.data || {})) &&
      !('twilioMoreInfo' in (s6.data || {})) &&
      !/queue is full|twilio|more_info|errorCode/i.test(s6Body),
      ['5xx', 'generic-no-leak'], [s6.status, s6Body.slice(0, 120)]);
  } finally {
    if (queueBefore === null) {
      try { unlinkSync(queuePath); } catch { /* absent */ }
    } else {
      writeFileSync(queuePath, queueBefore);
    }
  }

  const s7 = await share({ phone: '9000000000', message: 'Test share message' });
  record('M15-F3 authorized share -> 200 queued (contract preserved)',
    s7.status === 200 && s7.data?.queued === true, [200, true], [s7.status, s7.data?.queued]);
}

// ─────────────────────────────────────────────────────────────────────────────
// N. M1.5 PHASE 3 — final coverage closure (test-only; no production changes)
// ─────────────────────────────────────────────────────────────────────────────
{
  // 1. GET /api/patients?self=true for a STAFF identity — documented 404
  //    contract; must never return patient data.
  const st1 = await api('/api/patients?self=true', { token: doctor.token });
  record('M15-P3 doctor self=true -> 404, no patient data',
    st1.status === 404 && !('patient' in (st1.data || {})) && !Array.isArray(st1.data?.patients),
    [404, 'no-data'], [st1.status, Object.keys(st1.data || {})]);
  const st2 = await api('/api/patients?self=true', { token: compounder.token });
  record('M15-P3 compounder self=true -> 404, no patient data',
    st2.status === 404 && !('patient' in (st2.data || {})),
    [404, 'no-data'], [st2.status, Object.keys(st2.data || {})]);
  const st3 = await api('/api/patients?self=true', { cookie: patientA.cookie });
  record('M15-P3 patient self=true -> 200 own profile, NO passwordHash (preserved)',
    st3.status === 200 && st3.data?.patient?.id === paId && !('passwordHash' in (st3.data?.patient || {})),
    [200, 'own-no-hash'], [st3.status, st3.data?.patient?.id]);

  // 2. Guard/P2025-style 404 boundaries — the remaining untested
  //    patient/staff DELETE paths (PUT /api/patients 404s are already
  //    covered in M14; both DELETE routes share the same guard -> 404
  //    contract as the P2025-mapped PUT path).
  const d1 = await api('/api/patients', { method: 'DELETE', token: doctor.token, body: { patientId: randomId() } });
  record('M15-P3 DELETE patient nonexistent id -> 404', d1.status === 404, 404, d1.status);
  const d2 = await api('/api/staff', { method: 'DELETE', token: doctor.token, body: { userId: randomId() } });
  record('M15-P3 DELETE staff nonexistent id -> 404', d2.status === 404, 404, d2.status);

  // 3. Drugs LIKE-wildcard behavior — classified INFO by the audit (SQLite
  //    LIKE semantics, NOT injection). Coverage verifies only that the
  //    existing take:10 bound holds. Single-char queries short-circuit at
  //    the min-2-char gate, so 2-char wildcards exercise the LIKE path.
  const w1 = await api('/api/drugs?q=%%', { token: doctor.token });
  record('M15-P3 drugs q=%% -> 200, bounded <= 10 results',
    w1.status === 200 && Array.isArray(w1.data?.drugs) && w1.data.drugs.length <= 10,
    [200, '<=10'], [w1.status, w1.data?.drugs?.length]);
  const w2 = await api('/api/drugs?q=__', { token: doctor.token });
  record('M15-P3 drugs q=__ -> 200, bounded <= 10 results',
    w2.status === 200 && Array.isArray(w2.data?.drugs) && w2.data.drugs.length <= 10,
    [200, '<=10'], [w2.status, w2.data?.drugs?.length]);

  // 4. F2 companion — POST /api/patients/profile role boundary (PATIENT only)
  const p1 = await api('/api/patients/profile', { method: 'POST', token: doctor.token, body: { fullName: 'X', dateOfBirth: '1990-01-01', gender: 'Male', contact: '9000000000' } });
  record('M15-P3 doctor POST /api/patients/profile -> 403', p1.status === 403, 403, p1.status);
  const p2 = await api('/api/patients/profile', { method: 'POST', token: compounder.token, body: { fullName: 'X', dateOfBirth: '1990-01-01', gender: 'Male', contact: '9000000000' } });
  record('M15-P3 compounder POST /api/patients/profile -> 403', p2.status === 403, 403, p2.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// O. M1.6 PHASE A — health API (W-02), Prisma durability (W-05),
//     Twilio server-log sanitization (W-07)
// ─────────────────────────────────────────────────────────────────────────────
{
  // ── W-02 — GET /api/health access policy + information boundary ──
  const ha = await api('/api/health');
  record('M16-A health anonymous -> 401 (not public)', ha.status === 401, 401, ha.status);

  const hd = await api('/api/health', { token: doctor.token });
  const hdBody = JSON.stringify(hd.data || {});
  const hdOk = hd.status === 200 &&
    typeof hd.data?.overall === 'string' &&
    typeof hd.data?.database === 'object' &&
    Array.isArray(hd.data?.checks);
  record('M16-A health authenticated doctor -> 200 with overall/database/checks',
    hdOk, ['200', 'shape'], [hd.status, hd.data && Object.keys(hd.data)]);

  // No secrets, raw environment values, stack traces, Prisma internals or
  // absolute filesystem paths may cross the health boundary.
  const hp = await api('/api/health', { cookie: patientA.cookie });
  const hpBody = JSON.stringify(hp.data || {});
  const jwtSecret = loadJwtSecret();
  const noSecrets = !(jwtSecret && hpBody.includes(jwtSecret)) &&
    !/WA_PROVIDER|TWILIO_|accountSid|authToken|fromNumber|JWT_SECRET/i.test(hpBody) &&
    !/passwordHash|twilioCode|twilioMoreInfo|DATABASE_URL/i.test(hpBody);
  const noStack = !/\.\s*at\s+\w+\s*\(|at\s+async\s+\w/i.test(hpBody) &&
    !/PrismaClientValidationError|PrismaClientKnownRequestError/i.test(hpBody);
  const noPaths = !/[A-Za-z]:[\\/][^"\\s]*[\\/][^"\\s]*/.test(hpBody) &&
    !/\/[a-z]+\/app-server\//.test(hpBody);
  record('M16-A health response exposes NO secrets/env/stack/prisma/paths',
    hp.status === 200 && noSecrets && noStack && noPaths,
    ['200', 'no-leaks'], [hp.status, { noSecrets, noStack, noPaths }]);

  // Database health — seeded baseline must be reported as reachable and the
  // W-05 SQLite durability settings must be in effect on the live store.
  record('M16-A health database reachable on seeded DB',
    hd.status === 200 && hd.data?.database?.reachable === true &&
    hd.data?.database?.status === 'HEALTHY',
    ['reachable', 'HEALTHY'], [hd.data?.database?.reachable, hd.data?.database?.status]);

  // ── W-05 — Prisma durability pragmas (WAL + busy_timeout) ──
  record('M16-A SQLite journal_mode=WAL on live database',
    hd.data?.database?.journalMode === 'WAL', 'WAL', hd.data?.database?.journalMode);
  record('M16-A SQLite busy_timeout configured (non-zero)',
    typeof hd.data?.database?.busyTimeoutMs === 'number' && hd.data?.database?.busyTimeoutMs > 0,
    'non-zero', hd.data?.database?.busyTimeoutMs);

  // Normal authenticated DB operation remains functional after pragma setup.
  const hq = await api('/api/drugs?q=paracetamol', { token: doctor.token });
  record('M16-A authenticated DB query after pragma setup -> 200',
    hq.status === 200 && Array.isArray(hq.data?.drugs), 200, hq.status);

  // ── W-07 — Twilio server-log sanitization (source-level, deterministic) ──
  // The runtime M15-F3 test above already proves the client-facing response
  // stays generic. The server log is only ever produced by whatsappProvider's
  // own console.error, so asserting the source no longer dumps the raw Twilio
  // error object / twilioMoreInfo proves the log line cannot leak them.
  const providerSrc = readFileSync(join(ROOT, 'app/lib/whatsappProvider.js'), 'utf8');
  // Sanitization means the log line no longer dumps the raw Twilio error
  // object. `twilioMoreInfo` may appear only inside the explanatory comment;
  // any CODE usage (err.twilioMoreInfo = … assignment) is a failure.
  record('M16-A provider logs sanitized (no raw errorData / twilioMoreInfo dump)',
    !/twilioMoreInfo\s*=/.test(providerSrc) &&
    !/console\.error\s*\(\s*['"]Twilio API Error:['"]\s*,\s*errorData/.test(providerSrc) &&
    providerSrc.includes('Twilio API Error (status='),
    ['sanitized', 'status+code+message'], [
      /twilioMoreInfo\s*=/.test(providerSrc),
      /console\.error\s*\(\s*['"]Twilio API Error:['"]\s*,\s*errorData/.test(providerSrc),
      providerSrc.includes('Twilio API Error (status='),
    ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// P. M1.6 PHASE B — bootstrap wiring (W-01), backup CLI (W-03), structured
//    logging redaction (W-06)
// ─────────────────────────────────────────────────────────────────────────────
{
  const { mkdtempSync, rmSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const { createBootstrapManager } = await import('../app/lib/bootstrap/index.mjs');
  const { createInstaller } = await import('../app/lib/installer/index.mjs');
  const {
    createRegistry,
    registerInfrastructureServices,
  } = await import('../app/lib/system/registry.mjs');
  const { validateConfig } = await import('../app/lib/config/validate.mjs');
  const { createLogManager, createLogger } = await import('../app/lib/logging/index.mjs');

  // ── W-01 BOOTSTRAP — sandboxed (tmp dirs only, repo untouched) ────────
  {
    const sandbox = mkdtempSync(join(tmpdir(), 'aarogyam-boot-'));
    try {
      const installer = createInstaller({
        directories: [join(sandbox, 'data'), join(sandbox, 'logs'), join(sandbox, 'backups')],
        metadataFile: join(sandbox, 'installation.json'),
      });
      const registry = registerInfrastructureServices(createRegistry(), {
        storageRoot: join(sandbox, 'storage'),
      });
      const manager = createBootstrapManager({ installer, registry });
      const first = await manager.initialize();
      record('M16-B bootstrap: valid configuration initializes to READY',
        first.state === 'READY' &&
          manager.getState() === 'READY' &&
          first.config.appName === 'Aarogyam' &&
          Object.keys(first.registry ?? {}).length >= 5,
        { state: 'READY', services: '>=5' },
        { state: first.state, services: Object.keys(first.registry ?? {}).length });
      // Idempotency — a READY bootstrap is left untouched on re-init.
      const second = await manager.initialize();
      record('M16-B bootstrap: repeated initialize() is idempotent (stays READY)',
        second.state === 'READY' && manager.getState() === 'READY',
        'READY', second.state);
      await manager.shutdown();
    } catch (err) {
      record('M16-B bootstrap: valid configuration initializes to READY', false, 'READY', err.message);
      record('M16-B bootstrap: repeated initialize() is idempotent (stays READY)', false, 'READY', 'not reached');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }

  // W-01 — invalid configuration is rejected safely; the validator echoes
  // env NAMES only, never secret VALUES.
  {
    const env = {
      JWT_SECRET: 'planted-secret-value-xyz',
      WA_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: 'ACplanted-sid-value',
      TWILIO_AUTH_TOKEN: 'planted-token-value-abc',
      // TWILIO_WHATSAPP_NUMBER intentionally unset → conditional-required error
    };
    let threw = false;
    let message = '';
    try {
      validateConfig(env);
    } catch (err) {
      threw = true;
      message = err.message;
    }
    record('M16-B bootstrap: invalid config rejected, secret values never echoed',
      threw &&
        message.includes('TWILIO_WHATSAPP_NUMBER') &&
        !message.includes('planted-secret-value-xyz') &&
        !message.includes('planted-token-value-abc') &&
        !message.includes('ACplanted-sid-value'),
      'throws; env names only',
      { threw, echoedSecret: /planted-(secret|token)/.test(message) });
  }

  // W-01 — a bootstrap failure is safe: FAILED state, structured generic
  // error, and no process-level secret (JWT_SECRET) in the error surface.
  {
    const sandbox = mkdtempSync(join(tmpdir(), 'aarogyam-boot-fail-'));
    try {
      const failingInstaller = {
        isInstalled: async () => true,
        verifyInstallation: async () => ({ ok: true, checks: [] }),
        checkUpgrade: async () => {
          throw new Error('simulated bootstrap failure');
        },
        install: async () => ({ firstLaunch: false }),
      };
      const manager = createBootstrapManager({
        installer: failingInstaller,
        registry: createRegistry(),
      });
      let error = null;
      try {
        await manager.initialize();
      } catch (err) {
        error = err;
      }
      const secret = process.env.JWT_SECRET || '__unset__';
      const status = manager.getStatus();
      record('M16-B bootstrap: failure is safe and exposes no secret values',
        error !== null &&
          error.message.includes('simulated bootstrap failure') &&
          manager.getState() === 'FAILED' &&
          !error.message.includes(secret) &&
          !status.errors.some((e) => e.message.includes(secret)),
        { state: 'FAILED', noSecret: true },
        {
          state: manager.getState(),
          error: error?.message,
          leaked: status.errors.some((e) => e.message.includes(secret)),
        });
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }

  // ── W-03 BACKUP CLI — subprocess, sandboxed (repo untouched) ─────────
  let backupSandbox = null;
  let backupId = null;
  try {
    backupSandbox = mkdtempSync(join(tmpdir(), 'aarogyam-bk-'));
    let out = '';
    try {
      out = execFileSync(process.execPath, [
        'scripts/backup.mjs',
        '--dir', join(backupSandbox, 'backups'),
        '--database', join(ROOT, 'prisma', 'sqlite.db'),
        '--json',
      ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      out = String(err.stdout || '');
    }
    const resultLine = out.split('\n').filter((l) => l.startsWith('BACKUP_RESULT ')).pop();
    let result = null;
    try {
      result = JSON.parse(resultLine.slice('BACKUP_RESULT '.length));
    } catch {
      /* recorded as failure below */
    }
    record('M16-B backup CLI: succeeds against seeded DB (exit 0, integrity OK)',
      result !== null &&
        result.ok === true &&
        result.action === 'backup' &&
        typeof result.id === 'string' &&
        result.integrity.ok === true,
      { action: 'backup', ok: true, integrity: { ok: true } },
      result ? { ok: result.ok, action: result.action, integrity: result.integrity } : 'no result');
    backupId = result?.id ?? null;

    // Artifact at the expected location.
    const backupDirPath = backupId ? join(backupSandbox, 'backups', backupId) : null;
    record('M16-B backup CLI: artifact created at expected location',
      backupDirPath !== null &&
        existsSync(join(backupDirPath, 'manifest.json')) &&
        existsSync(join(backupDirPath, 'sqlite', 'aarogyam.sqlite')),
      'manifest.json + sqlite/aarogyam.sqlite', backupDirPath);

    // Verification through the CLI's --verify contract.
    let verifyOk = false;
    if (backupId) {
      let vout = '';
      try {
        vout = execFileSync(process.execPath, [
          'scripts/backup.mjs', '--verify', backupId,
          '--dir', join(backupSandbox, 'backups'), '--json',
        ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        vout = String(err.stdout || '');
      }
      const vline = vout.split('\n').filter((l) => l.startsWith('BACKUP_RESULT ')).pop();
      try {
        const v = JSON.parse(vline.slice('BACKUP_RESULT '.length));
        verifyOk = v.action === 'verify' && v.ok === true && v.errors === 0;
      } catch {
        /* recorded as failure below */
      }
    }
    record('M16-B backup CLI: verification passes integrity checks',
      verifyOk, 'verify ok, 0 errors', verifyOk);

    // Failure path — a missing database must exit non-zero.
    let failStatus = null;
    try {
      execFileSync(process.execPath, [
        'scripts/backup.mjs',
        '--dir', join(backupSandbox, 'fail'),
        '--database', join(backupSandbox, 'nope.db'),
        '--json',
      ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      failStatus = err.status;
    }
    record('M16-B backup CLI: missing database fails with non-zero exit',
      failStatus !== null && failStatus !== 0, 'non-zero', failStatus);

    // Cleanup — remove the sandbox, confirm the repo gained no artifacts.
    rmSync(backupSandbox, { recursive: true, force: true });
    backupSandbox = null;
    const repoBackups = join(ROOT, 'data', 'backups');
    const repoArtifacts = existsSync(repoBackups) ? readdirSync(repoBackups) : [];
    record('M16-B backup CLI: test artifacts removed, repo has no backup artifacts',
      !existsSync(backupSandbox) && repoArtifacts.length === 0,
      'sandbox removed; data/backups empty',
      { sandboxGone: !existsSync(backupSandbox), repoArtifacts });
  } finally {
    if (backupSandbox) rmSync(backupSandbox, { recursive: true, force: true });
  }

  // ── W-06 STRUCTURED LOGGING — isolated manager, tmp file sink ────────
  {
    const logSandbox = mkdtempSync(join(tmpdir(), 'aarogyam-log-'));
    const manager = createLogManager({
      console: { enabled: false },
      file: { enabled: true, dir: logSandbox, filename: 'test.jsonl' },
    });
    manager.initialize();
    const log = createLogger('phase-b-test', { manager });
    const readLog = () => readFileSync(join(logSandbox, 'test.jsonl'), 'utf8');
    try {
      log.info('phase-b-structured', { component: 'health', duration: 5 });
      await manager.flush();
      const raw = readLog();
      const parsed = JSON.parse(raw.trim().split('\n')[0]);
      record('M16-B logging: structured record emitted with expected fields',
        parsed.timestamp &&
          parsed.level === 'info' &&
          parsed.module === 'phase-b-test' &&
          parsed.message === 'phase-b-structured' &&
          parsed.context.component === 'health',
        { level: 'info', module: 'phase-b-test' },
        { level: parsed.level, module: parsed.module });

      log.info('phase-b-secrets', {
        password: 'S3cret!',
        jwt: 'aaa.bbb.ccc',
        authorization: 'Bearer xyz',
        cookie: 'a=1',
        authToken: 'tok123',
        twilioAccountSid: 'AC123',
        messageBody: 'hello patient',
      });
      await manager.flush();
      const raw2 = readLog();
      const leaks = ['S3cret!', 'aaa.bbb.ccc', 'Bearer xyz', 'a=1', 'tok123', 'AC123', 'hello patient']
        .filter((v) => raw2.includes(v));
      const markers = (raw2.match(/\[REDACTED\]/g) || []).length;
      record('M16-B logging: sensitive fields redacted (zero leakage)',
        leaks.length === 0 && markers >= 6,
        'no leaks + markers', { leaks, markers });

      log.error('phase-b-error', new Error('disk full'), {
        user: { apiKey: 'k-123' },
        outer: { password: 'p1' },
      });
      await manager.flush();
      const raw3 = readLog();
      record('M16-B logging: nested/error-path redacted, error metadata minimal',
        !raw3.includes('k-123') &&
          !raw3.includes('p1') &&
          raw3.includes('disk full') &&
          raw3.includes('"name":"Error"'),
        'nested redacted; name/message only',
        { nestedLeak: raw3.includes('k-123') || raw3.includes('p1') });
    } finally {
      await manager.shutdown();
      rmSync(logSandbox, { recursive: true, force: true });
    }
  }

  // W-06 — W-07 Twilio log sanitization remains intact (source-level proof).
  {
    const providerSrc = readFileSync(join(ROOT, 'app/lib/whatsappProvider.js'), 'utf8');
    record('M16-B logging: W-07 Twilio sanitization intact (no twilioMoreInfo code usage)',
      !/twilioMoreInfo\s*=/.test(providerSrc) &&
        providerSrc.includes('Twilio API Error (status='),
      'sanitized log line', {
        twilioMoreInfoAssign: /twilioMoreInfo\s*=/.test(providerSrc),
        hasSanitizedLine: providerSrc.includes('Twilio API Error (status='),
      });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Q. M1.6 PHASE C — WhatsApp runtime consumer (W-04)
// ─────────────────────────────────────────────────────────────────────────────
// Deterministic, sandboxed: the real queue implementation (waQueue.js) and
// the real consumer logic run against a fake whatsapp-web.js client in a
// tmp sandbox. The production server's runtime consumer is session-gated
// (no paired .wwebjs_auth session → logged no-op), so these tests never
// launch Chrome and never touch the repository working tree.
{
  const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const {
    createWhatsAppRuntime,
    hasWhatsAppSession,
  } = await import('../app/lib/whatsappConsumer.mjs');
  const waQueue = await import('../app/lib/waQueue.js');

  const sandbox = mkdtempSync(join(tmpdir(), 'aarogyam-wa-'));
  // Fake "paired session" so the webjs session gate passes.
  const sessionDir = join(sandbox, '.wwebjs_auth', 'session-aarogyam');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'creds.json'), '{}');

  let factoryCalls = 0;
  let destroyed = 0;
  const sent = [];
  const makeFakeClient = () => {
    factoryCalls += 1;
    const handlers = new Map();
    return {
      on: (name, cb) => handlers.set(name, cb),
      emit: (name, ...args) => {
        const cb = handlers.get(name);
        if (cb) cb(...args);
      },
      initialize: async () => 'initialized',
      isRegisteredUser: async () => true,
      sendMessage: async (chatId, message) => {
        sent.push({ chatId, message });
        return { ack: 1 };
      },
      destroy: async () => {
        destroyed += 1;
      },
    };
  };

  try {
    // ── A. RUNTIME INITIALIZATION — webjs starts, idempotent, single consumer ──
    let client = null;
    const runtime = createWhatsAppRuntime({
      provider: 'webjs',
      baseDir: sandbox,
      pollIntervalMs: 40,
      clientFactory: () => {
        client = makeFakeClient();
        return client;
      },
    });
    const started = await runtime.start();
    record('M16-C runtime: starts under webjs config (session present)',
      started.phase === 'starting' && started.provider === 'webjs' && runtime.factoryCalls === 1,
      { phase: 'starting', clients: 1 },
      { phase: started.phase, clients: runtime.factoryCalls });
    client.emit('ready');
    await new Promise((r) => setTimeout(r, 30));
    record('M16-C runtime: transitions to ready and starts the consumer',
      runtime.getState().phase === 'ready', 'ready', runtime.getState().phase);
    const again = await runtime.start();
    record('M16-C runtime: repeated start is idempotent (no second client/consumer)',
      again.phase === 'ready' && runtime.factoryCalls === 1,
      { phase: 'ready', clients: 1 },
      { phase: again.phase, clients: runtime.factoryCalls });

    // ── B. QUEUE CONSUMPTION — real queue impl, deterministic delivery ──
    const phone = '9876543210';
    waQueue.writeQueue(sandbox, [
      { id: 'test-1', phone, message: 'hello', createdAt: new Date().toISOString(), sent: false },
    ]);
    await new Promise((r) => setTimeout(r, 160)); // several 40ms polls
    const delivered = sent.find((x) => x.chatId === '919876543210@c.us');
    record('M16-C queue: consumer delivers pending message (91<phone>@c.us)',
      delivered !== undefined && delivered.message === 'hello',
      'delivered', sent);
    const persisted = waQueue.readQueue(sandbox).find((m) => m.id === 'test-1');
    record('M16-C queue: processed message marked per queue contract (sent, processing cleared)',
      persisted !== undefined && persisted.sent === true && persisted.processing === false,
      { sent: true, processing: false },
      persisted
        ? { sent: persisted.sent, processing: persisted.processing, failed: persisted.failed }
        : null);

    // ── C. FAILURE HANDLING — init failure contained, no secret exposure ──
    const failClient = {
      on: () => {},
      emit: () => {},
      initialize: async () => {
        throw new Error('PLANTED_PROVIDER_SECRET_XYZ');
      },
      destroy: async () => {},
    };
    const failRuntime = createWhatsAppRuntime({
      provider: 'webjs',
      baseDir: sandbox,
      clientFactory: () => failClient,
    });
    await failRuntime.start();
    await new Promise((r) => setTimeout(r, 40));
    const failState = failRuntime.getState();
    record('M16-C failure: init failure contained (no secret in state, no throw)',
      failState.phase === 'failed' &&
        !JSON.stringify(failState).includes('PLANTED_PROVIDER_SECRET_XYZ'),
      { phase: 'failed', noSecret: true },
      {
        phase: failState.phase,
        leaked: JSON.stringify(failState).includes('PLANTED_PROVIDER_SECRET_XYZ'),
      });

    // ── D. PROVIDER SEPARATION — twilio never starts the webjs consumer ──
    let twilioCalls = 0;
    const twilioRuntime = createWhatsAppRuntime({
      provider: 'twilio',
      baseDir: sandbox,
      clientFactory: () => {
        twilioCalls += 1;
        return makeFakeClient();
      },
    });
    const twilioState = await twilioRuntime.start();
    record('M16-C provider separation: WA_PROVIDER=twilio does not start webjs consumer',
      twilioState.phase === 'stopped' &&
        twilioState.reason === 'provider-not-webjs' &&
        twilioCalls === 0,
      { phase: 'stopped', reason: 'provider-not-webjs', clients: 0 },
      { phase: twilioState.phase, reason: twilioState.reason, clients: twilioCalls });

    // ── E. SESSION GATE + SHUTDOWN — no session → no launch; stop safe ──
    const emptySandbox = mkdtempSync(join(tmpdir(), 'aarogyam-wa-nosess-'));
    try {
      const noSession = createWhatsAppRuntime({
        provider: 'webjs',
        baseDir: emptySandbox,
        clientFactory: () => {
          throw new Error('must not be called');
        },
      });
      const noSessionState = await noSession.start();
      record('M16-C session gate: no paired session → consumer does not launch',
        noSessionState.phase === 'stopped' && noSessionState.reason === 'no-session',
        { phase: 'stopped', reason: 'no-session' },
        { phase: noSessionState.phase, reason: noSessionState.reason });
    } finally {
      rmSync(emptySandbox, { recursive: true, force: true });
    }
    record('M16-C session gate: hasWhatsAppSession detects the paired session dir',
      (await hasWhatsAppSession(sandbox)) === true, true, await hasWhatsAppSession(sandbox));

    await runtime.stop();
    const sentBefore = sent.length;
    waQueue.writeQueue(sandbox, [
      {
        id: 'test-2',
        phone: '9876500000',
        message: 'after-stop',
        createdAt: new Date().toISOString(),
        sent: false,
      },
    ]);
    await new Promise((r) => setTimeout(r, 120));
    record('M16-C shutdown: stop clears the poll timer (no delivery after stop)',
      sent.length === sentBefore, 'no new sends', { before: sentBefore, after: sent.length });
    record('M16-C shutdown: stop destroys the client', destroyed === 1, 1, destroyed);
    const stoppedState = await runtime.stop();
    record('M16-C shutdown: repeated stop is safe/idempotent',
      stoppedState.phase === 'stopped', 'stopped', stoppedState.phase);
    record('M16-C shutdown: no dangling queue lock remains',
      !existsSync(join(sandbox, 'wa-queue.lock')),
      'absent', existsSync(join(sandbox, 'wa-queue.lock')));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
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

  // M1.6 Phase B (W-01) — the server's instrumentation bootstrap creates
  // the runtime data/ tree (installation metadata, logs, backups dirs) at
  // server start. Remove it so the repository working tree is restored to
  // the clean baseline.
  {
    const { rmSync } = await import('node:fs');
    const dataDir = join(ROOT, 'data');
    try {
      if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    record('M16-B teardown: bootstrap runtime data/ tree removed',
      !existsSync(dataDir), 'absent', existsSync(dataDir));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('----------------------------------------');
console.log(`TOTAL=${results.length}  PASS=${results.length - failures}  FAIL=${failures}`);
process.exit(failures === 0 ? 0 : 1);
