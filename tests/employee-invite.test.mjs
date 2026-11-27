import test from 'node:test';
import assert from 'node:assert/strict';
import invite from '../api/employee-invite.js';

test('employee invitation contains the original login details and optional phone setup instructions', async t => {
  const company = '00000000-0000-4000-8000-000000000001';
  const staff = '00000000-0000-4000-8000-000000000002';
  const profile = '00000000-0000-4000-8000-000000000003';
  const env = {
    SUPABASE_URL: 'https://database.example.invalid',
    SUPABASE_ANON_KEY: 'test-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    PAYMENT_TOKEN_ENCRYPTION_KEY: 'test-secret',
    RESEND_API_KEY: 'test-resend',
    CLEANMA_INVITE_FROM: 'CleanMa <invites@example.invalid>',
  };
  const original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let outbound;
  let markedSent = false;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    switch (url.origin + url.pathname) {
      case 'https://database.example.invalid/auth/v1/user':
        return Response.json({ id: 'owner' });
      case 'https://database.example.invalid/rest/v1/profiles':
        if (url.searchParams.get('select') === 'must_change_password') {
          assert.equal(url.searchParams.get('company_id'), 'eq.' + company);
          return Response.json([{ must_change_password: true }]);
        }
        return Response.json([{ id: 'owner', company_id: company, role: 'owner', is_active: true }]);
      case 'https://database.example.invalid/rest/v1/staff':
        assert.equal(url.searchParams.get('company_id'), 'eq.' + company);
        if (options.method === 'PATCH') {
          assert(outbound);
          markedSent = true;
          return Response.json([]);
        }
        return Response.json([{ email: 'cleaner@example.invalid', profile_id: profile, invitation_sent_at: null }]);
      case 'https://database.example.invalid/auth/v1/admin/users/' + profile:
        return Response.json({ email: 'cleaner@example.invalid', app_metadata: { cleanma_employee_id: staff } });
      case 'https://api.resend.com/emails':
        outbound = JSON.parse(options.body);
        assert.equal(options.headers['Idempotency-Key'], 'cleanma-invite/' + staff + '/' + profile);
        return Response.json({ id: 'email_test' });
      default:
        assert.fail('Unexpected mock URL: ' + url.href);
    }
  });
  const res = { setHeader() {}, end(value) { this.body = JSON.parse(value); } };
  await invite({
    method: 'POST',
    headers: { origin: 'https://cleanmaapp.com', authorization: 'Bearer test-owner' },
    body: { id: staff },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { status: 'sent' });
  assert.equal(markedSent, true);
  assert.deepEqual(outbound.to, ['cleaner@example.invalid']);
  assert.match(outbound.text, /Open CleanMa Cleaner: https:\/\/cleanmaapp\.com\/cleaner\.html/);
  assert.match(outbound.text, /Temporary password: Cm!9-/);
  assert.match(outbound.text, /Choose a new password when you first sign in/);
  assert.match(outbound.text, /iPhone: Open the link in Safari[^\n]+Add to Home Screen/);
  assert.match(outbound.text, /Android: Open the link in Chrome[^\n]+Add to Home screen/);
  assert.match(outbound.text, /No app store download is needed/);
});
