import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: mocks } }));

function mockObserver(recovery: typeof import('@/lib/password-recovery')) {
  let listener: ((event: AuthChangeEvent, session: Session | null) => void) | undefined;
  const unsubscribe = vi.fn();
  recovery.observePasswordRecovery({
    onAuthStateChange(callback) {
      listener = callback;
      return { data: { subscription: { id: 'test', callback, unsubscribe } } };
    },
    initialize: async () => ({ error: null }),
  });
  return { unsubscribe, send: (event: AuthChangeEvent, session: Session | null) => listener?.(event, session) };
}
const session = (access_token: string) => ({ access_token, user: { id: 'recovering-user' } } as Session);

describe('password recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    window.history.replaceState({}, '', '/auth?mode=recovery');
  });

  it('requests emails with canonical Owner/Cleaner return URLs and gives a neutral success response', async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    const { PasswordRecoveryPage, PasswordRecoveryLink } = await import('@/components/auth/PasswordRecovery');
    const { recoveryReturnUrl } = await import('@/lib/password-recovery');
    render(<><PasswordRecoveryLink role="owner" /><PasswordRecoveryPage role="cleaner" /></>);
    expect(screen.getByRole('link', { name: 'Forgot your password?' }).getAttribute('href')).toBe('/auth?mode=recovery');
    expect(recoveryReturnUrl('owner')).toBe('https://cleanmaapp.com/auth?mode=recovery');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'employee@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await screen.findByText(/If that email has an account/);
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('employee@example.com', {
      redirectTo: 'https://cleanmaapp.com/auth?mode=recovery&role=cleaner',
    });
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/cleaner.html');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('does not treat an ordinary sign-in or another tab’s recovery as authorization', async () => {
    window.history.replaceState({}, '', '/auth?mode=recovery#type=recovery&access_token=expected&refresh_token=test');
    const recovery = await import('@/lib/password-recovery');
    const { PasswordRecoveryPage } = await import('@/components/auth/PasswordRecovery');
    const observer = mockObserver(recovery);
    observer.send('INITIAL_SESSION', session('expected'));
    observer.send('SIGNED_IN', session('expected'));
    observer.send('PASSWORD_RECOVERY', session('different'));
    render(<PasswordRecoveryPage role="owner" />);
    expect(screen.getByText(/Checking the reset link/)).toBeTruthy();
    expect(screen.queryByLabelText('New password', { exact: true })).toBeNull();
    window.history.replaceState({}, '', '/auth?mode=recovery');
    observer.send('PASSWORD_RECOVERY', session('expected'));
    await screen.findByLabelText('New password', { exact: true });
    expect(observer.unsubscribe).toHaveBeenCalledOnce();
  });

  it('consumes a verified recovery event emitted before the component mounts and changes the password once', async () => {
    window.history.replaceState({}, '', '/auth?mode=recovery#type=recovery&access_token=expected&refresh_token=test');
    const recovery = await import('@/lib/password-recovery');
    const observer = mockObserver(recovery);
    window.history.replaceState({}, '', '/auth?mode=recovery');
    observer.send('PASSWORD_RECOVERY', session('expected'));
    const { PasswordRecoveryPage } = await import('@/components/auth/PasswordRecovery');
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'recovering-user' } }, error: null });
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    render(<PasswordRecoveryPage role="owner" />);
    fireEvent.change(screen.getByLabelText('New password', { exact: true }), { target: { value: 'a-long-test-password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-long-test-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    await screen.findByText(/Password updated/);
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ password: 'a-long-test-password' });
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' }));
  });

  it('shows expired/invalid links without rendering a password form', async () => {
    window.history.replaceState({}, '', '/auth?mode=recovery#error=access_denied&error_code=otp_expired');
    const recovery = await import('@/lib/password-recovery');
    mockObserver(recovery);
    const { PasswordRecoveryPage } = await import('@/components/auth/PasswordRecovery');
    render(<PasswordRecoveryPage role="owner" />);
    expect(screen.getByRole('alert').textContent).toMatch(/invalid or has expired/);
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save password' })).toBeNull();
  });
});
