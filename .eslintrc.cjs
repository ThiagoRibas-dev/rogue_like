module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'vite.config.ts'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  rules: {
    // Using TS strict rules we can customize standard eslint behaviour here
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    // 1. Zero 'any' policy (AGENTS.md Golden Rule 11)
    '@typescript-eslint/no-explicit-any': 'error',
    // 2. Strict Seed Determinism (AGENTS.md Section 6): Ban Math.random() in favor of src/core/rng.ts
    'no-restricted-properties': [
      'error',
      {
        object: 'Math',
        property: 'random',
        message: 'Math.random() is banned for gameplay determinism. Use seeded rng from src/core/rng.ts.'
      }
    ],
    // 3. File Size Guideline (AGENTS.md Section 8): Warn when files exceed ~250-300 lines
    'max-lines': [
      'warn',
      { max: 300, skipBlankLines: true, skipComments: true }
    ],
    // 4. Explicit Return Types (AGENTS.md Section 3): Warn across codebase / error on core modules
    '@typescript-eslint/explicit-function-return-type': [
      'warn',
      { allowExpressions: true, allowTypedFunctionExpressions: true }
    ]
  },
  overrides: [
    {
      // Enforce strict explicit return types on engine core and systems
      files: ['src/core/**/*.ts', 'src/systems/**/*.ts'],
      rules: {
        '@typescript-eslint/explicit-function-return-type': [
          'error',
          { allowExpressions: true, allowTypedFunctionExpressions: true }
        ]
      }
    }
  ]
};
