/**
 * The CalendarProvider seam. The external-calendar integration is resolved
 * through the pluggable `CalendarProvider` port (`@slate/calendar`) selected by
 * `CALENDAR_PROVIDER` (config/env), so the enum is genuinely load-bearing:
 *
 *   - `disabled` — the OSS default. No external calendar: availability subtracts
 *                  only local bookings + holds, and bookings write nothing out.
 *                  A bare clone runs with zero calendar config.
 *   - `external` — the generic-HTTP `ExternalCalendarProvider`. It speaks a
 *                  vendor-neutral REST contract to `CALENDAR_API_BASE_URL`,
 *                  authorized by a bearer. The bearer + request shaping come from
 *                  either the committed generic backend (a static token, for a
 *                  self-hosted REST calendar service) OR a PRIVATE overlay module
 *                  (`CALENDAR_BACKEND_MODULE`) that supplies the JWT authority and
 *                  the real vendor mapping. NO vendor is named in this build (R15).
 *                  Selecting `external` with nothing configured fails loud.
 *
 * This mirrors the AuthProvider seam (`auth.provider.ts`): the port lives in a
 * public package, the OSS default is safe, and the concrete adapter is an
 * env-selected drop-in that never leaks a vendor into the open-source surface.
 */
import { DisabledCalendarProvider, type CalendarProvider } from '@slate/calendar';
import type { ServerEnv } from '@slate/config/env';
import { GenericRestWire, StaticTokenSource } from './calendar.backend.generic';
import {
  ExternalCalendarProvider,
  type CalendarTokenSource,
  type CalendarWire,
  type ConnectStart,
} from './calendar.http-provider';

/** What a private backend overlay module's default export must return. */
export interface CalendarBackend {
  baseUrl: string;
  tokenSource: CalendarTokenSource;
  wire: CalendarWire;
  /**
   * Optional custom connect handshake (see ExternalCalendarOptions.startConnect):
   * lets a backend resolve the end provider's OAuth URL itself so users skip any
   * intermediate hosted screen.
   */
  startConnect?: (provider: string, tenantKey: string) => Promise<ConnectStart>;
}
export type CalendarBackendFactory = (env: ServerEnv) => CalendarBackend | Promise<CalendarBackend>;

const OVERLAY_HINT =
  'CALENDAR_PROVIDER=external needs a backend: set CALENDAR_API_BASE_URL + CALENDAR_API_TOKEN for the ' +
  'generic REST backend, or CALENDAR_BACKEND_MODULE to a private adapter overlay (not bundled in the ' +
  'open-source build). Or use CALENDAR_PROVIDER=disabled.';

/**
 * Synchronous selection: covers `disabled`, the generic REST backend (static
 * token), and fail-loud. A private `CALENDAR_BACKEND_MODULE` needs async loading
 * — use `createCalendarProviderAsync` (the DI factory does).
 */
export function createCalendarProvider(env: ServerEnv): CalendarProvider {
  switch (env.CALENDAR_PROVIDER) {
    case 'disabled':
      return new DisabledCalendarProvider();
    case 'external': {
      if (env.CALENDAR_BACKEND_MODULE) {
        throw new Error('CALENDAR_BACKEND_MODULE requires async loading (createCalendarProviderAsync).');
      }
      if (env.CALENDAR_API_BASE_URL && env.CALENDAR_API_TOKEN) {
        return new ExternalCalendarProvider({
          baseUrl: env.CALENDAR_API_BASE_URL,
          tokenSource: new StaticTokenSource(env.CALENDAR_API_TOKEN),
          wire: new GenericRestWire(),
          timeoutMs: env.CALENDAR_HTTP_TIMEOUT_MS,
        });
      }
      throw new Error(OVERLAY_HINT);
    }
    default:
      throw new Error(`Unknown CALENDAR_PROVIDER: ${String((env as ServerEnv).CALENDAR_PROVIDER)}`);
  }
}

/**
 * Async selection used by DI. When `CALENDAR_BACKEND_MODULE` is set, it is loaded
 * via a NON-LITERAL dynamic import (so a missing overlay never breaks the public
 * build/typecheck) and its default-export factory supplies the real backend.
 * Otherwise this delegates to the synchronous selector.
 */
export async function createCalendarProviderAsync(env: ServerEnv): Promise<CalendarProvider> {
  if (env.CALENDAR_PROVIDER === 'external' && env.CALENDAR_BACKEND_MODULE) {
    const spec: string = env.CALENDAR_BACKEND_MODULE;
    const mod = (await import(spec)) as { default?: CalendarBackendFactory } | CalendarBackendFactory;
    const factory: CalendarBackendFactory | undefined =
      typeof mod === 'function' ? mod : mod.default;
    if (typeof factory !== 'function') {
      throw new Error(`CALENDAR_BACKEND_MODULE "${spec}" must default-export a backend factory.`);
    }
    const backend = await factory(env);
    return new ExternalCalendarProvider({
      baseUrl: backend.baseUrl,
      tokenSource: backend.tokenSource,
      wire: backend.wire,
      startConnect: backend.startConnect,
      timeoutMs: env.CALENDAR_HTTP_TIMEOUT_MS,
    });
  }
  return createCalendarProvider(env);
}
