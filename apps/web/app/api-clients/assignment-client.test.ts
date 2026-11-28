import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserAssignmentClient as assignmentClient } from './assignment-client';

afterEach(() => vi.unstubAllGlobals());

describe('assignmentClient.end', () => {
  it('mengirim alasan sebagai JSON walau ada header idempotency-key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await assignmentClient.end('asg-1', '2026-11-28T10:00', 3, 'Pindah cabang');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/assignments/asg-1/end');
    const headers = init.headers as Record<string, string>;
    // Tanpa Content-Type JSON server tidak membaca body, lalu menolak dengan "Alasan wajib diisi".
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['idempotency-key']).toBeTruthy();
    expect(JSON.parse(init.body as string)).toMatchObject({ reason: 'Pindah cabang', expectedVersion: 3 });
  });
});
