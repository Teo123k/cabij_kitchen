import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['node_modules/**', 'dist/**', '_archive/**', 'output/**', 'Workflows/**'] },
  { files: ['**/*.{js,jsx}'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser, ...globals.node } }, rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'off' } },
  // Existing style debt remains visible without unrelated reformatting in this milestone.
  { files: ['src/Dashboard.jsx', 'src/SettingsContext.jsx', 'src/config/*.js', 'src/core/productionTaskEngine.js'], rules: { 'no-useless-escape': 'warn', 'no-extra-boolean-cast': 'warn', 'no-empty': 'warn' } }
];
