import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import nodePlugin from 'eslint-plugin-n';
import perfectionist from 'eslint-plugin-perfectionist';
import eslintPluginPrettier from 'eslint-plugin-prettier/recommended';
import pluginPromise from 'eslint-plugin-promise';
import regexpPlugin from 'eslint-plugin-regexp';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Base configs
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Plugin configs
  unicorn.configs.recommended,
  sonarjs.configs.recommended,
  regexpPlugin.configs['flat/recommended'],
  pluginPromise.configs['flat/recommended'],
  nodePlugin.configs['flat/recommended'],
  perfectionist.configs['recommended-natural'],

  // Prettier (must be last to override formatting rules)
  eslintConfigPrettier,
  eslintPluginPrettier,

  // Type-aware linting setup
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Custom rules
  {
    rules: {
      // TypeScript adjustments
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/adjacent-overload-signatures': 'off',

      // Unicorn adjustments for Express
      'unicorn/prevent-abbreviations': [
        'error',
        {
          replacements: {
            req: false,
            res: false,
            err: false,
            env: false,
            acc: false,
          },
        },
      ],

      // Allow both camelCase and PascalCase filenames (for models)
      'unicorn/filename-case': [
        'error',
        {
          cases: {
            camelCase: true,
            pascalCase: true,
          },
        },
      ],

      // Node.js adjustments for Bun runtime
      'n/no-missing-import': 'off',
      'n/no-unpublished-import': 'off',
      'n/no-unsupported-features/node-builtins': 'off', // Bun has different capabilities

      // Perfectionist import sorting
      'perfectionist/sort-imports': [
        'error',
        {
          type: 'natural',
          order: 'asc',
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling'], 'index', 'type'],
          newlinesBetween: 1,
        },
      ],
    },
  },

  // Disable type-checked rules for JS config files
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Ignores
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'scripts/**', 'data/**'],
  },
);
