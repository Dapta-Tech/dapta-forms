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
const qualificationInput = { ...input, description: 'Scheduling software for local repair shops.', skill: 'qualify-leads' };
const publishedSkill = (url: string) => Response.json({ plugins: [{
  name: 'qualify-leads',
  version: '1.0.0',
  source: { source: 'git-subdir', url, path: 'skills/qualify-leads', ref: 'develop' },
}] });

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
    expect(JSON.parse(String(options?.body))).not.toHaveProperty('metadata');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('sends the published skill instructions and a versioned usage tag to LiteLLM', async () => {
    const instructions = 'Ask the lead to describe their most recent attempt to solve the problem.';
    const fetch = mockFetch()
      .mockResolvedValueOnce(modelList('best-model'))
      .mockResolvedValueOnce(publishedSkill('https://github.com/example/forms.git'))
      .mockResolvedValueOnce(new Response(`---\nname: qualify-leads\n---\n\n${instructions}\n`))
      .mockResolvedValueOnce(completion(draft));

    expect((await controller().generate(request, qualificationInput)).draft.steps[0]).toMatchObject(draft.steps[0]!);
    expect(fetch).toHaveBeenNthCalledWith(2, 'http://proxy.example/claude-code/marketplace.json',
      expect.objectContaining({ headers: { authorization: 'Bearer test-key' }, redirect: 'error' }));
    expect(fetch).toHaveBeenNthCalledWith(3,
      'https://raw.githubusercontent.com/example/forms/develop/skills/qualify-leads/SKILL.md',
      { redirect: 'error', signal: expect.any(AbortSignal) });
    const [url, options] = fetch.mock.calls[3]!;
    expect(url).toBe('http://proxy.example/v1/chat/completions');
    const payload = JSON.parse(String(options?.body));
    expect(payload).toMatchObject({
      messages: [{ role: 'system', content: expect.stringContaining(instructions) },
        { role: 'user', content: qualificationInput.description }],
      response_format: { type: 'json_object' },
      metadata: { tags: ['skill:qualify-leads@1.0.0'] },
    });
    expect(payload.messages[0].content).toContain('Generate a dForms draft');
  });

  it('does not generate or report skill usage when the catalogue source is unsupported', async () => {
    const fetch = mockFetch()
      .mockResolvedValueOnce(modelList('best-model'))
      .mockResolvedValueOnce(publishedSkill('https://other.example/forms'));

    await expect(controller().generate(request, qualificationInput)).rejects.toMatchObject({
      status: 503,
      response: { error: 'FORM_AI_SKILL_UNAVAILABLE' },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not substitute a generic draft when the published skill file is missing', async () => {
    const fetch = mockFetch()
      .mockResolvedValueOnce(modelList('best-model'))
      .mockResolvedValueOnce(publishedSkill('https://github.com/example/forms'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(controller().generate(request, qualificationInput)).rejects.toMatchObject({
      status: 503,
      response: { error: 'FORM_AI_SKILL_UNAVAILABLE' },
    });
    expect(fetch).toHaveBeenCalledTimes(3);
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
