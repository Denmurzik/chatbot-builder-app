import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BotConnectionView,
  BotView,
  EnvVarInput,
  EnvVarView,
  ValidationError,
  VkConnectionMode,
} from '@chatbot/model';
import { apiFetch } from './client';

export type { BotConnectionView, VkConnectionMode };

export interface TelegramConnectionView {
  messenger: 'TELEGRAM';
  tokenMask: string;
  botUsername: string;
}

export interface ConnectVkInput {
  token: string;
  groupId: number;
  mode: VkConnectionMode;
  confirmationCode?: string;
  secret?: string;
}

export interface VkConnectionResult {
  messenger: 'VK';
  tokenMask: string;
  vkGroupId: number;
  vkMode: VkConnectionMode;
  vkHasSecret: boolean;
  vkConfirmationCode?: string;
  groupName: string;
}

export interface PublishResult {
  bot: BotView;
  warnings: ValidationError[];
}

const botsKey = (projectId: string) => ['projects', projectId, 'bots'] as const;
const botPath = (projectId: string, botId: string) => `/projects/${projectId}/bots/${botId}`;

export function useBots(projectId: string) {
  return useQuery({
    queryKey: botsKey(projectId),
    queryFn: () => apiFetch<BotView[]>(`/projects/${projectId}/bots`),
  });
}

export function useCreateBot(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<BotView>(`/projects/${projectId}/bots`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: botsKey(projectId) }),
  });
}

export function useDeleteBot(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (botId: string) => apiFetch<void>(botPath(projectId, botId), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: botsKey(projectId) }),
  });
}

export function useSaveEnvironment(projectId: string, botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EnvVarInput[]) =>
      apiFetch<EnvVarView[]>(`${botPath(projectId, botId)}/environment`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: botsKey(projectId) }),
  });
}

export function useConnectTelegram(projectId: string, botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch<TelegramConnectionView>(`${botPath(projectId, botId)}/connections/telegram`, {
        method: 'PUT',
        body: JSON.stringify({ token }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: botsKey(projectId) }),
  });
}

export function useDisconnectTelegram(projectId: string, botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`${botPath(projectId, botId)}/connections/telegram`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: botsKey(projectId) }),
  });
}

export function useConnectVk(projectId: string, botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectVkInput) =>
      apiFetch<VkConnectionResult>(`${botPath(projectId, botId)}/connections/vk`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: botsKey(projectId) }),
  });
}

export function useDisconnectVk(projectId: string, botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`${botPath(projectId, botId)}/connections/vk`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: botsKey(projectId) }),
  });
}

export function usePublishBot(projectId: string, botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<PublishResult>(`${botPath(projectId, botId)}/publish`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: botsKey(projectId) }),
  });
}
