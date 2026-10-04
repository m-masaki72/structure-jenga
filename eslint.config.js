import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/vendor/**',
      'dist/js/fold-net-data.js',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['dist/js/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['tests/**/*.mjs', 'tools/**/*.mjs', 'eslint.config.js', 'playwright.config.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
