/**
 * Reading §13.4's alias table values.
 *
 * The hub publishes `provider/model` — the form §13.4 prints in its own
 * example — because `/v1/chat` needs the provider half to pick a translator
 * (Gemini's native API, DeepSeek's OpenAI-compatible one, whatever comes
 * next). Nothing in the app does: the only path that still names a model
 * talks to Google directly and wants a bare Gemini model name.
 *
 * Its own file, rather than a helper inside `modelConfig`, so it can be tested
 * without loading MMKV — which is a native module and cannot be imported in
 * the `node` test project at all.
 */

/**
 * Both forms are accepted, deliberately.
 *
 * The table is edited in a dashboard by a person, and an installed build
 * cannot be updated to match a value typed after it shipped. Publishing
 * `gemini/gemini-3.6-flash-lite` to a build that took the value literally is
 * exactly how receipt parsing broke for the length of one smoke test.
 */
export function bareModel(value: string): string {
  const slash = value.indexOf('/');
  return slash === -1 ? value : value.slice(slash + 1);
}
