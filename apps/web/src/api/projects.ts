import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EnvVarInput, EnvVarView, Scenario } from '@chatbot/model';
import { apiFetch } from './client';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  botsCount?: number;
  blocksCount?: number;
  publishedBotsCount?: number;
  messengers?: ('TELEGRAM' | 'VK')[];
}

export interface ProjectDetails {
  id: string;
  name: string;
  scenario: Scenario;
  environment: EnvVarView[];
  updatedAt: string;
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch<ProjectSummary[]>('/projects'),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ id: string; name: string; scenario: Scenario }>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useRenameProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch<ProjectSummary>(`/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/projects/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['projects', id],
    queryFn: () => apiFetch<ProjectDetails>(`/projects/${id}`),
  });
}

export function useSaveScenario(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scenario: Scenario) =>
      apiFetch<{ updatedAt: string }>(`/projects/${id}/scenario`, {
        method: 'PUT',
        body: JSON.stringify(scenario),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useSaveEnvironment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EnvVarInput[]) =>
      apiFetch<EnvVarView[]>(`/projects/${id}/environment`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: (environment) => {
      queryClient.setQueryData<ProjectDetails>(['projects', id], (prev) =>
        prev ? { ...prev, environment } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ['projects', id] });
    },
  });
}
