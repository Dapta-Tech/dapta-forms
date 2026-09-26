/**
 * Preload for a QA API run: answers the challenge provider's token check
 * locally, exactly the way the provider's public TEST keys answer (success,
 * marked as a testing-key result), so an e2e run with spam protection on never
 * reaches the network. The browser half is stubbed in the specs themselves.
 *
 *   NODE_OPTIONS=--import=<repo>/qa/fixtures/turnstile-siteverify-stub.mjs \
 *     pnpm --filter @quill/api start
 *
 * Test infrastructure only: nothing in the product imports it.
 */
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === SITEVERIFY) {
    console.log('[qa] challenge token check answered locally (siteverify stub)');
    return new Response(
      JSON.stringify({ success: true, 'error-codes': [], metadata: { result_with_testing_key: true } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  return realFetch(input, init);
};
