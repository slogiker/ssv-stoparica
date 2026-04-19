'use strict';
// API test suite — run with: node tools/test-api.js [BASE_URL]
// Default: http://localhost:8742

const BASE = (process.argv[2] || 'http://localhost:8742').replace(/\/$/, '');
const API  = BASE + '/api';
const TEST_EMAIL = `ci_${Date.now()}@test.local`;
const TEST_PASS  = 'testpass99';
const TEST_NAME  = 'CI-User';

let passed = 0, failed = 0, token = null, runId = null;

async function req(method, path, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = 'Bearer ' + auth;
  const r = await fetch(path.startsWith('http') ? path : API + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  let data;
  try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}

function ok(name, cond, detail) {
  if (cond) { console.log('  \u2713', name); passed++; }
  else       { console.log('  \u2717', name, detail ? '\u2192 ' + detail : ''); failed++; }
}

async function run() {
  console.log('SSV Stoparica \u2014 API tests');
  console.log('Target:', BASE);
  console.log('');

  // Health
  console.log('[ Health ]');
  {
    const r = await req('GET', BASE + '/health');
    ok('GET /health -> 200', r.status === 200, r.status);
    ok('GET /health -> { ok: true }', r.data?.ok === true, JSON.stringify(r.data));
  }

  // Auth: register
  console.log('\n[ Auth - register ]');
  {
    const r = await req('POST', '/auth/register', { ime: TEST_NAME, email: TEST_EMAIL, geslo: TEST_PASS });
    ok('POST /auth/register -> 201', r.status === 201, r.status);
    ok('register returns token', typeof r.data?.token === 'string', JSON.stringify(r.data));
    token = r.data?.token;

    const dup = await req('POST', '/auth/register', { ime: TEST_NAME, email: TEST_EMAIL, geslo: TEST_PASS });
    ok('duplicate email -> 409', dup.status === 409, dup.status);

    const short = await req('POST', '/auth/register', { ime: 'X', email: `x${Date.now()}@t.local`, geslo: 'short' });
    ok('short password -> 400', short.status === 400, short.status);

    const noFields = await req('POST', '/auth/register', {});
    ok('missing fields -> 400', noFields.status === 400, noFields.status);
  }

  // Auth: login
  console.log('\n[ Auth - login ]');
  {
    const r = await req('POST', '/auth/login', { login: TEST_EMAIL, geslo: TEST_PASS });
    ok('POST /auth/login -> 200', r.status === 200, r.status);
    ok('login returns token', typeof r.data?.token === 'string', JSON.stringify(r.data));
    token = r.data?.token;

    const byName = await req('POST', '/auth/login', { login: TEST_NAME, geslo: TEST_PASS });
    ok('login by ime -> 200', byName.status === 200, byName.status);

    const bad = await req('POST', '/auth/login', { login: TEST_EMAIL, geslo: 'wrongpass' });
    ok('wrong password -> 401', bad.status === 401, bad.status);

    const unknown = await req('POST', '/auth/login', { login: 'nobody@nowhere.xx', geslo: 'pass' });
    ok('unknown user -> 401', unknown.status === 401, unknown.status);
  }

  // Protected without token
  console.log('\n[ Auth - protected routes ]');
  {
    const r1 = await req('GET', '/runs');
    ok('GET /runs without token -> 401', r1.status === 401, r1.status);
    const r2 = await req('POST', '/runs', { ekipa: 'X', disciplina: 'zimska', cas_s: 20 });
    ok('POST /runs without token -> 401', r2.status === 401, r2.status);
  }

  // Runs: create
  console.log('\n[ Runs - create ]');
  {
    const r = await req('POST', '/runs', { ekipa: 'Clani-A', disciplina: 'zimska', cas_s: 28.5 }, token);
    ok('POST /runs zimska -> 201', r.status === 201, r.status);
    ok('POST /runs returns id', typeof r.data?.id === 'number', JSON.stringify(r.data));
    runId = r.data?.id;

    const r2 = await req('POST', '/runs', { ekipa: 'Clani-B', disciplina: 'letna', cas_s: 47.2 }, token);
    ok('POST /runs letna -> 201', r2.status === 201, r2.status);

    const neg = await req('POST', '/runs', { ekipa: 'X', disciplina: 'zimska', cas_s: -5 }, token);
    ok('negative cas_s -> 400', neg.status === 400, neg.status);

    const zero = await req('POST', '/runs', { ekipa: 'X', disciplina: 'zimska', cas_s: 0 }, token);
    ok('zero cas_s -> 400', zero.status === 400, zero.status);

    const badDisc = await req('POST', '/runs', { ekipa: 'X', disciplina: 'invalid', cas_s: 20 }, token);
    ok('invalid disciplina -> 400/500', [400, 500].includes(badDisc.status), badDisc.status);
  }

  // Runs: list & filter
  console.log('\n[ Runs - list & filter ]');
  {
    const r = await req('GET', '/runs', null, token);
    ok('GET /runs -> 200', r.status === 200, r.status);
    ok('GET /runs returns array', Array.isArray(r.data), typeof r.data);
    ok('GET /runs has entries', r.data?.length > 0, r.data?.length);

    const fz = await req('GET', '/runs?disciplina=zimska', null, token);
    ok('filter disciplina=zimska -> all zimska', fz.data?.every(x => x.disciplina === 'zimska'), 'mixed');

    const fl = await req('GET', '/runs?disciplina=letna', null, token);
    ok('filter disciplina=letna -> all letna', fl.data?.every(x => x.disciplina === 'letna'), 'mixed');

    const fd = await req('GET', '/runs?filter=dan', null, token);
    ok('filter=dan -> 200', fd.status === 200, fd.status);

    const fw = await req('GET', '/runs?filter=teden', null, token);
    ok('filter=teden -> 200', fw.status === 200, fw.status);
  }

  // Runs: PR
  console.log('\n[ Runs - PR ]');
  {
    const r = await req('GET', '/runs/pr', null, token);
    ok('GET /runs/pr -> 200', r.status === 200, r.status);
    ok('PR is a run object', typeof r.data?.id === 'number', JSON.stringify(r.data));
    ok('PR cas_s <= any inserted run', r.data?.cas_s <= 28.5, r.data?.cas_s);
  }

  // Runs: export
  console.log('\n[ Runs - CSV export ]');
  {
    const headers = { 'Authorization': 'Bearer ' + token };
    const r = await fetch(API + '/runs/export', { headers });
    ok('GET /runs/export -> 200', r.status === 200, r.status);
    ok('export content-type CSV', r.headers.get('content-type')?.includes('text/csv'), r.headers.get('content-type'));
    const text = await r.text();
    ok('export has CSV header', text.startsWith('id,'), text.slice(0, 30));
    ok('export has data rows', text.split('\n').length > 2, text.split('\n').length);
  }

  // Runs: delete
  console.log('\n[ Runs - delete ]');
  {
    if (runId) {
      const r = await req('DELETE', '/runs/' + runId, null, token);
      ok('DELETE /runs/:id -> 204', r.status === 204, r.status);
      const again = await req('DELETE', '/runs/' + runId, null, token);
      ok('DELETE same id -> 404', again.status === 404, again.status);
    }
    const notExist = await req('DELETE', '/runs/999999', null, token);
    ok('DELETE nonexistent -> 404', notExist.status === 404, notExist.status);
  }

  // Profile update
  console.log('\n[ Auth - profile ]');
  {
    const r = await req('PUT', '/auth/profile', { ime: 'CI-Updated' }, token);
    ok('PUT /auth/profile -> 200', r.status === 200, r.status);
    ok('profile returns new token', typeof r.data?.token === 'string', JSON.stringify(r.data));
    if (r.data?.token) token = r.data.token;

    const empty = await req('PUT', '/auth/profile', { ime: '  ' }, token);
    ok('empty ime -> 400', empty.status === 400, empty.status);
  }
}

async function cleanup() {
  // Always delete the test account, even if tests crash mid-run.
  // Without this, every failed run leaks a user + run rows in the DB
  // (the timestamped email means duplicates accumulate across runs).
  if (!token) return;
  console.log('\n[ Cleanup ]');
  const r = await req('DELETE', '/auth/account', null, token);
  ok('DELETE /auth/account -> 200', r.status === 200, r.status);
  const afterDelete = await req('GET', '/runs', null, token);
  ok('token invalid after delete -> 401', afterDelete.status === 401, afterDelete.status);
}

async function runDemoUser() {
  // Demo user
  console.log('\n[ Demo user: test / test1234 ]');
  {
    const r = await req('POST', '/auth/login', { login: 'test', geslo: 'test1234' });
    ok('demo login test/test1234 -> 200', r.status === 200, r.status);
    if (r.data?.token) {
      const runs = await req('GET', '/runs', null, r.data.token);
      ok('demo user has >= 40 runs', runs.data?.length >= 40, runs.data?.length);
      const z = runs.data?.filter(x => x.disciplina === 'zimska').length;
      const l = runs.data?.filter(x => x.disciplina === 'letna').length;
      ok('demo zimska runs 20-25', z >= 20 && z <= 25, z);
      ok('demo letna runs 20-25', l >= 20 && l <= 25, l);
      const allInRange = runs.data?.every(x =>
        x.disciplina === 'zimska' ? (x.cas_s >= 15 && x.cas_s <= 45) : (x.cas_s >= 35 && x.cas_s <= 70)
      );
      ok('all run times in correct range', allInRange, 'some out of range');
    }
  }
}

async function main() {
  try {
    await run();
  } finally {
    // Cleanup runs unconditionally so no test user is ever left behind
    await cleanup().catch(e => console.error('Cleanup failed:', e.message));
  }
  // Demo user tests run after cleanup so they don't depend on token state
  await runDemoUser();

  // Summary
  const total = passed + failed;
  console.log('\n' + '-'.repeat(40));
  console.log(`${passed}/${total} tests passed${failed ? ' -- ' + failed + ' FAILED' : ' OK'}`);
  if (failed) process.exit(1);
}

main().catch(e => { console.error('Test runner crashed:', e.message); process.exit(1); });
