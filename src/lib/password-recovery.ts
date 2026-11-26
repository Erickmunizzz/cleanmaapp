import type { SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';

export type RecoveryRole = 'owner' | 'cleaner';
type RecoveryState =
  | { status: 'request' | 'checking' | 'invalid' }
  | { status: 'ready'; userId: string };

const requestState: RecoveryState = { status: 'request' };
let state: RecoveryState = requestState;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getSnapshot = () => state;
const getServerSnapshot = () => requestState;

function setState(value: RecoveryState) {
  state = value;
  for (const listener of listeners) listener();
}

export function recoveryPath(role: RecoveryRole) {
  return role === 'cleaner' ? '/auth?mode=recovery&role=cleaner' : '/auth?mode=recovery';
}

export function recoveryReturnUrl(role: RecoveryRole) {
  return 'https://cleanmaapp.com' + recoveryPath(role);
}

export function recoveryRole(search: string): RecoveryRole {
  return new URLSearchParams(search).get('role') === 'cleaner' ? 'cleaner' : 'owner';
}

/**
 * Register before React mounts: the browser client may finish consuming the
 * link and clear its fragment before the route component receives the event.
 * Do not mistake an existing session, or events from other tabs, for a link.
 */
export function observePasswordRecovery(auth: Pick<SupabaseClient['auth'], 'onAuthStateChange' | 'initialize'>) {
  if (typeof window === 'undefined' || window.location.pathname !== '/auth' ||
      new URLSearchParams(window.location.search).get('mode') !== 'recovery') return;
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (fragment.has('error') || fragment.has('error_code') || fragment.has('error_description')) {
    setState({ status: 'invalid' });
    return;
  }
  let expectedToken = fragment.get('access_token');
  if (fragment.get('type') !== 'recovery' || !expectedToken || !fragment.has('refresh_token')) return;

  setState({ status: 'checking' });
  let complete = false;
  const timer = setTimeout(() => finish({ status: 'invalid' }), 15_000);
  const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session && session.access_token === expectedToken) {
      finish({ status: 'ready', userId: session.user.id });
    }
  });
  function finish(result: RecoveryState) {
    if (complete) return;
    complete = true;
    expectedToken = null;
    clearTimeout(timer);
    subscription.unsubscribe();
    setState(result);
  }
  void auth.initialize().then(result => {
    if (result.error) finish({ status: 'invalid' });
  }).catch(() => finish({ status: 'invalid' }));
}

export function usePasswordRecoveryState() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
