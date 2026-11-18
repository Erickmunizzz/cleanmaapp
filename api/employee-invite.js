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
    const {id, share = false} = await body(req);
    if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) || typeof share !== 'boolean') {
      return json(res, 400, {error: 'Invalid employee.'});
    }
    const path = employeeRecord(ctx.company, id);
    const [employee] = await supabaseAdmin(path + '&select=email,phone,profile_id,invitation_sent_at', undefined, 'GET');
    if (!employee) return json(res, 404, {error: 'Active employee not found.'});
    const email = employee.email?.trim().toLowerCase();
    const phone = employee.phone?.replace(/[\s()-]/g, "");
    if (!email && !/^\+[1-9]\d{7,14}$/.test(phone ?? "")) {
      return json(res, 400, {error: 'Use an email address or an international mobile number such as +447700900000.'});
    }
    const login = email || phone;
    if (!share && employee.invitation_sent_at) return json(res, 200, {status: 'sent'});

    const password = 'Cm!9-' + createHmac('sha256', env('PAYMENT_TOKEN_ENCRYPTION_KEY'))
      .update('cleanma-cleaner-invite:v1:' + id + ':' + login).digest('base64url').slice(0, 24);
    let profileId = employee.profile_id;
    if (!profileId) {
      try {
        const created = await supabaseAdmin('/auth/v1/admin/users', {
          ...(email ? {email, email_confirm: true} : {phone, phone_confirm: true}), password,
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
    if (account.app_metadata?.cleanma_employee_id !== id || (email ? account.email?.toLowerCase() !== email : account.phone?.replace(/^\+/, '') !== phone.slice(1))) {
      return json(res, 409, {error: 'The linked login uses different details. Contact support before re-inviting this employee.'});
    }

    const message = 'You have been invited to the CleanMa Cleaner app.\n\nOpen or install the app: ' +
      origin + '/cleaner.html\nSign-in: ' + login + '\nTemporary password: ' + password +
      '\n\nChoose a new password when you first sign in.';
    if (share) return json(res, 200, {status: 'share', message, phone: employee.phone});
    if (!email) return json(res, 200, {status: 'share_required'});
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
