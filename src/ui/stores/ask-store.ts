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
import { createByokChatTransport } from '@/agent/byokChatTransport';
import { runAgentTurn } from '@/agent/loop';
import type { ChatMessage } from '@/agent/messages';
import type { AnswerEnvelope } from '@/agent/envelope';
import { getDb } from '@/data/db';
import { todayLocalDate } from '@/data/dates';
import { getDataRange } from '@/data/insightsRepo';
import { logQuery } from '@/data/telemetryRepo';
import { DEV_TOOLS_ENABLED } from '@/ui/devTools';

export interface AskMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /**
   * The answer's structured half (§14.7). Kept even though Week 7 renders
   * none of it: Week 8's charts, chips and confirmation cards read from here,
   * and dropping it now would mean re-running the turn to get it back.
   */
  envelope?: AnswerEnvelope;
}

interface AskState {
  messages: AskMessage[];
  history: ChatMessage[];
  /** True from send until the answer lands — what the typing indicator reads. */
  thinking: boolean;
  send: (text: string) => Promise<void>;
  clear: () => void;
}

let counter = 0;
const nextId = () => `m${(counter += 1)}`;

export const useAskStore = create<AskState>((set, get) => ({
  messages: [],
  history: [],
  thinking: false,

  clear: () => set({ messages: [], history: [], thinking: false }),

  send: async (text: string) => {
    const question = text.trim();
    if (question === '' || get().thinking) return;

    set((state) => ({
      messages: [...state.messages, { id: nextId(), role: 'user', text: question }],
      thinking: true,
    }));

    const db = await getDb();

    // Both are read per turn rather than cached in the store: a bill added in
    // another tab between two questions must be visible to the second one, and
    // the catalog's own cache (§6.3) already makes the repeat read cheap.
    const range = await getDataRange(db);
    const catalog = await getDataCatalog(db, catalogCache);

    const turn = await runAgentTurn(question, get().history, {
      transport: createByokChatTransport(),
      db,
      catalog,
      validation: { today: todayLocalDate(), firstBill: range.firstBill },
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
        { id: nextId(), role: 'assistant', text: answer, envelope: turn.envelope },
      ],
      history: turn.history,
      thinking: false,
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
  },
}));
