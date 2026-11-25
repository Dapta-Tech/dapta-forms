import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isStorageEnabled, type ServerEnv } from '@quill/config/env';
import { reviewConfig } from '@quill/mcp';
import { formConfigJsonSchema, GUIDE_LOGIC, GUIDE_STEP_TYPES } from '@quill/mcp/guide';
import { formConfigSchema, formStepSchema, localeSchema } from '@quill/types';
import { z } from 'zod';
import type { ReqLike } from './auth.provider';
import { AuthService } from './auth.service';
import type { RateLimiter } from './rate-limit';
import { strictConfigIssues } from './strict-config';
import { ENV, RATE_LIMITER } from './tokens';

const inputSchema = z.object({
  description: z.string().trim().min(1).max(4000),
  locale: localeSchema,
});
const draftSchema = formConfigSchema
  .pick({ version: true, scoring: true, outcomes: true })
  .extend({ steps: z.array(formStepSchema).min(1).max(30) })
  .strict();
const modelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });
const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).nonempty(),
});

function proxyBaseUrl(value: string | undefined): string | null {
  if (!value || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    return null;
  }
  const base = url.href.replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

function systemPrompt(locale: 'en' | 'es', uploads: boolean): string {
  const { properties } = formConfigJsonSchema('mcp') as { properties: Record<string, unknown> };
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'steps'],
    properties: {
      version: properties.version,
      steps: properties.steps,
      scoring: properties.scoring,
      outcomes: properties.outcomes,
    },
  };
  return [
    'Generate a dForms draft from the user’s description. Return only one JSON object matching the schema.',
    `Use ${locale === 'es' ? 'Spanish' : 'English'} unless the description specifies a different language.`,
    'Use 1 to 30 steps, with a unique key for each and a question on each input step.',
    'Only use links provided in the description. Add scoring and conditions only when requested.',
    JSON.stringify(GUIDE_STEP_TYPES.filter((step) => uploads || step.type !== 'file')),
    ...GUIDE_LOGIC,
    JSON.stringify(schema),
  ].join('\n');
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    error: 'FORM_AI_UNAVAILABLE',
    message: 'LiteLLM or the configured model is unavailable.',
  });
}

function invalidDraft(): BadGatewayException {
  return new BadGatewayException({
    error: 'FORM_AI_INVALID_DRAFT',
    message: 'The model did not return a valid form draft.',
  });
}

@Controller('v1/form-ai')
export class FormAiController {
  private readonly baseUrl: string | null;
  private readonly headers: Record<string, string>;

  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {
    this.baseUrl = proxyBaseUrl(env.LITELLM_BASE_URL);
    this.headers = env.LITELLM_API_KEY ? { authorization: `Bearer ${env.LITELLM_API_KEY}` } : {};
  }

  private async isAvailable(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers,
        redirect: 'error',
        signal: AbortSignal.timeout(2_500),
      });
      if (!response.ok) return false;
      const result = modelsSchema.safeParse(await response.json());
      return result.success && result.data.data.some(({ id }) => id === this.env.LITELLM_MODEL);
    } catch {
      return false;
    }
  }

  @Get('status')
  @Header('Cache-Control', 'no-store')
  async status(@Req() req: ReqLike) {
    await this.auth.resolveHost(req);
    return { available: await this.isAvailable() };
  }

  @Post('generate')
  @HttpCode(200)
  async generate(@Req() req: ReqLike, @Body() body: unknown) {
    const principal = await this.auth.resolveHost(req);
    const input = inputSchema.safeParse(body);
    if (!input.success) {
      throw new BadRequestException({ error: 'BAD_REQUEST', message: input.error.issues[0]?.message });
    }
    if (!this.baseUrl) throw unavailable();
    const rate = this.limiter.take(`form-ai:${principal.memberId}`);
    if (!rate.allowed) {
      throw new HttpException(
        { error: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!(await this.isAvailable())) throw unavailable();

    const uploads = isStorageEnabled(this.env);
    const prompt = systemPrompt(input.data.locale, uploads);
    let upstream: unknown;
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { ...this.headers, 'content-type': 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(40_000),
        body: JSON.stringify({
          model: this.env.LITELLM_MODEL,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: input.data.description },
          ],
          response_format: { type: 'json_object' },
        }),
      });
      if (response.ok) upstream = await response.json();
    } catch {
      throw unavailable();
    }
    if (upstream === undefined) throw unavailable();

    const completion = completionSchema.safeParse(upstream);
    if (!completion.success) throw invalidDraft();
    let rawDraft: unknown;
    try {
      rawDraft = JSON.parse(completion.data.choices[0].message.content);
    } catch {
      throw invalidDraft();
    }
    const draft = draftSchema.safeParse(rawDraft);
    if (
      !draft.success ||
      reviewConfig(rawDraft).issues.length > 0 ||
      strictConfigIssues(rawDraft, { prefix: [], destinations: false }).length > 0 ||
      (!uploads && draft.data.steps.some((step) => step.type === 'file'))
    ) {
      throw invalidDraft();
    }
    return { draft: draft.data };
  }
}
