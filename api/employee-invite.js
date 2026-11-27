import {createHmac} from 'node:crypto';
import {body, env, json, origin, owner, request} from '../server/payments.mjs';

function supabaseAdmin(path, data, method = 'POST') {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return request(env('SUPABASE_URL') + path, {
    method,
    headers: {apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation'},
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

function employeeRecord(company, id) {
  return '/rest/v1/staff?company_id=eq.' + company + '&id=eq.' + id + '&is_active=eq.true';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, {error: 'Method not allowed'});
  if (req.headers.origin !== origin) return json(res, 403, {error: 'Origin not allowed'});
  let ctx;
  try { ctx = await owner(req); }
  catch { return json(res, 403, {error: 'An active owner account is required.'}); }
  try {
    const {id} = await body(req);
    if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
      return json(res, 400, {error: 'Invalid employee.'});
    }
    const path = employeeRecord(ctx.company, id);
    const [employee] = await supabaseAdmin(path + '&select=email,profile_id,invitation_sent_at', undefined, 'GET');
    if (!employee) return json(res, 404, {error: 'Active employee not found.'});
    const email = employee.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, 400, {error: 'Add a valid employee email address.'});
    }
    if (employee.invitation_sent_at) return json(res, 200, {status: 'sent'});

    const password = 'Cm!9-' + createHmac('sha256', env('PAYMENT_TOKEN_ENCRYPTION_KEY'))
      .update('cleanma-cleaner-invite:v1:' + id + ':' + email).digest('base64url').slice(0, 24);
    let profileId = employee.profile_id;
    if (!profileId) {
      try {
        const created = await supabaseAdmin('/auth/v1/admin/users', {
          email, email_confirm: true, password,
          app_metadata: {cleanma_employee_id: id, cleanma_company_id: ctx.company},
        });
        profileId = created.id;
      } catch {
        // A concurrent invite may have finished provisioning the same record.
        const [current] = await supabaseAdmin(path + '&select=profile_id', undefined, 'GET');
        profileId = current?.profile_id;
        if (!profileId) return json(res, 409, {error: 'Could not create the login. Check whether these contact details already have a CleanMa account.'});
      }
    }
    const [profile] = await supabaseAdmin('/rest/v1/profiles?select=must_change_password&id=eq.' + profileId +
      '&company_id=eq.' + ctx.company + '&role=eq.cleaner&is_active=eq.true', undefined, 'GET');
    if (!profile?.must_change_password) return json(res, 200, {status: 'already_active'});
    const account = await supabaseAdmin('/auth/v1/admin/users/' + profileId, undefined, 'GET');
    if (account.app_metadata?.cleanma_employee_id !== id || account.email?.toLowerCase() !== email) {
      return json(res, 409, {error: 'The linked login uses different details. Contact support before re-inviting this employee.'});
    }

    const message = [
      'You have been invited to the CleanMa Cleaner app.',
      '',
      'Open CleanMa Cleaner: ' + origin + '/cleaner.html',
      'Sign-in: ' + email,
      'Temporary password: ' + password,
      '',
      'Choose a new password when you first sign in.',
      '',
      'Add CleanMa to your phone’s home screen (optional):',
      'iPhone: Open the link in Safari, tap Share → Add to Home Screen → Add. If offered, turn on Open as Web App.',
      'Android: Open the link in Chrome, tap ⋮ → Add to Home screen or Install and create shortcut, then follow the prompts.',
      'You can also keep using CleanMa in your browser. No app store download is needed.',
    ].join('\n');
    if (!process.env.RESEND_API_KEY || !process.env.CLEANMA_INVITE_FROM) {
      return json(res, 200, {status: 'email_unconfigured'});
    }
    await request('https://api.resend.com/emails', {
      method: 'POST',
      headers: {Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json',
        'Idempotency-Key': 'cleanma-invite/' + id + '/' + profileId},
      body: JSON.stringify({from: process.env.CLEANMA_INVITE_FROM, to: [email],
        subject: 'Your invitation to CleanMa', text: message}),
    });
    await supabaseAdmin(path + '&profile_id=eq.' + profileId, {invitation_sent_at: new Date().toISOString()}, 'PATCH');
    return json(res, 200, {status: 'sent'});
  } catch {
    return json(res, 502, {error: 'Invitation could not be delivered. Try again from Employees.'});
  }
}
