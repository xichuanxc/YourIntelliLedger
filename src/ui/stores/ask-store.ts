/**
 * The Ask conversation — §6, Week 7's thin slice.
 *
 * A store rather than screen state so a conversation survives switching tabs
 * and coming back, which is the ordinary thing to do while reading an answer
 * against the ledger it came from.
 *
 * It owns the two lists that look alike and are not: `messages` is what the
 * user sees, and `history` is what the model is sent. They diverge on purpose
 * — the history carries assistant turns holding tool calls and the tool
 * results answering them (§6.1), none of which is anything to show a person,
 * and the messages carry a pending placeholder that must never reach a prompt.
 *
 * §15.3's row is written here rather than in the loop, so the loop stays
 * testable without a database beyond the one its tools read. Names and
 * statuses only: no question text and no amounts.
 */

import { create } from 'zustand';

import { catalogCache } from '@/agent/catalogCache';
import { getDataCatalog } from '@/agent/catalog';
import { createHubChatTransport } from '@/agent/hubChatTransport';
import { partialAnswer } from '@/agent/envelopeStream';
import { runAgentTurn } from '@/agent/loop';
import type { ChatMessage } from '@/agent/messages';
import type { AnswerEnvelope } from '@/agent/envelope';
import type { BillReference } from '@/agent/execute';
import { getDb } from '@/data/db';
import { todayLocalDate } from '@/data/dates';
import { getDataRange } from '@/data/insightsRepo';
import {
  getFrequentQuestions,
  recordQuestion,
  type FrequentQuestion,
} from '@/data/questionsRepo';
import { logQuery } from '@/data/telemetryRepo';
import { DEV_TOOLS_ENABLED } from '@/ui/devTools';

export interface AskMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /**
   * Names in `text` that a tool result proved belong to a bill, so the answer
   * can lead to the receipt behind it.
   */
  references?: BillReference[];
  /**
   * The answer's structured half (§14.7) — what §6.7's renderer draws.
   */
  envelope?: AnswerEnvelope;
  /**
   * The currency the answer's amounts were computed in.
   *
   * Stored per message rather than read live, so an answer keeps the currency
   * it was actually about. A ledger whose dominant currency changes later
   * must not silently reprint an old answer's dollars as euros.
   */
  currency?: string;
}

interface AskState {
  messages: AskMessage[];
  history: ChatMessage[];
  /** True from send until the answer lands — what the typing indicator reads. */
  thinking: boolean;
  /**
   * This user's most-asked questions, for the empty state to offer back.
   *
   * Empty for someone who has not asked anything yet, which is the case the
   * static examples exist for — suggesting nothing would be worse than
   * suggesting a stranger's questions, but only just.
   */
  suggestions: FrequentQuestion[];
  /** Reloads them; the screen calls this when it appears. */
  loadSuggestions: () => Promise<void>;
  /**
   * The answer as it arrives, decoded from §14.7's half-written envelope.
   *
   * Empty until the model starts writing its `text` field, which is why the
   * typing indicator stays up during a tool call — there is genuinely nothing
   * to show yet, and inventing something would be worse than waiting.
   */
  streaming: string;
  send: (text: string) => Promise<void>;
  clear: () => void;
}

/**
 * Four is enough to be useful and few enough to read at a glance. More turns
 * a prompt into a menu, and the box below it is still the main way in.
 */
const SUGGESTION_COUNT = 4;

let counter = 0;
const nextId = () => `m${(counter += 1)}`;

export const useAskStore = create<AskState>((set, get) => ({
  messages: [],
  history: [],
  thinking: false,
  streaming: '',
  suggestions: [],

  loadSuggestions: async () => {
    try {
      set({ suggestions: await getFrequentQuestions(await getDb(), SUGGESTION_COUNT) });
    } catch {
      // A suggestion list is a convenience. Failing to read it must not stop
      // someone typing their question.
    }
  },

  clear: () => set({ messages: [], history: [], thinking: false, streaming: '' }),

  send: async (text: string) => {
    const question = text.trim();
    if (question === '' || get().thinking) return;

    set((state) => ({
      messages: [...state.messages, { id: nextId(), role: 'user', text: question }],
      thinking: true,
      streaming: '',
    }));

    const db = await getDb();

    // Both are read per turn rather than cached in the store: a bill added in
    // another tab between two questions must be visible to the second one, and
    // the catalog's own cache (§6.3) already makes the repeat read cheap.
    const range = await getDataRange(db);
    const catalog = await getDataCatalog(db, catalogCache);

    const turn = await runAgentTurn(question, get().history, {
      // §13.2: the hub is the only LLM endpoint. `byokChatTransport` still
      // works and is the developer's escape hatch, but nothing falls back to
      // it automatically — see that file's header.
      transport: createHubChatTransport(),
      db,
      catalog,
      validation: { today: todayLocalDate(), firstBill: range.firstBill },
      // A preview only. `parseEnvelope` produces the authoritative text below
      // and replaces whatever was shown, so a partial decode that guesses
      // wrong corrects itself rather than persisting.
      onDelta: (raw) => set({ streaming: partialAnswer(raw) }),
    });

    // The provider's own words, in a development build only. Without them a
    // rejected request says "the assistant service refused that request" and
    // nothing about *why*, which costs a build-install-tap cycle per guess.
    // Never in a release: an API error can quote the request back.
    const answer =
      DEV_TOOLS_ENABLED && turn.errorDetail
        ? `${turn.envelope.text}\n\n[dev] ${turn.errorDetail}`
        : turn.envelope.text;

    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: nextId(),
          role: 'assistant',
          text: answer,
          envelope: turn.envelope,
          references: turn.references,
          currency: catalog.currency,
        },
      ],
      history: turn.history,
      thinking: false,
      streaming: '',
    }));

    try {
      await logQuery(db, {
        route: 'agent',
        outcome: turn.log.outcome,
        tokensIn: turn.log.tokensIn,
        tokensOut: turn.log.tokensOut,
        modelAlias: turn.log.modelAlias,
        latencyMs: turn.log.latencyMs,
        errorCode: turn.log.errorCode,
        toolCalls: turn.log.toolCalls.map((call) => call.name),
      });
    } catch {
      // Telemetry is a diagnostic convenience. A user who has just been given
      // an answer should not see it fail because a counter could not be
      // written — the same rule `capture-store` follows for parses.
    }

    // Remember the question so the Ask screen can offer it back (§6, Week 8).
    // Only when it was answered: suggesting a question the app could not
    // answer is offering a known disappointment. Kept out of `query_log`,
    // which §15.3 keeps free of question text — see `questionsRepo`.
    if (turn.log.outcome !== 'error') {
      try {
        await recordQuestion(db, question);
        // Reflect the new count straight away, so the list a user sees next
        // time matches what they have actually been asking.
        set({ suggestions: await getFrequentQuestions(db, SUGGESTION_COUNT) });
      } catch {
        // Same rule as above: a suggestion list is a convenience and must
        // never cost someone the answer they just received.
      }
    }
  },
}));
