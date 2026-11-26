import type { VersionNotice } from '../application/version-check.js';

export type SessionInfo = { version: string; showOnboarding: boolean };
export type VersionStatus =
  | { status: 'current' | 'unavailable'; manualUpdate: string }
  | { status: 'update'; notice: VersionNotice; manager?: 'npm' | 'pnpm'; manualUpdate: string };
