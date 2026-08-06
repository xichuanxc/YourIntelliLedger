/**
 * Ledger list state.
 *
 * The store owns *when* to read; the repository owns *how*. Screens never see
 * a `SqlDriver` (§2.2 rule 1). Every mutation elsewhere in the app finishes by
 * calling `refresh()`, so the list, the month totals and the detail screen
 * cannot disagree about what is stored.
 */

import { create } from 'zustand';

import { getDb } from '@/data/db';
import { listLedger } from '@/data/ledgerRepo';
import type { LedgerMonth } from '@/types/ledger';

export type LedgerStatus = 'idle' | 'loading' | 'ready' | 'error';

interface LedgerState {
  status: LedgerStatus;
  months: LedgerMonth[];
  search: string;
  error: string | null;
  setSearch: (search: string) => void;
  refresh: () => Promise<void>;
}

export const useLedgerStore = create<LedgerState>((set, get) => ({
  status: 'idle',
  months: [],
  search: '',
  error: null,

  setSearch: (search) => {
    set({ search });
    void get().refresh();
  },

  refresh: async () => {
    const requestedSearch = get().search;
    set({ status: get().status === 'ready' ? 'ready' : 'loading', error: null });

    try {
      const db = await getDb();
      const months = await listLedger(db, { search: requestedSearch, limit: 200 });

      // A slower earlier query must not overwrite the results of a newer one —
      // typing in the search box fires these in quick succession.
      if (get().search !== requestedSearch) return;

      set({ months, status: 'ready' });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not read your ledger.',
      });
    }
  },
}));
