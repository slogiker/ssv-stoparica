'use strict';
// API test suite - run with: node tools/test-api.js [BASE_URL]
// Supports http://localhost:8742 or http://localhost:8742/api

const rawArg = (process.argv[2] || 'http://localhost:8742').replace(/\/$/, '');
const API = rawArg.endsWith('/api') ? rawArg : rawArg + '/api';
const BASE = rawArg.endsWith('/api') ? rawArg.slice(0, -4) : rawArg;

const TEST_EMAIL = `ci_${Date.now()}@test.local`;
const TEST_PASS = 'testpass99';
const TEST_PASS_NEW = 'testpass99_new';
const TEST_NAME = 'CI-User';

const USER_B_EMAIL = `ci_b_${Date.now()}@test.local`;
const USER_B_PASS = 'testpass99b';
const USER_B_NAME = 'CI-User-B';

let passed = 0;
let failed = 0;
let token = null;
let tokenB = null;
let runId = null;
let deviceId = null;

async function req(method, path, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = 'Bearer ' + auth;
  const targetUrl = path.startsWith('http') ? path : API + path;
  const r = await fetch(targetUrl, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let data;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  return { status: r.status, data, headers: r.headers };
}

function ok(name, cond, detail) {
  if (cond) {
    console.log('  \u2713', name);
    passed++;
  } else {
    console.log('  \u2717', name, detail !== undefined ? '-> ' + detail : '');
    failed++;
  }
}

async function testHealth() {
  console.log('[ Health Check ]');
  const r = await req('GET', '/health');
  ok('GET /api/health -> 200', r.status === 200, r.status);
  ok('GET /api/health -> { ok: true }', r.data?.ok === true, JSON.stringify(r.data));
}

async function testAuthRegister() {
  console.log('\n[ Auth - Register & Input Validation ]');
  const r = await req('POST', '/auth/register', { ime: TEST_NAME, email: TEST_EMAIL, geslo: TEST_PASS });
  ok('POST /auth/register -> 201', r.status === 201, r.status);
  ok('register returns token', typeof r.data?.token === 'string', JSON.stringify(r.data));
  token = r.data?.token;

  const dup = await req('POST', '/auth/register', { ime: TEST_NAME, email: TEST_EMAIL, geslo: TEST_PASS });
  ok('duplicate email -> 409', dup.status === 409, dup.status);

  const dupCase = await req('POST', '/auth/register', { ime: TEST_NAME, email: TEST_EMAIL.toUpperCase(), geslo: TEST_PASS });
  ok('duplicate email case-insensitive -> 409', dupCase.status === 409, dupCase.status);

  const short = await req('POST', '/auth/register', { ime: 'X', email: `x${Date.now()}@t.local`, geslo: 'short' });
  ok('short password (<8) -> 400', short.status === 400, short.status);

  const badEmail = await req('POST', '/auth/register', { ime: 'X', email: 'invalid-email', geslo: TEST_PASS });
  ok('invalid email format -> 400', badEmail.status === 400, badEmail.status);

  const noFields = await req('POST', '/auth/register', {});
  ok('missing fields -> 400', noFields.status === 400, noFields.status);

  // Register second user for cross-user isolation testing
  const rb = await req('POST', '/auth/register', { ime: USER_B_NAME, email: USER_B_EMAIL, geslo: USER_B_PASS });
  tokenB = rb.data?.token;
  ok('register secondary user -> 201', rb.status === 201, rb.status);
}

async function testAuthLogin() {
  console.log('\n[ Auth - Login & Password Flow ]');
  const r = await req('POST', '/auth/login', { login: TEST_EMAIL, geslo: TEST_PASS });
  ok('POST /auth/login by email -> 200', r.status === 200, r.status);
  ok('login returns token', typeof r.data?.token === 'string', JSON.stringify(r.data));
  token = r.data?.token;

  const byName = await req('POST', '/auth/login', { login: TEST_NAME, geslo: TEST_PASS });
  ok('login by ime -> 200', byName.status === 200, byName.status);

  const badPass = await req('POST', '/auth/login', { login: TEST_EMAIL, geslo: 'wrongpass' });
  ok('wrong password -> 401', badPass.status === 401, badPass.status);

  const unknown = await req('POST', '/auth/login', { login: 'nobody@nowhere.xx', geslo: 'pass12345' });
  ok('unknown user -> 401', unknown.status === 401, unknown.status);
}

async function testProtectedRoutesWithoutAuth() {
  console.log('\n[ Auth - Route Protection Verification ]');
  const routes = [
    ['GET', '/runs'],
    ['POST', '/runs', { ekipa: 'X', disciplina: 'zimska', cas_s: 20 }],
    ['GET', '/devices'],
    ['POST', '/devices', { svc_uuid: '180d', char_uuid: '2a37' }],
    ['PUT', '/auth/profile', { ime: 'Hacker' }],
    ['PUT', '/auth/password', { trenutno: 'a', novo: 'b' }],
    ['POST', '/auth/refresh'],
    ['DELETE', '/auth/account'],
    ['GET', '/admin/users'],
  ];

  for (const [m, p, b] of routes) {
    const res = await req(m, p, b);
    ok(`${m} ${p} without token -> 401`, res.status === 401, res.status);
  }

  // Malformed bearer token
  const badToken = await req('GET', '/runs', null, 'malformed.token.here');
  ok('GET /runs with forged token -> 401', badToken.status === 401, badToken.status);
}

async function testProfileAndPassword() {
  console.log('\n[ Profile & Password Updates ]');
  // Profile update
  const rProfile = await req('PUT', '/auth/profile', { ime: 'CI-Updated' }, token);
  ok('PUT /auth/profile -> 200', rProfile.status === 200, rProfile.status);
  ok('profile returns new token', typeof rProfile.data?.token === 'string', JSON.stringify(rProfile.data));
  if (rProfile.data?.token) token = rProfile.data.token;

  const emptyIme = await req('PUT', '/auth/profile', { ime: '   ' }, token);
  ok('empty ime -> 400', emptyIme.status === 400, emptyIme.status);

  // Password update
  const badOld = await req('PUT', '/auth/password', { trenutno: 'wrong', novo: TEST_PASS_NEW }, token);
  ok('wrong current password -> 401', badOld.status === 401, badOld.status);

  const shortNew = await req('PUT', '/auth/password', { trenutno: TEST_PASS, novo: 'short' }, token);
  ok('short new password -> 400', shortNew.status === 400, shortNew.status);

  const okPass = await req('PUT', '/auth/password', { trenutno: TEST_PASS, novo: TEST_PASS_NEW }, token);
  ok('change password -> 200', okPass.status === 200, okPass.status);

  // Verify login with new password
  const loginNew = await req('POST', '/auth/login', { login: TEST_EMAIL, geslo: TEST_PASS_NEW });
  ok('login with new password -> 200', loginNew.status === 200, loginNew.status);
  if (loginNew.data?.token) token = loginNew.data.token;

  // Change back to original password
  await req('PUT', '/auth/password', { trenutno: TEST_PASS_NEW, novo: TEST_PASS }, token);

  // Refresh token
  const ref = await req('POST', '/auth/refresh', null, token);
  ok('POST /auth/refresh -> 200', ref.status === 200, ref.status);
  ok('refresh returns new token', typeof ref.data?.token === 'string', JSON.stringify(ref.data));
  if (ref.data?.token) token = ref.data.token;
}

async function testRuns() {
  console.log('\n[ Runs - CRUD, Filtering & Security ]');
  const rZimska = await req('POST', '/runs', { ekipa: 'Člani-A', disciplina: 'zimska', cas_s: 28.5 }, token);
  ok('POST /runs zimska -> 201', rZimska.status === 201, rZimska.status);
  ok('POST /runs returns valid id', typeof rZimska.data?.id === 'number', JSON.stringify(rZimska.data));
  runId = rZimska.data?.id;

  const rLetna = await req('POST', '/runs', { ekipa: 'Člani-B', disciplina: 'letna', cas_s: 47.2 }, token);
  ok('POST /runs letna -> 201', rLetna.status === 201, rLetna.status);

  // Boundary & security checks
  const neg = await req('POST', '/runs', { ekipa: 'X', disciplina: 'zimska', cas_s: -5 }, token);
  ok('negative cas_s -> 400', neg.status === 400, neg.status);

  const zero = await req('POST', '/runs', { ekipa: 'X', disciplina: 'zimska', cas_s: 0 }, token);
  ok('zero cas_s -> 400', zero.status === 400, zero.status);

  const inf = await req('POST', '/runs', { ekipa: 'X', disciplina: 'zimska', cas_s: Infinity }, token);
  ok('Infinity cas_s -> 400', inf.status === 400, inf.status);

  const huge = await req('POST', '/runs', { ekipa: 'X', disciplina: 'zimska', cas_s: 999999 }, token);
  ok('excessive cas_s (>86400) -> 400', huge.status === 400, huge.status);

  const badDisc = await req('POST', '/runs', { ekipa: 'X', disciplina: 'invalid', cas_s: 20 }, token);
  ok('invalid disciplina -> 400', badDisc.status === 400, badDisc.status);

  // List & filter
  const rList = await req('GET', '/runs', null, token);
  ok('GET /runs -> 200', rList.status === 200, rList.status);
  ok('GET /runs returns array', Array.isArray(rList.data), typeof rList.data);
  ok('GET /runs has records', rList.data?.length >= 2, rList.data?.length);

  const fz = await req('GET', '/runs?disciplina=zimska', null, token);
  ok('filter disciplina=zimska -> all zimska', fz.data?.every(x => x.disciplina === 'zimska'), 'mixed');

  const fl = await req('GET', '/runs?disciplina=letna', null, token);
  ok('filter disciplina=letna -> all letna', fl.data?.every(x => x.disciplina === 'letna'), 'mixed');

  // SQL LIKE injection safety check: search with wildcard characters
  const fWild = await req('GET', '/runs?ekipa=Člani%25', null, token);
  ok('search with literal percent does not SQL error -> 200', fWild.status === 200, fWild.status);

  // PR
  const rPr = await req('GET', '/runs/pr', null, token);
  ok('GET /runs/pr -> 200', rPr.status === 200, rPr.status);
  ok('PR cas_s <= 28.5', rPr.data?.cas_s <= 28.5, rPr.data?.cas_s);

  // CSV export
  const headers = { 'Authorization': 'Bearer ' + token };
  const rExport = await fetch(API + '/runs/export', { headers });
  ok('GET /runs/export -> 200', rExport.status === 200, rExport.status);
  ok('export content-type CSV', rExport.headers.get('content-type')?.includes('text/csv'), rExport.headers.get('content-type'));
  const csvText = await rExport.text();
  ok('export has CSV header', csvText.startsWith('id,'), csvText.slice(0, 30));

  // Cross-user IDOR check: User B cannot delete User A's run
  if (runId && tokenB) {
    const idorDel = await req('DELETE', '/runs/' + runId, null, tokenB);
    ok('IDOR: user B deleting user A run -> 404', idorDel.status === 404, idorDel.status);
  }

  // Deletion by owner
  if (runId) {
    const rDel = await req('DELETE', '/runs/' + runId, null, token);
    ok('DELETE /runs/:id by owner -> 204', rDel.status === 204, rDel.status);
    const rDelAgain = await req('DELETE', '/runs/' + runId, null, token);
    ok('DELETE same id -> 404', rDelAgain.status === 404, rDelAgain.status);
  }
}

async function testDevices() {
  console.log('\n[ Devices - CRUD, Validation & IDOR Protection ]');
  const d1 = await req('POST', '/devices', { svc_uuid: '180d', char_uuid: '2a37', friendly_name: 'HeartRate' }, token);
  ok('POST /devices (16-bit UUID) -> 201', d1.status === 201, d1.status);
  ok('device returns id', typeof d1.data?.id === 'number', JSON.stringify(d1.data));
  deviceId = d1.data?.id;

  const dDup = await req('POST', '/devices', { svc_uuid: '180d', char_uuid: '2a37' }, token);
  ok('duplicate device for user -> 409', dDup.status === 409, dDup.status);

  const dBadUuid = await req('POST', '/devices', { svc_uuid: 'not-a-uuid', char_uuid: 'xyz' }, token);
  ok('invalid UUID format -> 400', dBadUuid.status === 400, dBadUuid.status);

  const dList = await req('GET', '/devices', null, token);
  ok('GET /devices -> 200', dList.status === 200, dList.status);
  ok('GET /devices returns array with device', dList.data?.some(d => d.id === deviceId), JSON.stringify(dList.data));

  // Cross-user IDOR check: User B cannot delete User A's device
  if (deviceId && tokenB) {
    const idorDev = await req('DELETE', '/devices/' + deviceId, null, tokenB);
    ok('IDOR: user B deleting user A device -> 404', idorDev.status === 404, idorDev.status);
  }

  // Owner deletes device
  if (deviceId) {
    const dDel = await req('DELETE', '/devices/' + deviceId, null, token);
    ok('DELETE /devices/:id by owner -> 204', dDel.status === 204, dDel.status);
  }
}

async function testAdmin() {
  console.log('\n[ Admin - Access Control & Role Operations ]');
  // 1. Non-admin user attempts access -> must be 403
  const forbiddenUsers = await req('GET', '/admin/users', null, token);
  ok('non-admin GET /admin/users -> 403', forbiddenUsers.status === 403, forbiddenUsers.status);

  const forbiddenRole = await req('POST', '/admin/users/1/role', { role: 'admin' }, token);
  ok('non-admin POST /admin/users/:id/role -> 403', forbiddenRole.status === 403, forbiddenRole.status);

  const forbiddenDel = await req('DELETE', '/admin/users/1', null, token);
  ok('non-admin DELETE /admin/users/:id -> 403', forbiddenDel.status === 403, forbiddenDel.status);

  // 2. Login as seeded Admin
  const adminLogin = await req('POST', '/auth/login', { login: 'admin@ssv.test', geslo: 'admin-password' });
  if (adminLogin.status !== 200 || !adminLogin.data?.token) {
    console.log('  ! Admin login with admin@ssv.test failed (' + adminLogin.status + '), skipping admin operations');
    return;
  }
  const adminToken = adminLogin.data.token;
  ok('admin login -> 200', adminLogin.status === 200, adminLogin.status);

  // 3. Admin list users
  const adminUsers = await req('GET', '/admin/users', null, adminToken);
  ok('admin GET /admin/users -> 200', adminUsers.status === 200, adminUsers.status);
  ok('admin users list is array', Array.isArray(adminUsers.data), typeof adminUsers.data);

  // 4. Admin self-protection
  const myAdminUser = adminUsers.data?.find(u => u.email === 'admin@ssv.test');
  if (myAdminUser) {
    const selfDemote = await req('POST', `/admin/users/${myAdminUser.id}/role`, { role: 'user' }, adminToken);
    ok('admin self-demotion prevented -> 400', selfDemote.status === 400, selfDemote.status);

    const selfDelete = await req('DELETE', `/admin/users/${myAdminUser.id}`, null, adminToken);
    ok('admin self-deletion prevented -> 400', selfDelete.status === 400, selfDelete.status);
  }

  // 5. Admin inspects user runs
  if (myAdminUser) {
    const userRuns = await req('GET', `/admin/users/${myAdminUser.id}/runs`, null, adminToken);
    ok('admin GET /admin/users/:id/runs -> 200', userRuns.status === 200, userRuns.status);
  }
}

async function cleanup() {
  console.log('\n[ Account Cleanup & Cascade Deletion ]');
  if (token) {
    const r = await req('DELETE', '/auth/account', null, token);
    ok('DELETE /auth/account -> 200', r.status === 200, r.status);
    const after = await req('GET', '/runs', null, token);
    ok('token invalidated after account deletion -> 401', after.status === 401, after.status);
  }
  if (tokenB) {
    const rb = await req('DELETE', '/auth/account', null, tokenB);
    ok('DELETE /auth/account (user B) -> 200', rb.status === 200, rb.status);
  }
}

async function testDemoUser() {
  console.log('\n[ Demo User Verification: test / test1234 ]');
  const r = await req('POST', '/auth/login', { login: 'test', geslo: 'test1234' });
  ok('demo login test/test1234 -> 200', r.status === 200, r.status);
  if (r.data?.token) {
    const runs = await req('GET', '/runs', null, r.data.token);
    ok('demo user has >= 40 runs', runs.data?.length >= 40, runs.data?.length);
    const z = runs.data?.filter(x => x.disciplina === 'zimska').length;
    const l = runs.data?.filter(x => x.disciplina === 'letna').length;
    ok('demo zimska runs present', z > 0, z);
    ok('demo letna runs present', l > 0, l);
  }
}

async function main() {
  console.log('SSV Stoparica - Security & API Test Suite');
  console.log('Target API:', API);
  console.log('Time:', new Date().toISOString());
  console.log('');

  try {
    await testHealth();
    await testAuthRegister();
    await testAuthLogin();
    await testProtectedRoutesWithoutAuth();
    await testProfileAndPassword();
    await testRuns();
    await testDevices();
    await testAdmin();
  } finally {
    await cleanup().catch(e => console.error('Cleanup error:', e.message));
  }

  await testDemoUser();

  const total = passed + failed;
  console.log('\n' + '-'.repeat(45));
  console.log(`${passed}/${total} tests passed${failed ? ' - ' + failed + ' FAILED' : ' OK'}`);
  if (failed) process.exit(1);
}

main().catch(e => {
  console.error('Test runner fatal error:', e.message);
  process.exit(1);
});
