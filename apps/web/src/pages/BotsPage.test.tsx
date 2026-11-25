import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BotView } from '@chatbot/model';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ru } from '@/i18n/ru';
import { BotsPage } from './BotsPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const bot: BotView = {
  id: 'b1',
  name: 'Мой бот',
  status: 'CREATED',
  publishedAt: null,
  connections: [],
  environment: [],
};

const botWithTelegram: BotView = {
  ...bot,
  connections: [{ messenger: 'TELEGRAM', tokenMask: '12••••cd' }],
};

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Мок fetch: GET списка ботов отдаёт bot, остальные запросы — по таблице ответов
function stubApi(routes: Record<string, Response | (() => Response)>, list: BotView[] = [bot]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') return json(200, list);
    const key = `${method} ${url}`;
    const response = routes[key];
    if (!response) throw new Error(`нет мока для ${key}`);
    return typeof response === 'function' ? response() : response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/projects/p1/bots']}>
        <Routes>
          <Route path="/projects/:id/bots" element={<BotsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BotsPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('409 токена показывается под полем', async () => {
    stubApi({
      'PUT /api/projects/p1/bots/b1/connections/telegram': json(409, {
        message: ru.bots.tokenTaken,
      }),
    });
    const user = userEvent.setup();
    renderPage();
    const field = await screen.findByLabelText(ru.bots.tokenLabel);
    expect(field.getAttribute('type')).toBe('password');
    await user.type(field, '123:abc');
    await user.click(screen.getByRole('button', { name: ru.bots.tokenConnect }));
    expect(await screen.findByText(ru.bots.tokenTaken)).toBeTruthy();
  });

  it('422 публикации показывает список ошибок', async () => {
    stubApi(
      {
        'POST /api/projects/p1/bots/b1/publish': json(422, {
          message: 'Unprocessable Entity',
          errors: [{ rule: 'R1', message: 'Нет стартового блока', severity: 'ERROR' }],
        }),
      },
      [botWithTelegram],
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: ru.bots.publish }));
    expect(await screen.findByText('Нет стартового блока')).toBeTruthy();
  });

  it('опубликованный бот получает кнопку «Опубликовать заново»', async () => {
    stubApi({}, [
      { ...botWithTelegram, status: 'PUBLISHED', publishedAt: '2026-11-20T10:00:00.000Z' },
    ]);
    renderPage();
    expect(await screen.findByRole('button', { name: ru.bots.republish })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ru.bots.publish })).toBeNull();
  });

  it('502 публикации показывает, что Telegram недоступен', async () => {
    stubApi(
      { 'POST /api/projects/p1/bots/b1/publish': json(502, { message: 'Bad Gateway' }) },
      [botWithTelegram],
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: ru.bots.publish }));
    expect(await screen.findByText(ru.bots.publishUnavailable)).toBeTruthy();
  });

  it('успешная публикация показывает тост с числом предупреждений', async () => {
    stubApi(
      {
        'POST /api/projects/p1/bots/b1/publish': json(200, {
          bot: botWithTelegram,
          warnings: [{ rule: 'W1', message: 'Блок недостижим', severity: 'WARNING' }],
        }),
      },
      [botWithTelegram],
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: ru.bots.publish }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(ru.bots.published(1)));
  });

  it('после подключения токена поле очищается и показывается маска', async () => {
    const list: BotView[] = [bot];
    stubApi(
      {
        'PUT /api/projects/p1/bots/b1/connections/telegram': () => {
          list[0] = { ...bot, connections: [{ messenger: 'TELEGRAM', tokenMask: '12••••cd' }] };
          return json(200, { messenger: 'TELEGRAM', tokenMask: '12••••cd', botUsername: 'x_bot' });
        },
      },
      list,
    );
    const user = userEvent.setup();
    renderPage();
    const field = (await screen.findByLabelText(ru.bots.tokenLabel)) as HTMLInputElement;
    await user.type(field, '123:abc');
    await user.click(screen.getByRole('button', { name: ru.bots.tokenConnect }));
    expect((await screen.findAllByText(/12••••cd/)).length).toBeGreaterThan(0);
    expect(field.value).toBe('');
  });

  it('400 при сохранении окружения показывает сообщение сервера, а без него — общую подсказку', async () => {
    const withEnv: BotView = {
      ...bot,
      environment: [{ name: 'A', secret: false, value: '1' }],
    };
    const route = 'PUT /api/projects/p1/bots/b1/environment';
    const user = userEvent.setup();
    stubApi(
      { [route]: json(400, { message: 'Введите значение секретной переменной A' }) },
      [withEnv],
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: ru.environment.save }));
    expect(await screen.findByText('Введите значение секретной переменной A')).toBeTruthy();

    cleanup();
    stubApi({ [route]: json(400, ['что-то']) }, [withEnv]);
    renderPage();
    await user.click(await screen.findByRole('button', { name: ru.environment.save }));
    expect(await screen.findByText(ru.bots.environmentInvalid)).toBeTruthy();
  });

  it('создание бота отправляет название', async () => {
    const fetchMock = stubApi({ 'POST /api/projects/p1/bots': json(201, bot) });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: ru.bots.create }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(ru.bots.nameLabel), 'Новый');
    await user.click(within(dialog).getByRole('button', { name: ru.common.create }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(call?.[1]?.body).toBe(JSON.stringify({ name: 'Новый' }));
    });
  });

  it('удаление бота требует подтверждения в диалоге', async () => {
    const fetchMock = stubApi({ 'DELETE /api/projects/p1/bots/b1': json(204) });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: ru.bots.delete }));
    const dialog = await screen.findByRole('dialog');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: ru.bots.delete }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true),
    );
  });

  it('кнопка публикации отключена, если не подключён ни один мессенджер', async () => {
    stubApi({}, [bot]);
    renderPage();
    const publishBtn = await screen.findByRole('button', { name: ru.bots.publish });
    expect((publishBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(ru.bots.publishNeedsConnection)).toBeTruthy();
  });

  it('подключение VK в режиме CALLBACK валидирует строку подтверждения, отправляет PUT и показывает Callback URL', async () => {
    const list: BotView[] = [bot];
    const fetchMock = stubApi(
      {
        'PUT /api/projects/p1/bots/b1/connections/vk': () => {
          list[0] = {
            ...bot,
            connections: [
              {
                messenger: 'VK',
                tokenMask: 'vk••••99',
                vkGroupId: 123456,
                vkMode: 'CALLBACK',
                vkHasSecret: true,
                vkConfirmationCode: 'confirm123',
              },
            ],
          };
          return json(200, {
            messenger: 'VK',
            tokenMask: 'vk••••99',
            vkGroupId: 123456,
            vkMode: 'CALLBACK',
            vkHasSecret: true,
            vkConfirmationCode: 'confirm123',
            groupName: 'Test Group',
          });
        },
      },
      list,
    );
    const user = userEvent.setup();
    renderPage();

    const vkToken = await screen.findByLabelText(ru.bots.vkTokenLabel);
    expect(vkToken.getAttribute('type')).toBe('password');
    await user.type(vkToken, 'vk1.a.secret_token');
    await user.type(screen.getByLabelText(ru.bots.vkGroupIdLabel), '123456');

    // Без строки подтверждения клиентская валидация блокирует отправку
    await user.click(screen.getByRole('button', { name: ru.bots.vkConnect }));
    expect(await screen.findByText(ru.bots.vkConfirmationRequired)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);

    await user.type(screen.getByLabelText(ru.bots.vkConfirmationLabel), 'confirm123');
    const secretField = screen.getByLabelText(ru.bots.vkSecretLabel);
    expect(secretField.getAttribute('type')).toBe('password');
    await user.type(secretField, 'my-secret');
    await user.click(screen.getByRole('button', { name: ru.bots.vkConnect }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          init?.method === 'PUT' && url === '/api/projects/p1/bots/b1/connections/vk',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        token: 'vk1.a.secret_token',
        groupId: 123456,
        mode: 'CALLBACK',
        confirmationCode: 'confirm123',
        secret: 'my-secret',
      });
    });

    const expectedUrl = `${window.location.origin}/webhook/vk/b1`;
    expect(await screen.findByText(expectedUrl)).toBeTruthy();
    expect(screen.getByText(/#123456/)).toBeTruthy();
    expect(screen.getByText(ru.bots.vkSecretSet)).toBeTruthy();
  });

  it('подключение VK в режиме LONG_POLL не требует строку подтверждения и не показывает Callback URL', async () => {
    const list: BotView[] = [bot];
    const fetchMock = stubApi(
      {
        'PUT /api/projects/p1/bots/b1/connections/vk': () => {
          list[0] = {
            ...bot,
            connections: [
              {
                messenger: 'VK',
                tokenMask: 'vk••••lp',
                vkGroupId: 654321,
                vkMode: 'LONG_POLL',
                vkHasSecret: false,
              },
            ],
          };
          return json(200, {
            messenger: 'VK',
            tokenMask: 'vk••••lp',
            vkGroupId: 654321,
            vkMode: 'LONG_POLL',
            vkHasSecret: false,
            groupName: 'LP Group',
          });
        },
      },
      list,
    );
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText(ru.bots.vkTokenLabel), 'vk1.a.lp_token');
    await user.type(screen.getByLabelText(ru.bots.vkGroupIdLabel), '654321');
    await user.click(screen.getByLabelText(ru.bots.vkModeLongPoll));
    expect(screen.queryByLabelText(ru.bots.vkConfirmationLabel)).toBeNull();

    await user.click(screen.getByRole('button', { name: ru.bots.vkConnect }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          init?.method === 'PUT' && url === '/api/projects/p1/bots/b1/connections/vk',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        token: 'vk1.a.lp_token',
        groupId: 654321,
        mode: 'LONG_POLL',
      });
    });

    expect((await screen.findAllByText(/vk••••lp/)).length).toBeGreaterThan(0);
    expect(screen.getByText(ru.bots.vkModeLongPoll)).toBeTruthy();
    expect(screen.queryByText(`${window.location.origin}/webhook/vk/b1`)).toBeNull();
  });

  it('отключение VK отправляет DELETE /connections/vk и обновляет состояние', async () => {
    const list: BotView[] = [
      {
        ...bot,
        connections: [
          {
            messenger: 'VK',
            tokenMask: 'vk••••77',
            vkGroupId: 777,
            vkMode: 'CALLBACK',
            vkHasSecret: false,
            vkConfirmationCode: 'abc',
          },
        ],
      },
    ];
    const fetchMock = stubApi(
      {
        'DELETE /api/projects/p1/bots/b1/connections/vk': () => {
          list[0] = { ...bot, connections: [] };
          return json(204);
        },
      },
      list,
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: ru.bots.vkDisconnect }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            init?.method === 'DELETE' && url === '/api/projects/p1/bots/b1/connections/vk',
        ),
      ).toBe(true),
    );
    expect(await screen.findByText(ru.bots.vkNotConnected)).toBeTruthy();
  });

  it('бот с подключённым только VK может быть опубликован', async () => {
    const vkOnlyBot: BotView = {
      ...bot,
      connections: [
        {
          messenger: 'VK',
          tokenMask: 'vk••••88',
          vkGroupId: 888,
          vkMode: 'LONG_POLL',
          vkHasSecret: false,
        },
      ],
    };
    const fetchMock = stubApi(
      {
        'POST /api/projects/p1/bots/b1/publish': json(200, {
          bot: { ...vkOnlyBot, status: 'PUBLISHED', publishedAt: '2026-11-22T12:00:00.000Z' },
          warnings: [],
        }),
      },
      [vkOnlyBot],
    );
    const user = userEvent.setup();
    renderPage();

    // Telegram-секция не должна ошибочно показывать VK-подключение
    expect(await screen.findByText(ru.bots.notConnected)).toBeTruthy();

    const publishBtn = screen.getByRole('button', { name: ru.bots.publish });
    expect((publishBtn as HTMLButtonElement).disabled).toBe(false);
    await user.click(publishBtn);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => init?.method === 'POST' && url === '/api/projects/p1/bots/b1/publish',
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(ru.bots.published(0)));
  });

  it('отображает логотип со ссылкой на /projects, переключатель темы, статус публикации и a11y-атрибуты полей', async () => {
    stubApi({}, [
      { ...botWithTelegram, status: 'PUBLISHED', publishedAt: '2026-11-20T10:00:00.000Z' },
    ]);
    renderPage();

    expect(await screen.findByText(ru.bots.statusPublished)).toBeTruthy();
    const logoLink = screen.getByRole('link', { name: ru.projects.title });
    expect(logoLink.getAttribute('href')).toBe('/projects');
    expect(
      screen.getByRole('button', {
        name: new RegExp(`${ru.theme.switchToLight}|${ru.theme.switchToDark}`),
      }),
    ).toBeTruthy();

    const tgTokenInput = screen.getByLabelText(ru.bots.tokenLabel);
    expect(tgTokenInput.getAttribute('id')).toBe('tg-token-b1');
    expect(tgTokenInput.getAttribute('name')).toBe('token');
    expect(tgTokenInput.getAttribute('autocomplete')).toBe('off');

    const vkTokenInput = screen.getByLabelText(ru.bots.vkTokenLabel);
    expect(vkTokenInput.getAttribute('id')).toBe('vk-token-b1');
    expect(vkTokenInput.getAttribute('name')).toBe('token');
    expect(vkTokenInput.getAttribute('autocomplete')).toBe('off');
  });
});
