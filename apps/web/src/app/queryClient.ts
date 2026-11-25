import { QueryCache, QueryClient } from '@tanstack/react-query';
import { meKey } from '@/api/auth';
import { ApiError } from '@/api/client';

const NO_RETRY_STATUSES = [401, 403, 404];

export function createQueryClient(): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, error) =>
          !(error instanceof ApiError && NO_RETRY_STATUSES.includes(error.status)) && count < 2,
      },
    },
    queryCache: new QueryCache({
      // 401 в любом запросе — сессии нет: AuthGuard перенаправит на /login
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) {
          queryClient.setQueryData(meKey, null);
        }
      },
    }),
  });
  return queryClient;
}
