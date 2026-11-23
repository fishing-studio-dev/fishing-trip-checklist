// Minimal lint config (no plugins needed): catches undefined names and unused code.
const browser = Object.fromEntries(['window', 'document', 'location', 'localStorage', 'performance', 'requestAnimationFrame', 'console', 'setTimeout', 'clearTimeout', 'URL', 'URLSearchParams', 'Blob', 'FileReader', 'navigator'].map((k) => [k, 'readonly']));
const node = Object.fromEntries(['process', 'require', 'module', '__dirname', 'console', 'setTimeout'].map((k) => [k, 'readonly']));
export default [
  { ignores: ['vendor/**', 'tests/e2e/out/**'] },
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'tools/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...browser, ...node } },
    rules: { 'no-unused-vars': ['error', { args: 'none' }], 'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-keys': 'error', 'no-redeclare': 'error', 'prefer-const': 'warn' },
  },
  {
    files: ['tests/e2e/**/*.cjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...node, window: 'readonly', document: 'readonly', localStorage: 'readonly' } }, // browser globals inside page.evaluate()
    rules: { 'no-unused-vars': ['error', { args: 'none' }], 'no-undef': 'error' },
  },
];
