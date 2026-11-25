import { z } from 'zod';
import { envVarViewSchema } from './environment';

// Статус бота, тип мессенджера и представление бота для клиента (без токенов и секретов)
export const botStatusSchema = z.enum(['CREATED', 'PUBLISHED']);

export const messengerTypeSchema = z.enum(['TELEGRAM', 'VK']);
export type MessengerType = z.infer<typeof messengerTypeSchema>;

export const vkConnectionModeSchema = z.enum(['CALLBACK', 'LONG_POLL']);
export type VkConnectionMode = z.infer<typeof vkConnectionModeSchema>;

export const botConnectionViewSchema = z.object({
  messenger: messengerTypeSchema,
  tokenMask: z.string(),
  vkGroupId: z.number().int().positive().optional(),
  vkMode: vkConnectionModeSchema.optional(),
  vkHasSecret: z.boolean().optional(),
  vkConfirmationCode: z.string().optional(),
});
export type BotConnectionView = z.infer<typeof botConnectionViewSchema>;

export const botViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: botStatusSchema,
  publishedAt: z.string().nullable(),
  connections: z.array(botConnectionViewSchema),
  environment: z.array(envVarViewSchema),
});

export type BotView = z.infer<typeof botViewSchema>;
