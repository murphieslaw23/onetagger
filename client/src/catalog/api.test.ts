import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogApi } from './api';

const record = {
  kind: 'mix',
  id: 'mix_01J9CATALOGUE00000000000070',
  createdAt: '2026-10-03T12:00:00.000Z',
  updatedAt: '2026-10-03T12:00:00.000Z',
  revision: 1,
  verification: 'source-confirmed',
  reviewState: 'ready',
  title: 'Live Mackitek Koalisson III',
  people: [],
  eventIds: [],
  genres: [],
  styles: [],
  assets: [],
  sources: []
};

afterEach(() => vi.unstubAllGlobals());

describe('catalogApi', () => {
  it('sends credentialed catalog reads and validates shared response schemas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ items: [record], page: 1, pageSize: 25, total: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const page = await catalogApi.getIndex('mix', { query: 'Mackitek' });
    expect(fetchMock).toHaveBeenCalledWith('/api/catalog/mix?page=1&pageSize=25&q=Mackitek', expect.objectContaining({ credentials: 'include' }));
    expect(page.items[0]?.id).toBe(record.id);
  });

  it('does not accept malformed server records as canonical client state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ items: [{ ...record, durationMs: -1 }], page: 1, pageSize: 25, total: 1 })));
    await expect(catalogApi.getIndex('mix')).rejects.toThrow();
  });

  it('retains HTTP status and API error detail for unsaved writes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Revision conflict' }), { status: 409 })));
    await expect(catalogApi.updateRecord(record.id, { title: 'New title' }, 1)).rejects.toMatchObject({ status: 409, message: 'Revision conflict' });
  });
});