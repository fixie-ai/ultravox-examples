import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'experiments'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Allow dropping fields with destructuring (const { a, ...rest }) and _-prefixed unused names.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Code that runs in Node: the agent (tool server, sync; the debugger also imports its pure modules), the
    // devtools server and scripts. devtools/web is browser code; devtools/shared is pure and used by both.
    files: ['agent/**/*.ts', 'engine/**/*.ts', 'toolServer/**/*.ts', 'devtools/server/**/*.ts', 'devtools/*.ts', 'devtools/evals/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
)
