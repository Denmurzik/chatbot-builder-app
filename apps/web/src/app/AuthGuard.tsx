import { Loader2 } from 'lucide-react';
import { Navigate, Outlet } from 'react-router-dom';
import { useMe } from '@/api/auth';
import { ru } from '@/i18n/ru';

// Без сессии — переход на /login
export function AuthGuard() {
  const { data: author, isLoading } = useMe();

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {ru.common.loading}
      </div>
    );
  }
  if (!author) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
