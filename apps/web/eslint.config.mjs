import base from '@quill/config/eslint';

/**
 * A client component that invokes a server action with a bare `await`/`void`
 * has no seam for the INVOCATION itself failing — a deploy rotating action ids
 * or a dropped connection rejects the promise, skipping every state update
 * after it (the "stuck on Saving…" bug). `callAction` (lib/call-action.ts)
 * turns that rejection into a value, so this rule forces every call through it.
 * Scoped to client component trees; server-side code (actions, RSC pages,
 * route handlers) awaits its own helpers, not remote action stubs.
 */
const requireCallAction = {
  files: ['app/**/*.tsx', 'components/**/*.tsx'],
  // The public renderers migrate in their own PR — their submit/booking paths
  // need visible error states designed alongside the wrapping, not a blind fix.
  ignores: ['app/\\[accountCode\\]/**'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "AwaitExpression > CallExpression[callee.name=/Action$/]:not([callee.name='callAction'])",
        message:
          'Invoke server actions via callAction(() => theAction(…)) from @/lib/call-action — a bare await rejects on transport failures (deploy-rotated action ids, network drops) and strands UI state.',
      },
      {
        selector: "UnaryExpression[operator='void'] > CallExpression[callee.name=/Action$/]:not([callee.name='callAction'])",
        message:
          'Invoke server actions via void callAction(() => theAction(…)) from @/lib/call-action — a bare void call swallows transport rejections instead of handling them.',
      },
    ],
  },
};

export default [...base, requireCallAction];
