import { createFileRoute, redirect } from '@tanstack/react-router';
import { PasswordRecoveryPage } from '@/components/auth/PasswordRecovery';
import { recoveryRole } from '@/lib/password-recovery';

export const Route = createFileRoute('/auth')({
  beforeLoad: ({ location }) => {
    if (new URLSearchParams(location.searchStr).get('mode') === 'recovery') {
      return { recoveryRole: recoveryRole(location.searchStr) };
    }
    throw redirect({ href: '/admin/login' + location.searchStr + (location.hash ? '#' + location.hash.replace(/^#/, '') : '') });
  },
  component: () => <PasswordRecoveryPage role={Route.useRouteContext().recoveryRole} />,
});
