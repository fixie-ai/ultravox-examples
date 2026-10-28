import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { supportScenario } from '../agent';
import { PROMPTS_FILE, renderPrompts } from './prompts';

describe('docs/prompts.md', () => {
  it('matches the prompts the code sends (run `pnpm prompts` after changing a prompt)', () => {
    expect(fs.readFileSync(PROMPTS_FILE, 'utf8')).toBe(renderPrompts(supportScenario));
  });
});
