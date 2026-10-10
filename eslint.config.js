import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['dist/vendor/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  {
    files: ['dist/js/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['tests/unit/**/*.mjs', 'tools/**/*.mjs', 'eslint.config.js', 'playwright.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // page.evaluate() のコールバックはブラウザで動く
    files: ['tests/e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
