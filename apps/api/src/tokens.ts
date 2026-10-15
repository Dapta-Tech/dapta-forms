/** DI tokens. Explicit tokens keep injection working without decorator metadata. */
export const ENV = Symbol('ENV');
export const DB = Symbol('DB');
export const EMAIL = Symbol('EMAIL');
export const NOTIFIER = Symbol('NOTIFIER');
export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');
export const RATE_LIMITER = Symbol('RATE_LIMITER');
/** The per-API-key limiter (120 calls a minute), apart from the public per-IP one. */
export const API_KEY_RATE_LIMITER = Symbol('API_KEY_RATE_LIMITER');
export const ENTITLEMENTS = Symbol('ENTITLEMENTS');
export const PREMIUM_MODE = Symbol('PREMIUM_MODE');
export const ONBOARDING_ENABLED = Symbol('ONBOARDING_ENABLED');
export const WORKSPACE_PROJECTION = Symbol('WORKSPACE_PROJECTION');
export const STORAGE = Symbol('STORAGE');
export const CAPTCHA = Symbol('CAPTCHA');
