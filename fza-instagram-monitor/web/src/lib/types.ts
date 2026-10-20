export type Role = 'admin' | 'analyst' | 'viewer';
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface NetChange {
  absolute: number | null;
  percent: number | null;
  percentUnavailable?: string;
  unavailable?: string;
  from?: { observedAt: string; followers: number };
  to?: { observedAt: string; followers: number };
  hoursCovered?: number;
}

export interface ProfileSummary {
  clientId: string;
  clientName: string;
  category: string | null;
  clientStatus: 'active' | 'paused' | 'archived';
  notes: string | null;
  postingGoalPerWeek: number | null;
  inactivityAlertDays: number | null;
  negativeChangeThreshold: number | null;
  growthGoalPct30d: number | null;
  archivedAt: string | null;
  purgeAfter: string | null;
  profileId: string;
  username: string;
  canonicalUrl: string | null;
  fullName: string | null;
  profilePictureUrl: string | null;
  profileState: string;
  stateReason: string | null;
  source: string | null;
  isDemo: boolean;
  currentFollowers: number | null;
  currentFollows: number | null;
  currentMediaCount: number | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  nextCollectionAt: string | null;
  manualRequestedAt: string | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  stale: boolean;
  openAlerts: number;
  change24h: NetChange;
  change7d: NetChange;
  change30d: NetChange;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DailyPoint {
  day: string;
  followers: number | null;
  change: number | null;
  samples: number;
}

export interface PostingStats {
  available: boolean;
  unavailableReason?: string;
  latestPublishedAt: string | null;
  daysSinceLatest: number | null;
  windows: { days: number; count: number; complete: boolean }[];
  byType: Record<string, number>;
  byTypeWindowDays: number;
  postsPerWeek: number | null;
  postsPerWeekBasisDays: number | null;
  coverageStart: string | null;
}

export interface Finding {
  key: string;
  level: 'positive' | 'neutral' | 'attention' | 'insufficient';
  title: string;
  text: string;
  period: string;
  dataPoints: string;
}

export interface Capabilities {
  followersCount: boolean;
  followsCount: boolean;
  mediaCount: boolean;
  recentMedia: boolean;
  distinguishesReels: boolean;
  followerGainsAndLosses: boolean;
  followerBackfill: boolean;
  supportedAccountTypes: string;
  notes: string[];
}

export interface ClientDetail {
  summary: ProfileSummary;
  growth: {
    lastVsPrevious: NetChange;
    change7d: NetChange;
    change30d: NetChange;
    bestWorst90d: { best: { day: string; change: number } | null; worst: { day: string; change: number } | null; daysWithData: number };
    snapshotsTotal: number;
    snapshotsSuspect: number;
    historyStartedAt: string | null;
  };
  latestSnapshot: {
    followers: number | null;
    follows: number | null;
    mediaCount: number | null;
    observedAt: string;
    collectedAt: string;
    source: string;
    validity: string;
    validityReason: string | null;
    stale: boolean;
  } | null;
  posting: PostingStats;
  diagnosis: Finding[];
  provider: { id: string; displayName: string; capabilities: Capabilities; isDemo: boolean } | null;
  collection: { followersIntervalMinutes: number; mediaIntervalMinutes: number; permanentlyStopped: boolean };
}

export interface MediaItem {
  id: number;
  external_id: string | null;
  permalink: string | null;
  media_type: string;
  source_media_type: string | null;
  published_at: string | null;
  caption: string | null;
  thumbnail_url: string | null;
  like_count: number | null;
  comments_count: number | null;
  source: string;
  first_seen_at: string;
  client_id: string;
  client_name: string;
  username: string;
}

export interface Run {
  id: number;
  profile_id: string;
  source: string;
  trigger: string;
  worker_id: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
  attempt: number;
  records_processed: number;
  media_new: number;
  media_requested: boolean;
  duration_ms: number | null;
  client_id: string;
  client_name: string;
  username: string;
}

export interface Alert {
  id: string;
  profile_id: string;
  type: string;
  category: 'profile' | 'collector';
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  title: string;
  message: string;
  occurrences: number;
  reopened_from: string | null;
  created_at: string;
  last_triggered_at: string;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
  resolved_at: string | null;
  resolved_by_name: string | null;
  resolution: string | null;
  silenced_until: string | null;
  client_id: string;
  client_name: string;
  username: string;
}

export interface Settings {
  activeProvider: string;
  followersIntervalMinutes: number;
  mediaIntervalMinutes: number;
  mediaFetchLimit: number;
  maxConcurrency: number;
  maxRequestsPerHour: number;
  retryBaseSeconds: number;
  retryMaxMinutes: number;
  maxPermanentFailures: number;
  permanentRetryHours: number;
  displayTimezone: string;
  defaultInactivityDays: number;
  defaultNegativeChangeThreshold: number;
  defaultPostingGoalPerWeek: number | null;
  defaultGrowthGoalPct30d: number | null;
  alertFailureThreshold: number;
  staleAfterIntervals: number;
  alertCooldownHours: number;
  archivedClientRetentionDays: number;
  collectionRunRetentionDays: number;
  snapshotRetentionDays: number | null;
  pageSize: number;
}

export interface ProviderInfo {
  id: string;
  displayName: string;
  isDemo: boolean;
  capabilities: Capabilities;
  config: { configured: boolean; missing: string[]; instructions: string[] };
}

export interface SystemStatus {
  provider: { id: string; displayName: string; isDemo: boolean; config: ProviderInfo['config'] } | null;
  providerPause: { paused_until: string; reason: string } | null;
  requestsLastHour: number;
  maxRequestsPerHour: number;
  workers: { worker_id: string; started_at: string; last_heartbeat_at: string; alive: boolean; info: { status?: string; inFlight?: number; lastTickAt?: string } }[];
  workerAlive: boolean;
  queue: { due: number; manual_pending: number; stopped: number; in_progress: number; next_scheduled: string | null };
  lastRun: { started_at: string; finished_at: string | null; status: string } | null;
  lastSuccessAt: string | null;
  effectiveFrequency: { followersIntervalMinutes: number; mediaIntervalMinutes: number; note: string };
}
