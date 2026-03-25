import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'tests/**'] },
  ...tseslint.configs.recommended,
  { rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'off' } },
);
