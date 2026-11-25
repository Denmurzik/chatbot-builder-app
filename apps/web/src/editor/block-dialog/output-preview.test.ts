import { describe, expect, it } from 'vitest';
import { BLOCK_META } from '../block-meta';
import { previewBlock } from './output-preview';

describe('previewBlock (HTTP_REQUEST)', () => {
  it('использует secretMask для секретного заголовка без secretValue', () => {
    const base = BLOCK_META.HTTP_REQUEST.defaults();
    if (base.type !== 'HTTP_REQUEST') throw new Error('ожидался HTTP_REQUEST');

    const preview = previewBlock(
      {
        ...base,
        headers: [
          { name: 'X-Api-Key', value: '', secret: true, secretMask: '••••1234' },
          {
            name: 'Authorization',
            value: '',
            secret: true,
            secretValue: { cipherText: 'v1:iv:tag:ct', mask: '••••abcd' },
          },
        ],
      },
      {},
    );

    const headersRow = preview.rows.find((row) => row.value.includes('X-Api-Key'));
    expect(headersRow?.value).toBe('X-Api-Key: ••••1234\nAuthorization: ••••abcd');
  });
});
