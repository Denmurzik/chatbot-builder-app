import { emptyScenario, type Scenario } from '@chatbot/model';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectService } from '../projects/project.service';
import type { ScenarioEditor } from '../projects/scenario-editor';
import { buildExportFileName, ImportExportService } from './import-export.service';

function createService() {
  const projectService = {
    getById: vi.fn(),
  } as unknown as ProjectService;
  const scenarioEditor = {
    saveScenario: vi.fn(),
  } as unknown as ScenarioEditor;
  return {
    service: new ImportExportService(projectService, scenarioEditor),
    projectService,
    scenarioEditor,
  };
}

function makeScenarioWithHttp(
  headers: Array<{
    name: string;
    value: string;
    secret: boolean;
    secretValue?: { cipherText: string; mask: string };
    secretMask?: string;
  }>,
): Scenario {
  return {
    formatVersion: 1,
    blocks: [
      { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
      {
        id: 'req',
        type: 'HTTP_REQUEST',
        title: 'Запрос',
        x: 200,
        y: 0,
        method: 'GET',
        url: 'https://api.example.com/slots',
        headers,
        body: '',
        variableName: 'resp',
        errorVariable: 'err',
        timeoutSec: 10,
        retryCount: 0,
        retryIntervalSec: 0,
        errorStrategy: 'EXIT_ERROR',
        suspendText: null,
        responseMappings: [],
      },
    ],
    transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'req' }],
  };
}

describe('ImportExportService (unit)', () => {
  describe('buildExportFileName', () => {
    it('сохраняет кириллицу и удаляет запрещённые символы пути', () => {
      expect(buildExportFileName('Запись к врачу')).toBe('Запись к врачу.json');
      expect(buildExportFileName('Бот: тест / 1\\2*?<>|')).toBe('Бот тест 1 2.json');
      expect(buildExportFileName('   ...   ')).toBe('scenario.json');
      expect(buildExportFileName('Запись к врачу', 'yaml')).toBe('Запись к врачу.yaml');
      expect(buildExportFileName('bot.yml', 'yaml')).toBe('bot.yaml');
      expect(buildExportFileName('bot.yaml', 'json')).toBe('bot.json');
    });
  });

  describe('serialize', () => {
    it('удаляет значения и шифротексты секретных заголовков, сохраняя secret: true', () => {
      const { service } = createService();
      const scenario = makeScenarioWithHttp([
        { name: 'Accept', value: 'application/json', secret: false },
        {
          name: 'Authorization',
          value: 'Bearer plain-leak',
          secret: true,
          secretValue: { cipherText: 'v1:aaa:bbb:ccc', mask: '••••leak' },
        },
        {
          name: 'X-Api-Key',
          value: '',
          secret: true,
          secretValue: { cipherText: 'v1:ddd:eee:fff', mask: '••••9999' },
          secretMask: '••••9999',
        },
      ]);

      const rawJson = service.serialize(scenario);
      expect(rawJson).not.toContain('plain-leak');
      expect(rawJson).not.toContain('v1:aaa:bbb:ccc');
      expect(rawJson).not.toContain('v1:ddd:eee:fff');
      expect(rawJson).not.toContain('secretValue');
      expect(rawJson).not.toContain('secretMask');

      const parsed = JSON.parse(rawJson) as Scenario;
      const reqBlock = parsed.blocks.find((b) => b.id === 'req');
      expect(reqBlock?.type).toBe('HTTP_REQUEST');
      if (reqBlock?.type === 'HTTP_REQUEST') {
        expect(reqBlock.headers).toEqual([
          { name: 'Accept', value: 'application/json', secret: false },
          { name: 'Authorization', value: '', secret: true },
          { name: 'X-Api-Key', value: '', secret: true },
        ]);
      }
    });
  });

  describe('checkStructure', () => {
    it('возвращает пустой массив для валидного сценария', () => {
      const { service } = createService();
      expect(service.checkStructure(emptyScenario())).toEqual([]);
    });

    it('сохраняет русское сообщение из схемы Zod (empty options → «Список вариантов не может быть пустым»)', () => {
      const { service } = createService();
      const issues = service.checkStructure({
        formatVersion: 1,
        blocks: [
          { id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 },
          {
            id: 'choice',
            type: 'OPTION_CHOICE',
            title: 'Выбор',
            x: 200,
            y: 0,
            question: 'Выберите',
            options: [],
            variableName: 'ans',
          },
        ],
        transitions: [],
      });
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Список вариантов не может быть пустым',
          }),
        ]),
      );
    });

    it('возвращает ошибки на русском для неподдерживаемой formatVersion и битых переходов', () => {
      const { service } = createService();
      const badVersionIssues = service.checkStructure({
        ...emptyScenario(),
        formatVersion: 2,
      });
      expect(badVersionIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'formatVersion',
            message: expect.stringMatching(/[А-Яа-яЁё]/),
          }),
        ]),
      );

      const badTargetIssues = service.checkStructure({
        formatVersion: 1,
        blocks: [{ id: 'entry', type: 'ENTRY_POINT', title: 'Старт', x: 0, y: 0 }],
        transitions: [{ source: { blockId: 'entry', output: 'default' }, target: 'missing' }],
      });
      expect(badTargetIssues).toEqual([
        {
          path: 'transitions.0.target',
          message: expect.stringContaining('missing'),
        },
      ]);
    });
  });

  describe('deserialize', () => {
    it('отбрасывает чужой secretValue у секретных заголовков', () => {
      const { service } = createService();
      const scenario = makeScenarioWithHttp([
        { name: 'Accept', value: 'application/json', secret: false },
        {
          name: 'Authorization',
          value: '',
          secret: true,
          secretValue: { cipherText: 'v1:foreign:tag:ct', mask: '••••1234' },
        },
        {
          name: 'X-Token',
          value: 'new-value',
          secret: true,
          secretValue: { cipherText: 'v1:old:tag:ct', mask: '••••0000' },
        },
      ]);

      const result = service.deserialize(scenario);
      const reqBlock = result.blocks.find((b) => b.id === 'req');
      expect(reqBlock?.type).toBe('HTTP_REQUEST');
      if (reqBlock?.type === 'HTTP_REQUEST') {
        expect(reqBlock.headers).toEqual([
          { name: 'Accept', value: 'application/json', secret: false },
          { name: 'Authorization', value: '', secret: true },
          { name: 'X-Token', value: 'new-value', secret: true },
        ]);
      }
    });

    it('бросает BadRequestException с message "Файл не подходит" и списком issues при ошибке', () => {
      const { service } = createService();
      try {
        service.deserialize({ formatVersion: 2, blocks: [], transitions: [] });
        expect.fail('Должно было бросить BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse();
        expect(response).toEqual({
          message: 'Файл не подходит',
          issues: expect.arrayContaining([
            expect.objectContaining({ path: 'formatVersion', message: expect.any(String) }),
          ]),
        });
      }
    });
  });

  describe('importScenario', () => {
    it('проверяет владение, отбрасывает secretValue, сохраняет через ScenarioEditor и считает secretsToFill', async () => {
      const { service, projectService, scenarioEditor } = createService();
      const updatedAt = new Date('2026-11-20T12:00:00.000Z');
      vi.mocked(projectService.getById).mockResolvedValue({
        id: 'proj-1',
        name: 'Тест',
        scenario: emptyScenario(),
        environment: [],
        updatedAt,
      });
      vi.mocked(scenarioEditor.saveScenario).mockResolvedValue({ updatedAt });

      const input = makeScenarioWithHttp([
        { name: 'Accept', value: 'application/json', secret: false },
        {
          name: 'Authorization',
          value: '',
          secret: true,
          secretValue: { cipherText: 'v1:foreign:tag:ct', mask: '••••1234' },
        },
        { name: 'X-Api-Key', value: '', secret: true },
        { name: 'X-Plain-Secret', value: 'secret-now', secret: true },
      ]);

      const result = await service.importScenario('author-1', 'proj-1', input);

      expect(projectService.getById).toHaveBeenCalledWith('author-1', 'proj-1');
      expect(scenarioEditor.saveScenario).toHaveBeenCalledWith(
        'author-1',
        'proj-1',
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              id: 'req',
              headers: [
                { name: 'Accept', value: 'application/json', secret: false },
                { name: 'Authorization', value: '', secret: true },
                { name: 'X-Api-Key', value: '', secret: true },
                { name: 'X-Plain-Secret', value: 'secret-now', secret: true },
              ],
            }),
          ]),
        }),
      );
      expect(result).toEqual({ updatedAt, secretsToFill: 2 });
    });

    it('сериализует сценарий в YAML без секретов и импортирует YAML-строку обратно', async () => {
      const { service, projectService, scenarioEditor } = createService();
      const updatedAt = new Date('2026-11-20T12:00:00.000Z');
      vi.mocked(projectService.getById).mockResolvedValue({
        id: 'proj-1',
        name: 'Тест',
        scenario: emptyScenario(),
        environment: [],
        updatedAt,
      });
      vi.mocked(scenarioEditor.saveScenario).mockResolvedValue({ updatedAt });

      const scenario = makeScenarioWithHttp([
        { name: 'Accept', value: 'application/json', secret: false },
        {
          name: 'Authorization',
          value: 'Bearer plain-secret',
          secret: true,
          secretValue: { cipherText: 'v1:aaa:bbb:ccc', mask: '••••cret' },
          secretMask: '••••cret',
        },
      ]);

      const yamlText = service.serialize(scenario, 'yaml');
      expect(yamlText).not.toContain('plain-secret');
      expect(yamlText).not.toContain('secretValue');
      expect(yamlText).not.toContain('secretMask');

      const result = await service.importScenario('author-1', 'proj-1', yamlText);
      expect(result).toEqual({ updatedAt, secretsToFill: 1 });
      expect(scenarioEditor.saveScenario).toHaveBeenCalledWith(
        'author-1',
        'proj-1',
        expect.objectContaining({
          formatVersion: 1,
          blocks: expect.arrayContaining([
            expect.objectContaining({
              id: 'req',
              headers: [
                { name: 'Accept', value: 'application/json', secret: false },
                { name: 'Authorization', value: '', secret: true },
              ],
            }),
          ]),
        }),
      );
    });

    it('при невалидном YAML или не-объекте бросает BadRequestException 400 с issues', async () => {
      const { service, projectService } = createService();
      vi.mocked(projectService.getById).mockResolvedValue({
        id: 'proj-1',
        name: 'Тест',
        scenario: emptyScenario(),
        environment: [],
        updatedAt: new Date(),
      });

      await expect(
        service.importScenario('author-1', 'proj-1', 'blocks: [unclosed'),
      ).rejects.toMatchObject({
        response: {
          message: 'Файл не подходит',
          issues: [expect.objectContaining({ path: '', message: expect.stringContaining('Некорректный YAML') })],
        },
      });

      await expect(
        service.importScenario('author-1', 'proj-1', '- item1\n- item2\n'),
      ).rejects.toMatchObject({
        response: {
          message: 'Файл не подходит',
          issues: [expect.objectContaining({ path: '', message: expect.stringContaining('Некорректный YAML') })],
        },
      });
    });
  });
});
