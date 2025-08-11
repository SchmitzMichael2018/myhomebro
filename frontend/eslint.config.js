// eslint.config.js

import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-plugin-prettier';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';

export default [
  // 1. Global ignores
  {
    ignores: ['dist', 'node_modules', 'build', '.next', '.parcel-cache'],
  },

  // 2. Base ESLint recommended rules
  js.configs.recommended,

  // 3. Main configuration for JS/JSX files
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node, // Also include Node.js globals for config files, etc.
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    
    // The settings for React version detection are correct.
    settings: {
      react: {
        version: 'detect',
      },
    },

    // All your plugins are configured here.
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      prettier,
      'react-refresh': reactRefresh,
    },

    // Your custom rules are well-defined and follow best practices.
    rules: {
      // This spreads in all the recommended rules from the plugins.
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      
      // Your custom overrides and additions:
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'react/prop-types': 'off', // Correct for projects using TypeScript or no prop-types
      'react/react-in-jsx-scope': 'off', // Correct for modern React
      
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // This integrates Prettier rules.
      'prettier/prettier': ['warn', {
        singleQuote: true,
        semi: true,
        trailingComma: 'es5',
        printWidth: 80,
      }],
    },
  },
  
  // 4. Prettier configuration to disable conflicting ESLint rules.
  // This should always be last.
  prettierConfig,
];