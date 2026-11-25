import { describe, expect, it } from 'vitest';
import { MapScope } from './scope';
import { checkTemplate, extractVariableNames, render, substitute } from './template';

describe('template', () => {
  describe('extractVariableNames', () => {
    it('извлекает имена переменных диалога и окружения в порядке появления без дублей', () => {
      expect(extractVariableNames('Привет, {{name}} и {{ env.API_URL }}')).toEqual([
        'name',
        'env.API_URL',
      ]);
    });

    it('убирает повторяющиеся имена, сохраняя порядок первого появления', () => {
      expect(extractVariableNames('{{a}} + {{b}} + {{ a }} + {{env.KEY}} + {{env.KEY}}')).toEqual([
        'a',
        'b',
        'env.KEY',
      ]);
    });

    it('возвращает пустой массив для строки без переменных', () => {
      expect(extractVariableNames('Обычный текст без подстановок')).toEqual([]);
    });

    it('игнорирует некорректные идентификаторы внутри фигурных скобок', () => {
      expect(extractVariableNames('{{123}} {{a-b}} {{valid_1}}')).toEqual(['valid_1']);
    });
  });

  describe('substitute', () => {
    it('в режиме TEXT подставляет значения как есть', () => {
      expect(substitute('Привет, {{name}}!', { name: 'Иван & "Петр"' }, 'TEXT')).toBe(
        'Привет, Иван & "Петр"!',
      );
    });

    it('в режиме URL кодирует спецсимволы через encodeURIComponent', () => {
      expect(substitute('https://api.example.com/search?q={{q}}', { q: 'a&b' }, 'URL')).toBe(
        'https://api.example.com/search?q=a%26b',
      );
    });

    it('в режиме HEADER удаляет переводы строк (защита от внедрения заголовков)', () => {
      expect(
        substitute('Bearer {{token}}', { token: 'abc\r\nX-Injected: 1\nnext' }, 'HEADER'),
      ).toBe('Bearer abcX-Injected: 1next');
    });

    it('в режиме JSON экранирует кавычки, обратный слеш и переводы строк', () => {
      expect(
        substitute('{"msg":"{{text}}"}', { text: 'a"b\\c\nd' }, 'JSON'),
      ).toBe('{"msg":"a\\"b\\\\c\\nd"}');
    });

    it('заменяет отсутствующую переменную на пустую строку', () => {
      expect(substitute('Привет, {{missing}}!', {}, 'TEXT')).toBe('Привет, !');
    });

    it('не раскрывает свойства Object.prototype как переменные', () => {
      expect(substitute('{{toString}}-{{constructor}}', {}, 'TEXT')).toBe('-');
    });

    it('выполняет подстановку в один проход: значение {{env.API_KEY}} выводится буквально', () => {
      const result = substitute(
        'Вы ввели: {{userInput}}',
        { userInput: '{{env.API_KEY}}', 'env.API_KEY': 'SUPER_SECRET' },
        'TEXT',
      );
      expect(result).toBe('Вы ввели: {{env.API_KEY}}');
    });
  });

  describe('render', () => {
    it('разделяет переменные диалога и окружения через VariableScope', () => {
      const scope = new MapScope({ name: 'Анна' }, { API_URL: 'https://clinic.local' });
      expect(render('{{env.API_URL}}/users/{{name}}', scope, 'TEXT')).toBe(
        'https://clinic.local/users/Анна',
      );
    });

    it('не раскрывает {{env.API_KEY}}, введённое пользователем в переменную диалога', () => {
      const scope = new MapScope(
        { userMessage: '{{env.API_KEY}}' },
        { API_KEY: 'secret-token-123' },
      );
      expect(render('Ответ: {{userMessage}}', scope, 'TEXT')).toBe('Ответ: {{env.API_KEY}}');
    });

    it('подставляет пустую строку для отсутствующих переменных диалога и окружения', () => {
      const scope = new MapScope({}, {});
      expect(render('[{{unknown}}|{{env.MISSING}}]', scope, 'TEXT')).toBe('[|]');
    });

    it('в режиме URL значения env.* подставляются без кодирования, переменные диалога кодируются', () => {
      const scope = new MapScope({ clinic: 'a&b' }, { API_URL: 'https://x.example/api' });
      expect(render('{{env.API_URL}}/slots?c={{clinic}}', scope, 'URL')).toBe(
        'https://x.example/api/slots?c=a%26b',
      );
    });

    it('в режиме URL одиночный суррогат не вызывает ошибку', () => {
      expect(substitute('?q={{q}}', { q: '\ud800x' }, 'URL')).toBe('?q=%EF%BF%BDx');
    });
  });

  describe('checkTemplate', () => {
    it('возвращает null для корректных шаблонов и JSON с переменными', () => {
      expect(checkTemplate('Обычный текст')).toBeNull();
      expect(checkTemplate('Привет, {{name}} и {{ env.API_URL }}!')).toBeNull();
      expect(checkTemplate('{"slotId":"{{slotId}}","patient":"{{fio}}"}')).toBeNull();
      expect(checkTemplate('{"nested":{"value":"{{x}}"}}')).toBeNull();
    });

    it('возвращает ошибку при незакрытой или лишней паре фигурных скобок', () => {
      expect(checkTemplate('Привет, {{name')).not.toBeNull();
      expect(checkTemplate('Привет, {{a {{b}}}}')).not.toBeNull();
      expect(checkTemplate('Привет, name}}')).not.toBeNull();
      expect(checkTemplate('{{a}}}}')).not.toBeNull();
    });

    it('возвращает ошибку при пустом или некорректном имени переменной', () => {
      expect(checkTemplate('Привет, {{}}')).not.toBeNull();
      expect(checkTemplate('Привет, {{   }}')).not.toBeNull();
      expect(checkTemplate('Привет, {{123}}')).not.toBeNull();
      expect(checkTemplate('Привет, {{a-b}}')).not.toBeNull();
      expect(checkTemplate('Привет, {{env.}}')).not.toBeNull();
      expect(checkTemplate('Привет, {{foo.bar}}')).not.toBeNull();
    });
  });
});
