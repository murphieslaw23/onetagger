export type ProviderId = 'freeteknomusic' | 'soundcloud' | 'archiveorg' | 'discogs';
export type MixStatus = 'ready' | 'review' | 'enriching' | 'queued' | 'error';

export interface Artwork {
  url: string;
  source: ProviderId | 'local';
  kind: 'cover' | 'artist' | 'crew' | 'event';
  width?: number;
  height?: number;
}

export interface SourceLink {
  provider: ProviderId;
  url: string;
  externalId?: string;
}

export interface Provenance {
  provider: ProviderId;
  field: string;
  confidence: number;
  observedAt: string;
  sourceUrl?: string;
}

export interface MixCandidate {
  id: string;
  provider: ProviderId;
  confidence: number;
  reasons: string[];
  fields: Partial<MixSet>;
  raw?: Record<string, unknown>;
  state: 'pending' | 'accepted' | 'rejected';
}

export interface MixSet {
  id: string;
  title: string;
  artists: string[];
  crews: string[];
  event?: string;
  venue?: string;
  location?: string;
  recordedAt?: string;
  durationMs: number;
  description?: string;
  genres: string[];
  styles: string[];
  bpmRange?: [number, number];
  loudnessLufs?: number;
  artwork: Artwork[];
  sources: SourceLink[];
  streamUrl?: string;
  fileUrl?: string;
  externalIds: Record<string, string>;
  candidates: MixCandidate[];
  confidence: number;
  completeness: number;
  provenance: Provenance[];
  rawSource?: Record<string, unknown>;
  status: MixStatus;
  duplicateOf?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportJob {
  id: string;
  provider: ProviderId;
  label: string;
  query?: Record<string, unknown>;
  state: 'queued' | 'running' | 'review' | 'done' | 'error' | 'cancelled';
  progress: number;
  scanned: number;
  found: number;
  createdAt: string;
  error?: string;
}

export interface ProviderHealth {
  id: ProviderId;
  name: string;
  mode: 'discover' | 'enrich' | 'both';
  state: 'ready' | 'limited' | 'offline';
  detail: string;
  auth: 'none' | 'optional' | 'required';
  lastCheck: string;
}
