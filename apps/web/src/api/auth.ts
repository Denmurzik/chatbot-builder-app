import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from './client';

export interface Author {
  id: string;
  email: string;
}

export interface Credentials {
  email: string;
  password: string;
}

export const meKey = ['me'] as const;

// Текущий автор; null, если сессии нет
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async (): Promise<Author | null> => {
      try {
        return await apiFetch<Author>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: Credentials) =>
      apiFetch<Author>('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
    onSuccess: (author) => queryClient.setQueryData(meKey, author),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: Credentials) =>
      apiFetch<Author>('/auth/register', { method: 'POST', body: JSON.stringify(credentials) }),
    onSuccess: (author) => queryClient.setQueryData(meKey, author),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData(meKey, null);
      queryClient.removeQueries({ queryKey: ['projects'] });
    },
  });
}
