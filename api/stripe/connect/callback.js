import {json, origin, stripeOAuthCallback} from '../../../server/payments.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, {error: 'Method not allowed'});
  res.setHeader('Cache-Control', 'no-store');
  let result = 'stripe_return';
  try {
    await stripeOAuthCallback(req, res);
  } catch (error) {
    result = error.message === 'OAUTH_CANCELLED' ? 'stripe_cancelled' : 'stripe_failed';
  }
  res.setHeader('Location', origin + '/admin/settings?finance=integrations&integration=' + result);
  res.statusCode = 303;
  return res.end();
}
