import {json, origin} from '../../../server/payments.mjs';

export default function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, {error: 'Method not allowed'});
  // Hosted Express onboarding returns without credentials. Settings reloads the
  // authenticated company's account from Stripe before displaying readiness.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', origin + '/admin/settings?finance=integrations&integration=stripe_return');
  res.statusCode = 303;
  res.end();
}
