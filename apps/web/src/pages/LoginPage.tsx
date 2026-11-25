import { Link, useNavigate } from 'react-router-dom';
import { useLogin } from '@/api/auth';
import { ApiError } from '@/api/client';
import { ru } from '@/i18n/ru';
import { AuthForm } from './AuthForm';

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();

  let errorMessage: string | undefined;
  if (login.error) {
    errorMessage =
      login.error instanceof ApiError && login.error.status === 401
        ? ru.auth.invalidCredentials
        : ru.common.unknownError;
  }

  return (
    <AuthForm
      title={ru.auth.loginTitle}
      description={ru.auth.loginDescription}
      submitLabel={ru.auth.submitLogin}
      passwordAutoComplete="current-password"
      pending={login.isPending}
      errorMessage={errorMessage}
      onSubmit={(values) => login.mutate(values, { onSuccess: () => navigate('/projects') })}
      footer={
        <>
          {ru.auth.noAccount}{' '}
          <Link to="/register" className="text-foreground underline underline-offset-4">
            {ru.auth.toRegister}
          </Link>
        </>
      }
    />
  );
}
