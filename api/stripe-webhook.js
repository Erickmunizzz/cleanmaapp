import { catalog, db, env, json, stripe, verifySignature } from '../server/payments.mjs';

export const config = { api: { bodyParser: false } };

const subscriptionEvents = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
]);
const invoiceEvents = new Set(['invoice.paid', 'invoice.payment_failed']);
const checkoutEvents = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
]);
const stripeId = (value, prefix) => {
  const id = typeof value === 'string' ? value : value?.id;
  return typeof id === 'string' && id.startsWith(prefix) && /^[A-Za-z0-9_]+$/.test(id) ? id : null;
};
const reply = res => json(res, 200, { received: true });

function subscriptionId(type, object) {
  if (subscriptionEvents.has(type)) return stripeId(object?.id, 'sub_');
  if (invoiceEvents.has(type)) {
    return stripeId(object?.parent?.subscription_details?.subscription, 'sub_')
      || stripeId(object?.subscription, 'sub_');
  }
  if (checkoutEvents.has(type) && object?.mode === 'subscription') return stripeId(object.subscription, 'sub_');
  return null;
}

function paymentStatus(subscription, invoice, event, object) {
  switch (subscription.status) {
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelled';
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return 'past_due';
    case 'active':
      if (invoice?.status === 'paid') return 'active';
      // An old failure notification must not reverse a later successful invoice.
      if (event === 'invoice.payment_failed' && invoice?.id && invoice.id === object?.id) return 'past_due';
      return 'incomplete';
    case 'incomplete':
    case 'trialing':
      return 'incomplete';
    default:
      throw new Error('UNKNOWN_SUBSCRIPTION_STATUS');
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, {});
  let event;
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 1048576) return json(res, 413, {});
      chunks.push(buffer);
    }
    const raw = Buffer.concat(chunks, bytes);
    if (!verifySignature(raw, req.headers['stripe-signature'], env('STRIPE_WEBHOOK_SECRET'))) {
      return json(res, 400, { error: 'Invalid signature' });
    }
    try { event = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid event' }); }
    // A Connect merchant's client payments do not control its CleanMa entitlement.
    if (event?.account) return reply(res);
    const object = event?.data?.object;
    const id = subscriptionId(event?.type, object);
    if (!id) return reply(res); // Includes ordinary one-off invoices.
    if (!stripeId(event.id, 'evt_') || !Number.isSafeInteger(event.created) || event.created <= 0) {
      return json(res, 400, { error: 'Invalid event' });
    }

    // Re-fetch canonical Stripe state rather than trusting a possibly stale event snapshot.
    const observedAt = new Date().toISOString();
    const sub = await stripe('subscriptions/' + id + '?expand%5B%5D=latest_invoice');
    const claimId = sub.metadata?.claim_id;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(claimId || '')) return reply(res);
    const customerId = stripeId(sub.customer, 'cus_');
    if (sub.id !== id || !customerId) throw new Error('INVALID_SUBSCRIPTION');
    const item = sub.items?.data?.[0];
    const interval = item?.price?.recurring?.interval;
    const plan = Object.keys(catalog).find(t => catalog[t]?.[interval]?.[0] === item?.price?.id);
    const selected = catalog[plan]?.[interval];
    if (!selected || sub.items.data.length !== 1 || item.quantity !== 1 ||
        item.price.currency !== 'gbp' || item.price.unit_amount !== selected[1] ||
        item.price.recurring.interval_count !== 1) throw new Error('UNRECOGNISED_PRICE');

    const invoiceId = stripeId(sub.latest_invoice, 'in_');
    const invoice = typeof sub.latest_invoice === 'string' && invoiceId
      ? await stripe('invoices/' + invoiceId) : sub.latest_invoice;
    if (event.type === 'invoice.paid' && invoice?.id === object?.id && invoice?.status === 'paid'
        && ['incomplete', 'past_due', 'unpaid'].includes(sub.status)) {
      throw new Error('STRIPE_STATE_NOT_SETTLED');
    }
    const status = paymentStatus(sub, invoice, event.type, object);
    const period = item.current_period_end ?? sub.current_period_end;
    if (status === 'active' && !(Number.isSafeInteger(period) && period > 0)) {
      throw new Error('MISSING_PAID_PERIOD');
    }
    await db('apply_subscription', {
      event_id: event.id,
      claim_id: claimId,
      subscription_id: id,
      customer_id: customerId,
      company_id: sub.metadata.company_id,
      plan,
      price_id: selected[0],
      status,
      event_created: event.created,
      observed_at: observedAt,
      period_end: Number.isSafeInteger(period) && period > 0 ? new Date(period * 1000).toISOString() : null,
    });
    return reply(res);
  } catch (error) {
    // Do not print Stripe payloads, customer details, URLs or credentials.
    const safeReasons = [
      'CONFIGURATION_REQUIRED', 'PROVIDER_REQUEST_FAILED', 'INVALID_SUBSCRIPTION', 'UNRECOGNISED_PRICE',
      'UNKNOWN_SUBSCRIPTION_STATUS', 'MISSING_PAID_PERIOD', 'SUBSCRIPTION_CONFLICT', 'UNKNOWN_CHECKOUT',
      'INVALID_SUBSCRIPTION_SNAPSHOT', 'STRIPE_STATE_NOT_SETTLED',
    ];
    console.error('[CleanMa billing] Stripe webhook retry', {
      event: stripeId(event?.id, 'evt_'),
      reason: safeReasons.includes(error?.message) ? error.message : 'unexpected',
    });
    return json(res, 503, { error: 'Event not processed. Retry required.' });
  }
}
