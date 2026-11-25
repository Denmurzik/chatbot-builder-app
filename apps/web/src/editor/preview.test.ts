import { describe, expect, it } from 'vitest';
import { BLOCK_META } from './block-meta';
import { blockPreview } from './preview';

describe('blockPreview', () => {
  it('пусто для новых блоков и служебных типов', () => {
    expect(blockPreview(BLOCK_META.TEXT_MESSAGE.defaults())).toBe('');
    expect(blockPreview(BLOCK_META.ENTRY_POINT.defaults())).toBe('');
    expect(blockPreview(BLOCK_META.HTTP_REQUEST.defaults())).toBe('');
  });

  it('показывает основное содержимое по типу блока', () => {
    expect(blockPreview({ ...BLOCK_META.TEXT_MESSAGE.defaults(), text: 'Привет' } as never)).toBe(
      'Привет',
    );
    expect(blockPreview({ ...BLOCK_META.TEXT_INPUT.defaults(), question: 'Имя?' } as never)).toBe(
      'Имя?',
    );
    expect(
      blockPreview({ ...BLOCK_META.OPTION_CHOICE.defaults(), question: 'Врач?' } as never),
    ).toBe('Врач?');
    expect(blockPreview({ ...BLOCK_META.LIST_CHOICE.defaults(), question: 'Слот?' } as never)).toBe(
      'Слот?',
    );
    expect(
      blockPreview({
        ...BLOCK_META.ASSIGNMENT.defaults(),
        variableName: 'a',
        expression: '1+2',
      } as never),
    ).toBe('a = 1+2');
    expect(blockPreview({ ...BLOCK_META.CONDITION.defaults(), expression: 'x > 1' } as never)).toBe(
      'x > 1',
    );
    expect(blockPreview({ ...BLOCK_META.SWITCH.defaults(), variableName: 'doctor' } as never)).toBe(
      'doctor',
    );
    expect(
      blockPreview({
        ...BLOCK_META.HTTP_REQUEST.defaults(),
        method: 'POST',
        url: 'https://a.b',
      } as never),
    ).toBe('POST https://a.b');
  });
});
