/**
 * §13.4 publishes `provider/model`; the app's direct-to-Google path wants the
 * model. Small, and it broke receipt parsing once.
 */

import { bareModel } from '@/agent/aliasValue';

describe('bareModel', () => {
  it('drops the provider the hub uses to pick a translator', () => {
    expect(bareModel('gemini/gemini-3.6-flash-lite')).toBe('gemini-3.6-flash-lite');
    expect(bareModel('deepseek/deepseek-chat')).toBe('deepseek-chat');
  });

  /** Variables written before there was a second provider are still out there. */
  it('leaves a bare model name alone', () => {
    expect(bareModel('gemini-3.6-flash')).toBe('gemini-3.6-flash');
  });

  /** Google's own names contain a slash, and only the first one is the provider. */
  it('keeps slashes inside the model name', () => {
    expect(bareModel('gemini/models/gemini-3.6-flash')).toBe('models/gemini-3.6-flash');
  });

  it('does not invent a name from nothing', () => {
    expect(bareModel('')).toBe('');
  });
});
