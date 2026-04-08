import { describe, expect, it } from 'vitest';

import { classNames } from './classNames';

describe('classNames', () => {
  it('merges and resolves conflicting Tailwind classes', () => {
    expect(classNames('p-2', 'p-4', 'text-sm', undefined)).toBe('p-4 text-sm');
  });
});
