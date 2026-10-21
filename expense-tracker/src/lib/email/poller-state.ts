/** Heartbeat the email poller writes to app_state['email_poller'] (shown on the Settings page). */
export interface PollerState {
  lastRunAt: string | null;
  lastResult: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}
