import { vkConnectionModeSchema } from '@chatbot/model';
import { z } from 'zod';

export const createBotBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Название бота не может быть пустым')
    .max(200, 'Название бота слишком длинное'),
});

export const connectTelegramBodySchema = z.object({
  token: z.string().trim().min(1, 'Введите токен бота'),
});

export const connectVkBodySchema = z
  .object({
    token: z.string().trim().min(1, 'Введите токен сообщества VK'),
    groupId: z.coerce.number().int().positive('Укажите корректный ID сообщества VK'),
    mode: vkConnectionModeSchema.default('CALLBACK'),
    confirmationCode: z.string().trim().optional(),
    secret: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'CALLBACK' && (!val.confirmationCode || val.confirmationCode.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmationCode'],
        message: 'Для режима Callback API укажите код подтверждения',
      });
    }
  });

export type CreateBotBody = z.infer<typeof createBotBodySchema>;
export type ConnectTelegramBody = z.infer<typeof connectTelegramBodySchema>;
export type ConnectVkBody = z.infer<typeof connectVkBodySchema>;
