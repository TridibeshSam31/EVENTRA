/**
 * Browser Companion API Client for EVENTRA (Option A).
 * Manages pairing codes and connection state for the Windows visible browser companion.
 */

import { apiRequest } from "./client";

export interface PairingCodeResponse {
  pairing_code: string;
  user_id: string;
  expires_at: string;
  expires_in_seconds: number;
  instructions: string;
}

export interface CompanionStatusResponse {
  is_connected: boolean;
  user_id: string;
  device_name?: string | null;
  companion_version?: string | null;
  connected_at?: string | null;
  last_heartbeat_at?: string | null;
  browser_visible: boolean;
  active_execution_id?: string | null;
}

export const browserCompanionApi = {
  /**
   * Generates a new 6-character short-lived pairing code for the authenticated user.
   */
  getPairingCode: (): Promise<PairingCodeResponse> =>
    apiRequest<PairingCodeResponse>("/browser-companion/pairing-code", {
      method: "POST",
    }),

  /**
   * Checks whether the operator's Windows companion is connected via WebSocket.
   */
  getStatus: (): Promise<CompanionStatusResponse> =>
    apiRequest<CompanionStatusResponse>("/browser-companion/status"),
};
