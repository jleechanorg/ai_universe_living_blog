import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'tests/**'] },
  { languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', AbortSignal: 'readonly' } } },
  ...tseslint.configs.recommended,
  { rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'off', '@typescript-eslint/no-unused-vars': 'off' } },
);
