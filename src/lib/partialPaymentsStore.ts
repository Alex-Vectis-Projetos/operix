/**
 * partialPaymentsStore — Decommissioned in Phase 1 canonical architecture.
 *
 * Invariants:
 *  - No localStorage reads or writes for financial authority.
 *  - Safe no-op methods to prevent runtime crashes.
 */

type Store = Record<string, number>;
type Listener = (store: Store) => void;

const emptyStore: Store = {};

export const partialPaymentsStore = {
  getAll(): Store {
    return emptyStore;
  },
  get(_serviceOrderId: string): number {
    return 0;
  },
  set(_serviceOrderId: string, _amount: number) {
    // No-op: LocalStorage financial mutations decommissioned
  },
  clear(_serviceOrderId: string) {
    // No-op
  },
  subscribe(_listener: Listener): () => void {
    return () => {};
  },
};

export default partialPaymentsStore;
