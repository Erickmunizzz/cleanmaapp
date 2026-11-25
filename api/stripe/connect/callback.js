import {json, origin, stripeOAuthCallback} from '../../../server/payments.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, {error: 'Method not allowed'});
  res.setHeader('Cache-Control', 'no-store');
  let result = 'stripe_return';
  let reason = '';
  try {
    await stripeOAuthCallback(req, res);
  } catch (error) {
    result = error.message === 'OAUTH_CANCELLED' ? 'stripe_cancelled' : 'stripe_failed';
    const allowed = ['INVALID_OAUTH_STATE', 'STRIPE_CLIENT_ID_MISSING', 'STRIPE_CLIENT_ID_INVALID', 'STRIPE_ACCOUNT_MISMATCH', 'CONFIGURATION_REQUIRED'];
    if (allowed.includes(error.message)) reason = error.message;
  }
  res.setHeader('Location', origin + '/admin/settings?finance=integrations&integration=' + result + (reason ? '&reason=' + reason : ''));
  res.statusCode = 303;
  return res.end();
}
