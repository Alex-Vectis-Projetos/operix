/**
 * RealtimeHub — Neutralized broker for canonical architecture.
 *
 * In Phase 1, Supabase Realtime is decommissioned in favor of
 * canonical Express / PostgreSQL polling and query invalidation.
 * This singleton provides safe no-op subscriptions without opening
 * any background Supabase channels or network sockets.
 */

export type PgEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

export interface SubscribeOptions {
  table: string;
  event?: PgEvent;
  schema?: string;
  workspaceId?: string | null;
  filter?: string;
}

type Listener = (payload: unknown) => void;

export function subscribe(_opts: SubscribeOptions, _handler: Listener): () => void {
  // Safe no-op unsubscribe
  return () => {};
}

export function getHubSnapshot() {
  return [];
}

export function resetHub() {
  // No-op
}

export const RealtimeHub = { subscribe, getHubSnapshot, resetHub };
export default RealtimeHub;
