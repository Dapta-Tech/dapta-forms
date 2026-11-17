import { Controller, Get, Header, Inject, NotFoundException } from '@nestjs/common';
import type { ServerEnv } from '@quill/config/env';
import { ENV } from './tokens';

/**
 * `GET /.well-known/openai-apps-challenge`: the domain-verification token
 * OpenAI asks for before an app (plugin) built on this MCP server can be
 * submitted to the ChatGPT directory. OpenAI fetches it from the MCP host and
 * compares the body with the token its portal issued, so the answer is the
 * token alone, as plain text.
 *
 * The token is public by design (it only proves control of the domain), so it
 * comes from plain configuration, OPENAI_APPS_CHALLENGE_TOKEN. Unset, the
 * default and every fork: not found.
 *
 * The MCP host must route `/.well-known/*` to the API, which the OAuth
 * discovery documents already require.
 */
@Controller('.well-known')
export class OpenAiAppsChallengeController {
  constructor(@Inject(ENV) private readonly env: ServerEnv) {}

  @Get('openai-apps-challenge')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  challenge(): string {
    const token = this.env.OPENAI_APPS_CHALLENGE_TOKEN?.trim();
    if (!token) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return token;
  }
}
