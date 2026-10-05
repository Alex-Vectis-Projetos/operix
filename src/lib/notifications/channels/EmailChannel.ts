import type {
  NotificationChannel,
  NotificationPayload,
  NotifyDeliveryResult,
} from "../types";

/**
 * EmailChannel — Safe no-op channel in Phase 1 runtime.
 * Email delivery is deferred to external provider integration.
 */
export const EmailChannel: NotificationChannel = {
  key: "email",
  name: "Email",
  minPriority: "normal",
  audiences: ["admin", "developer", "owner", "ops"],

  isReady() {
    return false;
  },

  async deliver(_payload: NotificationPayload): Promise<NotifyDeliveryResult> {
    // Phase 1: safe no-op to prevent 404 network failures
    return {
      channel: "email",
      status: "skipped",
      at: Date.now(),
    };
  },
};

export default EmailChannel;
