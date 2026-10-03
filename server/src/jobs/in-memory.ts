import type { MixCandidate, SearchQuery } from '../domain.js';
import type { ProviderRegistry } from '../core/registry.js';

export type JobState = 'queued' | 'running' | 'review' | 'done' | 'error' | 'cancelled';

export interface DiscoveryJob {
  id: string;
  provider: string;
  query: SearchQuery;
  state: JobState;
  progress: number;
  scanned: number;
  found: number;
  createdAt: string;
  updatedAt: string;
  candidates: MixCandidate[];
  error?: string;
}

export class InMemoryJobQueue {
  private jobs = new Map<string, DiscoveryJob>();
  private controllers = new Map<string, AbortController>();

  constructor(private registry: ProviderRegistry) {}

  list(): DiscoveryJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): DiscoveryJob | undefined {
    return this.jobs.get(id);
  }

  create(provider: string, query: SearchQuery): DiscoveryJob {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job: DiscoveryJob = { id, provider, query, state: 'queued', progress: 0, scanned: 0, found: 0, candidates: [], createdAt: now, updatedAt: now };
    this.jobs.set(id, job);
    queueMicrotask(() => void this.run(job));
    return job;
  }

  cancel(id: string): DiscoveryJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return;
    this.controllers.get(id)?.abort(new Error('cancelled'));
    job.state = 'cancelled';
    job.updatedAt = new Date().toISOString();
    return job;
  }

  private async run(job: DiscoveryJob) {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    job.state = 'running';
    job.progress = 8;
    job.updatedAt = new Date().toISOString();
    try {
      const candidates = await this.registry.search(job.provider, job.query, controller.signal);
      if (this.jobs.get(job.id)?.state === 'cancelled') return;
      job.candidates = candidates;
      job.found = candidates.length;
      job.scanned = Math.max(candidates.length, candidates.length * 3);
      job.progress = 100;
      job.state = candidates.length ? 'review' : 'done';
    } catch (error) {
      if (this.jobs.get(job.id)?.state !== 'cancelled') {
        job.state = 'error';
        job.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      job.updatedAt = new Date().toISOString();
      this.controllers.delete(job.id);
    }
  }
}
