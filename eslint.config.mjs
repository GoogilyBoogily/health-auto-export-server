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
      '@typescript-eslint/adjacent-overload-signatures': 'off',
      // TypeScript adjustments
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Node.js adjustments for Bun runtime
      'n/no-missing-import': 'off',

      'n/no-unpublished-import': 'off',

      'n/no-unsupported-features/es-syntax': 'off', // Bun supports modern ES features
      'n/no-unsupported-features/node-builtins': 'off', // Bun has different capabilities
      // Perfectionist rule customizations
      'perfectionist/sort-classes': [
        'error',
        {
          groups: [
            'static-property',
            'property',
            'constructor',
            'static-method',
            'method',
            'private-method',
            'unknown',
          ],
          partitionByComment: true,
          type: 'natural',
        },
      ],
      'perfectionist/sort-enums': [
        'error',
        {
          partitionByComment: true,
          type: 'natural',
        },
      ],
      'perfectionist/sort-imports': [
        'error',
        {
          environment: 'bun',
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling'],
            'index',
            'side-effect',
            'type',
          ],
          newlinesBetween: 1,
          order: 'asc',
          type: 'natural',
        },
      ],
      'perfectionist/sort-interfaces': [
        'error',
        {
          groups: [
            'required-property',
            'required-method',
            'optional-property',
            'optional-method',
            'unknown',
          ],
          partitionByComment: true,
          type: 'natural',
        },
      ],
      'perfectionist/sort-object-types': [
        'error',
        {
          groups: ['required-property', 'optional-property', 'unknown'],
          partitionByComment: true,
          type: 'natural',
        },
      ],
      'perfectionist/sort-objects': [
        'error',
        {
          partitionByComment: true,
          partitionByNewLine: true,
          type: 'natural',
        },
      ],
      'perfectionist/sort-union-types': [
        'error',
        {
          groups: ['named', 'keyword', 'literal', 'nullish'],
          type: 'natural',
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

      // Unicorn adjustments for Express
      'unicorn/prevent-abbreviations': [
        'error',
        {
          replacements: {
            acc: false,
            env: false,
            err: false,
            req: false,
            res: false,
          },
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
