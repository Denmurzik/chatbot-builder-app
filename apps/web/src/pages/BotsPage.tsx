import { zodResolver } from '@hookform/resolvers/zod';
import type { BotView, ValidationError } from '@chatbot/model';
import { ArrowLeft, Check, Copy, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  type ConnectVkInput,
  useBots,
  useConnectTelegram,
  useConnectVk,
  useCreateBot,
  useDeleteBot,
  useDisconnectTelegram,
  useDisconnectVk,
  usePublishBot,
  useSaveEnvironment,
} from '@/api/bots';
import { ApiError } from '@/api/client';
import { BrandLogo } from '@/components/BrandLogo';
import { EnvironmentEditor } from '@/components/EnvironmentEditor';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ru } from '@/i18n/ru';

const nameSchema = z.object({ name: z.string().trim().min(1, ru.bots.nameRequired) });
const tokenSchema = z.object({ token: z.string().trim().min(1, ru.bots.tokenRequired) });
const vkFormSchema = z
  .object({
    token: z.string().trim().min(1, ru.bots.vkTokenRequired),
    groupId: z
      .string()
      .trim()
      .refine((val) => /^\d+$/.test(val) && Number(val) > 0 && Number.isSafeInteger(Number(val)), {
        message: ru.bots.vkGroupIdInvalid,
      }),
    mode: z.enum(['CALLBACK', 'LONG_POLL']),
    confirmationCode: z.string().trim().optional(),
    secret: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'CALLBACK' && !data.confirmationCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmationCode'],
        message: ru.bots.vkConfirmationRequired,
      });
    }
  });

/** Иконка Telegram (бумажный самолётик) для бейджа секции. */
function TelegramBadge() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-[#229ED9]/30 bg-[#229ED9]/12 text-[#167BAE] dark:text-[#4BB8EC]"
    >
      <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor">
        <path d="M21.94 4.16a1 1 0 0 0-1.05-.14L2.64 11.46a1 1 0 0 0 .08 1.88l4.49 1.4 1.74 5.23a1 1 0 0 0 1.66.4l2.58-2.46 4.46 3.27a1 1 0 0 0 1.56-.59l3-15.46a1 1 0 0 0-.27-.97ZM9.7 14.37l7.52-6.17-5.86 7.36-.34 2.57-1.14-3.44-.18-.32Z" />
      </svg>
    </span>
  );
}

/** Иконка ВКонтакте для бейджа секции. */
function VkBadge() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-[#0077FF]/30 bg-[#0077FF]/12 text-[#005FCC] dark:text-[#5CA3FF]"
    >
      <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor">
        <path d="M12.78 17.5c-5.47 0-8.59-3.75-8.72-10h2.74c.09 4.58 2.11 6.52 3.71 6.92V7.5h2.58v3.95c1.58-.17 3.24-1.97 3.8-3.95h2.58c-.43 2.44-2.23 4.24-3.51 4.98 1.28.6 3.33 2.17 4.11 5.02h-2.84c-.61-1.9-2.13-3.37-4.14-3.57v3.57h-.31Z" />
      </svg>
    </span>
  );
}

function CreateBotDialog(props: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createBot = useCreateBot(props.projectId);
  const form = useForm<z.infer<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: '' },
  });
  const onSubmit = form.handleSubmit(({ name }) => {
    createBot.mutate(name, {
      onSuccess: () => {
        props.onOpenChange(false);
        form.reset();
      },
      onError: () => toast.error(ru.common.unknownError),
    });
  });
  const close = (open: boolean) => {
    if (!open) form.reset();
    props.onOpenChange(open);
  };
  return (
    <Dialog open={props.open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ru.bots.createTitle}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="create-bot-name">{ru.bots.nameLabel}</FormLabel>
                  <FormControl>
                    <Input {...field} id="create-bot-name" name="name" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                {ru.common.cancel}
              </Button>
              <Button type="submit" disabled={createBot.isPending}>
                {ru.common.create}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteBotDialog(props: { projectId: string; bot: BotView; onClose: () => void }) {
  const deleteBot = useDeleteBot(props.projectId);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ru.bots.deleteTitle}</DialogTitle>
          <DialogDescription>{ru.bots.deleteDescription(props.bot.name)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onClose}>
            {ru.common.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteBot.isPending}
            onClick={() =>
              deleteBot.mutate(props.bot.id, {
                onSuccess: () => {
                  toast.success(ru.bots.deleted);
                  props.onClose();
                },
                onError: () => toast.error(ru.common.unknownError),
              })
            }
          >
            {ru.bots.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function tokenErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return ru.bots.tokenTaken;
    if (error.status === 400) return ru.bots.tokenInvalid;
    if (error.status === 502) return ru.bots.tokenUnavailable;
  }
  return ru.common.unknownError;
}

function TelegramSection(props: { projectId: string; bot: BotView }) {
  const connect = useConnectTelegram(props.projectId, props.bot.id);
  const disconnect = useDisconnectTelegram(props.projectId, props.bot.id);
  const [serverError, setServerError] = useState<string | null>(null);
  const connection = props.bot.connections.find((c) => c.messenger === 'TELEGRAM');
  const form = useForm<z.infer<typeof tokenSchema>>({
    resolver: zodResolver(tokenSchema),
    defaultValues: { token: '' },
  });

  const onSubmit = form.handleSubmit(({ token }) => {
    setServerError(null);
    connect.mutate(token, {
      onSuccess: () => {
        form.reset();
        toast.success(ru.bots.tokenSaved);
      },
      onError: (error) => setServerError(tokenErrorMessage(error)),
    });
  });

  const tokenInputId = `tg-token-${props.bot.id}`;

  return (
    <section className="flex flex-col gap-2 border-l-2 border-[#229ED9]/60 pl-4">
      <div className="flex items-center gap-2">
        <TelegramBadge />
        <h3 className="text-sm font-medium">{ru.bots.tokenSection}</h3>
      </div>
      {connection ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="break-all font-mono text-muted-foreground">{connection.tokenMask}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disconnect.isPending}
            onClick={() =>
              disconnect.mutate(undefined, { onError: () => toast.error(ru.common.unknownError) })
            }
          >
            {ru.bots.tokenDisconnect}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{ru.bots.notConnected}</p>
      )}
      <Form {...form}>
        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          <FormField
            control={form.control}
            name="token"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={tokenInputId}>{ru.bots.tokenLabel}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id={tokenInputId}
                    name="token"
                    type="password"
                    autoComplete="off"
                    onChange={(event) => {
                      setServerError(null);
                      field.onChange(event);
                    }}
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground">{ru.bots.tokenHint}</p>
                <FormMessage />
                {serverError ? <p className="text-sm text-destructive">{serverError}</p> : null}
              </FormItem>
            )}
          />
          <div>
            <Button type="submit" variant="outline" disabled={connect.isPending}>
              {connection ? ru.bots.tokenReplace : ru.bots.tokenConnect}
            </Button>
          </div>
        </form>
      </Form>
    </section>
  );
}

function vkErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const rawMessage = (error.body as { message?: unknown } | undefined)?.message;
    const serverText =
      typeof rawMessage === 'string' && rawMessage.trim().length > 0
        ? rawMessage
        : Array.isArray(rawMessage)
          ? rawMessage.filter((item): item is string => typeof item === 'string').join(', ')
          : null;
    if (error.status === 409) return serverText ?? ru.bots.vkTokenTaken;
    if (error.status === 400) return serverText ?? ru.bots.vkInvalid;
    if (error.status === 502) return serverText ?? ru.bots.vkUnavailable;
    if (serverText) return serverText;
  }
  return ru.common.unknownError;
}

function VkSection(props: { projectId: string; bot: BotView }) {
  const connect = useConnectVk(props.projectId, props.bot.id);
  const disconnect = useDisconnectVk(props.projectId, props.bot.id);
  const [serverError, setServerError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const connection = props.bot.connections.find((c) => c.messenger === 'VK');
  const form = useForm<z.infer<typeof vkFormSchema>>({
    resolver: zodResolver(vkFormSchema),
    defaultValues: {
      token: '',
      groupId: connection?.vkGroupId ? String(connection.vkGroupId) : '',
      mode: connection?.vkMode ?? 'CALLBACK',
      confirmationCode: connection?.vkConfirmationCode ?? '',
      secret: '',
    },
  });

  const mode = form.watch('mode');
  const webhookUrl = `${window.location.origin}/webhook/vk/${props.bot.id}`;
  const showForm = !connection || editing;

  const openEditForm = () => {
    setServerError(null);
    form.reset({
      token: '',
      groupId: connection?.vkGroupId ? String(connection.vkGroupId) : '',
      mode: connection?.vkMode ?? 'CALLBACK',
      confirmationCode: connection?.vkConfirmationCode ?? '',
      secret: '',
    });
    setEditing(true);
  };

  const onCopyWebhook = async () => {
    try {
      await navigator.clipboard?.writeText(webhookUrl);
      setCopied(true);
      toast.success(ru.bots.vkWebhookCopied);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(ru.common.unknownError);
    }
  };

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    const payload: ConnectVkInput = {
      token: values.token,
      groupId: Number(values.groupId),
      mode: values.mode,
      ...(values.mode === 'CALLBACK' && values.confirmationCode
        ? { confirmationCode: values.confirmationCode }
        : {}),
      ...(values.mode === 'CALLBACK' && values.secret ? { secret: values.secret } : {}),
    };
    connect.mutate(payload, {
      onSuccess: () => {
        form.reset({
          token: '',
          groupId: String(payload.groupId),
          mode: payload.mode,
          confirmationCode: payload.confirmationCode ?? '',
          secret: '',
        });
        setEditing(false);
        toast.success(ru.bots.vkSaved);
      },
      onError: (error) => setServerError(vkErrorMessage(error)),
    });
  });

  const vkTokenId = `vk-token-${props.bot.id}`;
  const vkGroupIdInputId = `vk-group-id-${props.bot.id}`;
  const vkConfirmationId = `vk-confirmation-${props.bot.id}`;
  const vkSecretId = `vk-secret-${props.bot.id}`;

  return (
    <section className="flex flex-col gap-2 border-l-2 border-[#0077FF]/60 pl-4">
      <div className="flex items-center gap-2">
        <VkBadge />
        <h3 className="text-sm font-medium">{ru.bots.vkSection}</h3>
      </div>
      {connection ? (
        <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-muted-foreground">{connection.tokenMask}</span>
              {connection.vkGroupId ? (
                <span className="text-muted-foreground">
                  {ru.bots.vkCommunityPrefix} #{connection.vkGroupId}
                </span>
              ) : null}
              <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                {connection.vkMode === 'LONG_POLL'
                  ? ru.bots.vkModeLongPoll
                  : ru.bots.vkModeCallback}
              </span>
              <span className="text-xs text-muted-foreground">
                {connection.vkHasSecret ? ru.bots.vkSecretSet : ru.bots.vkSecretNotSet}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {!editing ? (
                <Button type="button" variant="outline" size="sm" onClick={openEditForm}>
                  {ru.bots.vkUpdate}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disconnect.isPending}
                onClick={() =>
                  disconnect.mutate(undefined, {
                    onSuccess: () => {
                      setEditing(false);
                      toast.success(ru.bots.vkDisconnected);
                    },
                    onError: () => toast.error(ru.common.unknownError),
                  })
                }
              >
                {ru.bots.vkDisconnect}
              </Button>
            </div>
          </div>
          {connection.vkMode === 'CALLBACK' ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{ru.bots.vkWebhookLabel}</span>
              <div className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
                  {webhookUrl}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  aria-label={ru.bots.vkWebhookCopy}
                  onClick={onCopyWebhook}
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {ru.bots.vkWebhookCopy}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{ru.bots.vkNotConnected}</p>
      )}
      {showForm ? (
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <FormField
              control={form.control}
              name="token"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={vkTokenId}>{ru.bots.vkTokenLabel}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      id={vkTokenId}
                      name="token"
                      type="password"
                      autoComplete="off"
                      onChange={(event) => {
                        setServerError(null);
                        field.onChange(event);
                      }}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">{ru.bots.vkTokenHint}</p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="groupId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={vkGroupIdInputId}>{ru.bots.vkGroupIdLabel}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      id={vkGroupIdInputId}
                      name="groupId"
                      inputMode="numeric"
                      autoComplete="off"
                      onChange={(event) => {
                        setServerError(null);
                        field.onChange(event);
                      }}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">{ru.bots.vkGroupIdHint}</p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="text-sm font-medium">{ru.bots.vkModeLabel}</legend>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={`vk-mode-${props.bot.id}`}
                          value="CALLBACK"
                          checked={field.value === 'CALLBACK'}
                          onChange={() => {
                            setServerError(null);
                            field.onChange('CALLBACK');
                          }}
                        />
                        {ru.bots.vkModeCallback}
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={`vk-mode-${props.bot.id}`}
                          value="LONG_POLL"
                          checked={field.value === 'LONG_POLL'}
                          onChange={() => {
                            setServerError(null);
                            field.onChange('LONG_POLL');
                          }}
                        />
                        {ru.bots.vkModeLongPoll}
                      </label>
                    </div>
                  </fieldset>
                  <FormMessage />
                </FormItem>
              )}
            />
            {mode === 'CALLBACK' ? (
              <>
                <FormField
                  control={form.control}
                  name="confirmationCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor={vkConfirmationId}>{ru.bots.vkConfirmationLabel}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          id={vkConfirmationId}
                          name="confirmationCode"
                          value={field.value ?? ''}
                          autoComplete="off"
                          onChange={(event) => {
                            setServerError(null);
                            field.onChange(event);
                          }}
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">{ru.bots.vkConfirmationHint}</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="secret"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor={vkSecretId}>{ru.bots.vkSecretLabel}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          id={vkSecretId}
                          name="secret"
                          value={field.value ?? ''}
                          type="password"
                          autoComplete="off"
                          onChange={(event) => {
                            setServerError(null);
                            field.onChange(event);
                          }}
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">{ru.bots.vkSecretHint}</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : null}
            {serverError ? <p className="text-sm text-destructive">{serverError}</p> : null}
            <div className="flex items-center gap-2">
              <Button type="submit" variant="outline" disabled={connect.isPending}>
                {connection ? ru.bots.vkSave : ru.bots.vkConnect}
              </Button>
              {connection ? (
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  {ru.common.cancel}
                </Button>
              ) : null}
            </div>
          </form>
        </Form>
      ) : null}
    </section>
  );
}

// 400 несёт русское сообщение сервера с подробностями; без него — общая подсказка
function environmentErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 400) {
    const message = (error.body as { message?: unknown } | undefined)?.message;
    return typeof message === 'string' ? message : ru.bots.environmentInvalid;
  }
  return ru.common.unknownError;
}

function EnvironmentSection(props: { projectId: string; bot: BotView }) {
  const save = useSaveEnvironment(props.projectId, props.bot.id);
  const [error, setError] = useState<string | null>(null);
  // После успешного сохранения строки собираются заново: введённые секреты не остаются в состоянии
  const [resetKey, setResetKey] = useState(0);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{ru.bots.environmentSection}</h3>
      <EnvironmentEditor
        key={resetKey}
        value={props.bot.environment}
        saving={save.isPending}
        error={error}
        onSave={(input) => {
          setError(null);
          save.mutate(input, {
            onSuccess: () => {
              setResetKey((key) => key + 1);
              toast.success(ru.bots.environmentSaved);
            },
            onError: (e) =>
              setError(environmentErrorMessage(e)),
          });
        }}
      />
    </section>
  );
}

function PublishSection(props: { projectId: string; bot: BotView }) {
  const publish = usePublishBot(props.projectId, props.bot.id);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  const onPublish = () => {
    setErrors([]);
    setFailure(null);
    publish.mutate(undefined, {
      onSuccess: (result) => toast.success(ru.bots.published(result.warnings.length)),
      onError: (error) => {
        if (error instanceof ApiError && error.status === 422) {
          const body = error.body as { errors?: ValidationError[] } | undefined;
          setErrors(body?.errors ?? []);
          if (!body?.errors?.length) setFailure(error.message);
        } else if (error instanceof ApiError && error.status === 502) {
          setFailure(ru.bots.publishUnavailable);
        } else {
          setFailure(ru.common.unknownError);
        }
      },
    });
  };

  const hasConnection = props.bot.connections.length > 0;

  return (
    <section className="flex flex-col gap-2">
      <div>
        <Button type="button" onClick={onPublish} disabled={publish.isPending || !hasConnection}>
          {publish.isPending
            ? ru.bots.publishing
            : props.bot.status === 'PUBLISHED'
              ? ru.bots.republish
              : ru.bots.publish}
        </Button>
      </div>
      {!hasConnection ? (
        <p className="text-xs text-muted-foreground">{ru.bots.publishNeedsConnection}</p>
      ) : null}
      {errors.length > 0 ? (
        <div role="alert" className="rounded-md border border-destructive/50 p-3 text-sm">
          <p className="font-medium text-destructive">{ru.bots.publishErrorsTitle}</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((item, index) => (
              <li key={`${item.rule}-${item.blockId ?? ''}-${index}`}>{item.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {failure ? <p className="text-sm text-destructive">{failure}</p> : null}
    </section>
  );
}

function BotCard(props: { projectId: string; bot: BotView; onDelete: () => void }) {
  const { bot } = props;
  const telegramConnection = bot.connections.find((c) => c.messenger === 'TELEGRAM');
  const vkConnection = bot.connections.find((c) => c.messenger === 'VK');
  const isPublished = bot.status === 'PUBLISHED';
  const metaParts = [
    bot.publishedAt
      ? `${ru.bots.publishedAt}: ${new Date(bot.publishedAt).toLocaleString('ru-RU')}`
      : null,
    telegramConnection ? `${ru.bots.connectedAs}: ${telegramConnection.tokenMask}` : null,
    vkConnection ? `${ru.bots.vkConnectedAs}: ${vkConnection.tokenMask}` : null,
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="break-words">{bot.name}</CardTitle>
            {isPublished ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <span className="relative flex size-2" aria-hidden="true">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                {ru.bots.statusPublished}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <span
                  className="inline-flex size-2 rounded-full bg-muted-foreground/50"
                  aria-hidden="true"
                />
                {ru.bots.statusCreated}
              </span>
            )}
          </div>
          {metaParts.length > 0 ? (
            <CardDescription className="break-words">{metaParts.join(' · ')}</CardDescription>
          ) : null}
        </div>
        <Button type="button" variant="outline" size="sm" className="self-start shrink-0" onClick={props.onDelete}>
          <Trash2 />
          {ru.bots.delete}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <TelegramSection projectId={props.projectId} bot={bot} />
        <VkSection projectId={props.projectId} bot={bot} />
        <EnvironmentSection projectId={props.projectId} bot={bot} />
        <PublishSection projectId={props.projectId} bot={bot} />
      </CardContent>
    </Card>
  );
}

export function BotsPage() {
  const { id = '' } = useParams();
  const { data: bots, isLoading, isError } = useBots(id);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<BotView | null>(null);

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-5 px-4 py-4 sm:gap-6 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <Link
            to="/projects"
            aria-label={ru.projects.title}
            className="inline-flex items-center rounded-md p-1 transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <BrandLogo size={22} />
          </Link>
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          <Link
            to={`/projects/${id}`}
            className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {ru.bots.back}
          </Link>
          <h1 className="text-lg font-semibold sm:text-xl">{ru.bots.title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <Button size="sm" className="sm:h-9 sm:px-4" onClick={() => setCreateOpen(true)}>
            <Plus />
            {ru.bots.create}
          </Button>
        </div>
      </header>

      {isLoading ? <p className="text-muted-foreground">{ru.common.loading}</p> : null}
      {isError ? <p className="text-destructive">{ru.bots.loadError}</p> : null}
      {bots && bots.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground sm:p-12">
          {ru.bots.empty}
        </div>
      ) : null}
      {bots?.map((bot) => (
        <BotCard key={bot.id} projectId={id} bot={bot} onDelete={() => setDeleting(bot)} />
      ))}

      <CreateBotDialog projectId={id} open={createOpen} onOpenChange={setCreateOpen} />
      {deleting ? (
        <DeleteBotDialog projectId={id} bot={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </div>
  );
}
