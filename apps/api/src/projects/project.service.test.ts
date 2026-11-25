import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { EnvironmentService } from '../common/environment.service';
import type { MessengerAdminPort } from '../common/messenger-admin.port';
import type { PrismaService } from '../prisma/prisma.module';
import type { SecretVault } from '@chatbot/vault';
import { ProjectService } from './project.service';

describe('ProjectService (unit)', () => {
  const createService = (projectMocks: {
    findMany?: ReturnType<typeof vi.fn>;
    findFirst?: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
  }) => {
    const prisma = {
      client: {
        project: {
          findMany: projectMocks.findMany ?? vi.fn(),
          findFirst: projectMocks.findFirst ?? vi.fn(),
          update: projectMocks.update ?? vi.fn(),
        },
      },
    } as unknown as PrismaService;

    return new ProjectService(
      prisma,
      {} as EnvironmentService,
      {} as SecretVault,
      {} as MessengerAdminPort,
    );
  };

  it('listByAuthor вычисляет blocksCount, publishedBotsCount и отсортированные уникальные messengers одним запросом', async () => {
    const now = new Date('2026-11-22T16:00:00.000Z');
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'proj-1',
        name: 'Клиника',
        updatedAt: now,
        scenario: { blocks: [{ id: 'entry' }, { id: 'msg1' }, { id: 'exit' }] },
        bots: [
          {
            status: 'PUBLISHED',
            connections: [{ messenger: 'VK' }, { messenger: 'TELEGRAM' }],
          },
          {
            status: 'PUBLISHED',
            connections: [{ messenger: 'TELEGRAM' }],
          },
          {
            status: 'CREATED',
            connections: [],
          },
        ],
      },
      {
        id: 'proj-2',
        name: 'Пустой сценарий',
        updatedAt: now,
        scenario: null,
        bots: [
          {
            status: 'CREATED',
            connections: [{ messenger: 'VK' }],
          },
        ],
      },
    ]);

    const service = createService({ findMany });
    const result = await service.listByAuthor('author-1');

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { authorId: 'author-1' },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        scenario: true,
        bots: {
          select: {
            status: true,
            connections: { select: { messenger: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    expect(result).toEqual([
      {
        id: 'proj-1',
        name: 'Клиника',
        updatedAt: now,
        botsCount: 3,
        blocksCount: 3,
        publishedBotsCount: 2,
        messengers: ['TELEGRAM', 'VK'],
      },
      {
        id: 'proj-2',
        name: 'Пустой сценарий',
        updatedAt: now,
        botsCount: 1,
        blocksCount: 0,
        publishedBotsCount: 0,
        messengers: ['VK'],
      },
    ]);
  });

  it('rename возвращает обновлённый ProjectSummary с метриками карточки', async () => {
    const now = new Date('2026-11-22T16:05:00.000Z');
    const findFirst = vi.fn().mockResolvedValue({ id: 'proj-1' });
    const update = vi.fn().mockResolvedValue({
      id: 'proj-1',
      name: 'Новое имя',
      updatedAt: now,
      scenario: { blocks: [{ id: 'entry' }, { id: 'msg1' }] },
      bots: [
        {
          status: 'PUBLISHED',
          connections: [{ messenger: 'TELEGRAM' }],
        },
      ],
    });

    const service = createService({ findFirst, update });
    const result = await service.rename('author-1', 'proj-1', 'Новое имя');

    expect(result).toEqual({
      id: 'proj-1',
      name: 'Новое имя',
      updatedAt: now,
      botsCount: 1,
      blocksCount: 2,
      publishedBotsCount: 1,
      messengers: ['TELEGRAM'],
    });
  });
});
