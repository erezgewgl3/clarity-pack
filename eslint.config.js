// eslint.config.js
//
// Flat config (ESLint 9+). Wires the two custom rules under the `clarity/`
// namespace. Per-rule documentation lives in eslint-rules/*.js.

import tsParser from '@typescript-eslint/parser';

import noRawFetch from './eslint-rules/no-raw-fetch-in-ui.js';
import noRawAnchor from './eslint-rules/no-raw-anchor-to-host-paths.js';

export default [
  {
    // Skip generated + vendor + fixtures-that-must-be-tolerated dirs.
    ignores: ['dist/**', 'node_modules/**', '.planning/**', '.claude/**'],
  },
  {
    files: ['src/ui/**/*.{ts,tsx,js,jsx}', 'test/fixtures/**/src/ui/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      clarity: {
        rules: {
          'no-raw-fetch-in-ui': noRawFetch,
          'no-raw-anchor-to-host-paths': noRawAnchor,
        },
      },
    },
    rules: {
      'clarity/no-raw-fetch-in-ui': 'error',
      'clarity/no-raw-anchor-to-host-paths': 'error',
    },
  },
];
