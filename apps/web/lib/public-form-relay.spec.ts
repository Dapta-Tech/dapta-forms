/**
 * The public form's server side (the route the renderers call instead of
 * Server Actions): each call reaches the API the way the actions did, and
 * the answer is the server's verdict.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  postFormEvent: vi.fn(),
  postSubmission: vi.fn(),
  postUploadPresign: vi.fn(),
}));
const booking = vi.hoisted(() => ({ postBookingCallback: vi.fn() }));
vi.mock('@/lib/api', () => api);
vi.mock('@/lib/booking-embed', () => booking);
vi.mock('@/lib/forwarded-for', () => ({
  forwardedForChain: vi.fn(async () => '203.0.113.7, 10.0.0.2'),
}));

import { isPublicFormOp, relayPublicFormCall } from './public-form-relay';
import { EVENTS_PER_CALL, eventBatches } from '@/app/[accountCode]/[handle]/[slug]/event-batches';

const views = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ type: 'step_view', stepIndex: i, stepKey: `q${i}` }));

beforeEach(() => {
  api.postFormEvent.mockReset();
  api.postSubmission.mockReset();
  api.postUploadPresign.mockReset();
  booking.postBookingCallback.mockReset();
});

describe('isPublicFormOp', () => {
  it('knows the four calls and nothing else', () => {
    expect(['submissions', 'events', 'booking', 'uploads'].every(isPublicFormOp)).toBe(true);
    expect(isPublicFormOp('submit')).toBe(false);
    expect(isPublicFormOp('../admin')).toBe(false);
  });
});

describe('submissions', () => {
  it('answers the verdict, refusals included, always with a 200', async () => {
    api.postSubmission.mockResolvedValueOnce({
      ok: true,
      status: 201,
      id: 'x',
      score: 7,
      outcome: 'hot',
    });
    const payload = { sessionId: 's', data: { a: 1 }, partial: true, locale: 'es' };
    expect(await relayPublicFormCall('submissions', 'acme', 'f', payload)).toEqual({
      status: 200,
      body: { ok: true, score: 7, outcome: 'hot', message: undefined, error: undefined },
    });
    expect(api.postSubmission).toHaveBeenCalledWith('acme', 'f', payload);

    api.postSubmission.mockResolvedValueOnce({
      ok: false,
      status: 429,
      message: 'Slow down.',
      error: 'RATE_LIMITED',
    });
    const refused = await relayPublicFormCall('submissions', 'acme', 'f', {
      sessionId: 's',
      data: {},
    });
    expect(refused.status).toBe(200);
    expect(refused.body).toMatchObject({ ok: false, error: 'RATE_LIMITED', message: 'Slow down.' });
  });

  it('throws when the API cannot be reached, so the route can say it was not a verdict', async () => {
    api.postSubmission.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(
      relayPublicFormCall('submissions', 'acme', 'f', { sessionId: 's', data: {} }),
    ).rejects.toThrow();
  });

  it.each([500, 502, 503, 504])(
    'throws on an API %i (a proxy mid-rollout is not a refusal), so the browser retries',
    async (status) => {
      api.postSubmission.mockResolvedValueOnce({ ok: false, status, message: 'Could not submit.' });
      await expect(
        relayPublicFormCall('submissions', 'acme', 'f', { sessionId: 's', data: {} }),
      ).rejects.toThrow();
    },
  );
});

describe('events', () => {
  it('posts one event, as it always did', async () => {
    api.postFormEvent.mockResolvedValue(undefined);
    expect(
      await relayPublicFormCall('events', 'acme', 'f', { sessionId: 's', type: 'view' }),
    ).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(api.postFormEvent).toHaveBeenCalledWith('acme', 'f', {
      sessionId: 's',
      type: 'view',
      stepIndex: null,
      stepKey: null,
    });
  });

  it('posts every event of a batch at once, not one after another', async () => {
    const pending: Array<() => void> = [];
    api.postFormEvent.mockImplementation(
      () => new Promise<void>((resolve) => pending.push(resolve)),
    );
    const done = relayPublicFormCall('events', 'acme', 'f', { sessionId: 's', events: views(3) });
    await Promise.resolve();
    // All three are in flight before the first answers.
    expect(api.postFormEvent).toHaveBeenCalledTimes(3);
    for (const resolve of pending.reverse()) resolve();
    await done;
    expect(api.postFormEvent.mock.calls.map((c) => c[2])).toEqual([
      { sessionId: 's', type: 'step_view', stepIndex: 0, stepKey: 'q0' },
      { sessionId: 's', type: 'step_view', stepIndex: 1, stepKey: 'q1' },
      { sessionId: 's', type: 'step_view', stepIndex: 2, stepKey: 'q2' },
    ]);
  });

  it('never fans out past one batch per call', async () => {
    api.postFormEvent.mockResolvedValue(undefined);
    await relayPublicFormCall('events', 'acme', 'f', {
      sessionId: 's',
      events: views(EVENTS_PER_CALL + 6),
    });
    expect(api.postFormEvent).toHaveBeenCalledTimes(EVENTS_PER_CALL);
  });

  it('ignores an `events` that is not a list', async () => {
    await relayPublicFormCall('events', 'acme', 'f', { sessionId: 's', events: 'x' });
    expect(api.postFormEvent).not.toHaveBeenCalled();
  });
});

describe('booking', () => {
  it('reports the meeting once, with the visitor IP chain for the rate limit', async () => {
    booking.postBookingCallback.mockResolvedValue(undefined);
    const payload = { sessionId: 's', provider: 'calendly', eventUri: 'https://example.com/e/1' };
    expect(await relayPublicFormCall('booking', 'acme', 'f', payload)).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(booking.postBookingCallback).toHaveBeenCalledTimes(1);
    expect(booking.postBookingCallback).toHaveBeenCalledWith(
      'acme',
      'f',
      payload,
      '203.0.113.7, 10.0.0.2',
    );
  });
});

describe('uploads', () => {
  it('hands back the presign result as it came', async () => {
    const upload = {
      url: 'https://bucket.example.com/put',
      key: 'k',
      contentType: 'application/pdf',
    };
    api.postUploadPresign.mockResolvedValueOnce({ ok: true, upload });
    const res = await relayPublicFormCall('uploads', 'acme', 'f', {
      sessionId: 's',
      stepKey: 'cv',
      name: 'cv.pdf',
      size: 10,
      mime: 'application/pdf',
    });
    expect(res).toEqual({ status: 200, body: { ok: true, upload } });
  });
});

describe('eventBatches', () => {
  it('splits a big screen into consecutive batches, in order, dropping nothing', () => {
    const batches = eventBatches(views(30));
    expect(batches.map((b) => b.length)).toEqual([24, 6]);
    expect(batches.flat()).toEqual(views(30));
    expect(eventBatches([])).toEqual([]);
  });
});
