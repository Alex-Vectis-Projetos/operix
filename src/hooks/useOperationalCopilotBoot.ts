/**
 * useOperationalCopilotBoot — DEPRECATED / DISABLED (Phase 1 Cleanup).
 *
 * Global background polling of legacy Supabase tables has been removed.
 * Copilot operational interaction is handled on-demand via TopBar AIControlCenter
 * and POST /api/agent/chat.
 */
export function useOperationalCopilotBoot() {
  // No-op. Zero background queries executed.
}
