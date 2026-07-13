/**
 * Shared flat ESLint config. Kept intentionally lean — correctness rules from
 * typescript-eslint's recommended set, no stylistic churn (Prettier owns style).
 * Packages extend this and add framework plugins (Next, etc.) as needed.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript's own checker owns undefined-symbol detection; the core rule
      // false-positives on globals (test runner, DOM) that tsc already knows.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
