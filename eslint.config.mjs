import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out', 'dist', 'node_modules', 'extension/dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: { ...reactHooks.configs.recommended.rules }
  },
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'test/**/*.ts',
      '*.ts',
      '*.mjs',
      'scripts/**/*.mjs',
      'extension/*.mjs'
    ],
    languageOptions: { globals: globals.node }
  },
  {
    // Plain Node, CommonJS: the native messaging host and build tools.
    files: ['native/**/*.cjs', 'tools/**/*.cjs'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    files: ['extension/src/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } }
  },
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } }
)
