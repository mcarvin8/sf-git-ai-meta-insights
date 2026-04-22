import { describe, it, expect } from 'vitest';

import pluginIndex from '../../../../src/index.js';

describe('sgai metadata summary plugin', () => {
  it('exports the CLI plugin index', () => {
    expect(pluginIndex).toEqual({});
  });
});
