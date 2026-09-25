import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'next-env.d.ts',
    // Build output, local runtime state and generated/vendored assets.
    'dist/**',
    '.wrangler/**',
    '.sites-runtime/**',
    'public/ocr/**',
    'playwright-report/**',
    'test-results/**',
    '.claude/**',
  ]),
  {
    files: ['components/ui/**/*.{ts,tsx}', 'hooks/use-mobile.ts'],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to app code.
      '@typescript-eslint/no-unused-vars': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    rules: {
      // Product photos are private authenticated /api/photo URLs or third-party catalogue images;
      // the Next image optimizer does not apply to either on this Workers deployment.
      '@next/next/no-img-element': 'off',
      // Allow intentionally unused bindings (e.g. rest-destructuring to omit a key) when prefixed.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    files: ['tests/**/*.{ts,mjs}'],
    rules: {
      // Tests post deliberately malformed payloads and poke at untyped JSON
      // responses and runtime shims; `any` is the honest type there. App and
      // library code stay strict.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // Keep last: turns off stylistic rules that would conflict with Prettier.
  prettier,
]);

export default eslintConfig;
