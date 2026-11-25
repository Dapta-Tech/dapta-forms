import { loadServerEnv } from '@quill/config/env';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthService } from './auth.service';
import { FormAiController } from './form-ai.controller';

const request = { headers: {} };
const input = { description: 'Un formulario de cotización.', locale: 'es' };
const draft = {
  version: 1,
  steps: [{ key: 'correo', type: 'email', question: '¿Cuál es tu correo?' }],
};

function controller(overrides: NodeJS.ProcessEnv = {}) {
  const auth = { resolveHost: vi.fn().mockResolvedValue({ memberId: 'editor' }) };
  const env = loadServerEnv({
    LITELLM_BASE_URL: 'http://proxy.example/v1/',
    LITELLM_API_KEY: 'test-key',
    ...overrides,
  });
  return new FormAiController(env, auth as unknown as AuthService, {
    take: () => ({ allowed: true, retryAfterMs: 0 }),
  });
}

function mockFetch() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const modelList = (id: string) => Response.json({ data: [{ id }] });
const completion = (body: unknown) =>
  Response.json({ choices: [{ message: { content: JSON.stringify(body) } }] });

afterEach(() => vi.unstubAllGlobals());

describe('LiteLLM form generation', () => {
  it('does not look for a provider when the proxy URL is unset', async () => {
    const fetch = mockFetch();
    const api = controller({ LITELLM_BASE_URL: '' });
    expect(await api.status(request)).toEqual({ available: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks the exact model alias with the configured proxy credentials', async () => {
    const fetch = mockFetch().mockResolvedValueOnce(modelList('Best model'));
    const api = controller({ LITELLM_BASE_URL: 'http://proxy.example', LITELLM_MODEL: 'Best model' });
    expect(await api.status(request)).toEqual({ available: true });
    expect(fetch).toHaveBeenCalledWith(
      'http://proxy.example/v1/models',
      expect.objectContaining({ headers: { authorization: 'Bearer test-key' } }),
    );
  });

  it('keeps generation disabled for a failed or unauthorized proxy and a missing alias', async () => {
    const fetch = mockFetch()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(modelList('other-model'));
    const api = controller();
    expect(await api.status(request)).toEqual({ available: false });
    expect(await api.status(request)).toEqual({ available: false });
    expect(await api.status(request)).toEqual({ available: false });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('verifies availability again before generating a draft', async () => {
    const fetch = mockFetch()
      .mockResolvedValueOnce(modelList('best-model'))
      .mockResolvedValueOnce(modelList('other-model'));
    const api = controller();
    expect(await api.status(request)).toEqual({ available: true });
    await expect(api.generate(request, input)).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('asks LiteLLM for JSON and returns the validated draft', async () => {
    const fetch = mockFetch()
      .mockResolvedValueOnce(modelList('best-model'))
      .mockResolvedValueOnce(completion(draft));
    const result = await controller().generate(request, input);
    expect(result.draft.steps[0]).toMatchObject(draft.steps[0]!);
    const [url, options] = fetch.mock.calls[1]!;
    expect(url).toBe('http://proxy.example/v1/chat/completions');
    expect(JSON.parse(String(options?.body))).toMatchObject({
      model: 'best-model',
      response_format: { type: 'json_object' },
      messages: [{ role: 'system' }, { role: 'user', content: input.description }],
    });
  });

  it('refuses a draft with a jump that references a missing question', async () => {
    mockFetch().mockResolvedValueOnce(modelList('best-model')).mockResolvedValueOnce(completion({
      version: 1,
      steps: [{
        ...draft.steps[0],
        goto: [{ values: ['a@example.com'], target: 'ausente' }],
      }],
    }));
    await expect(controller().generate(request, input)).rejects.toMatchObject({ status: 502 });
  });
});
