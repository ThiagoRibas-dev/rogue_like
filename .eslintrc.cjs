module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', '.dependency-cruiser.cjs', 'vite.config.ts'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json'
  },
  plugins: ['@typescript-eslint'],
  rules: {
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
    // 4. Explicit Return Types (AGENTS.md Section 3): Enforced across all src files
    '@typescript-eslint/explicit-function-return-type': [
      'error',
      { allowExpressions: true, allowTypedFunctionExpressions: true }
    ],
    // 5. Exhaustive Switch on Unions/Enums (AGENTS.md Section 3)
    '@typescript-eslint/switch-exhaustiveness-check': 'error',
    // 6. No Inline import('./file.ts').Type (AGENTS.md Section 8)
    'no-restricted-syntax': [
      'error',
      {
        selector: 'TSImportType',
        message: 'Inline import() types are banned (AGENTS.md §8). Import the type at the top of the file.'
      }
    ]
  },
  overrides: [
    {
      // Encapsulate ROT.js & enforce pure determinism in systems and ruleset cartridges
      files: ['src/systems/**/*.ts', 'src/rulesets/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'rot-js',
                message: 'Do not import rot-js directly in systems or rulesets (AGENTS.md §6). Use src/core/rng.ts, src/map/fov.ts, or src/map/generator.ts.'
              }
            ]
          }
        ],
        'no-restricted-properties': [
          'error',
          {
            object: 'Math',
            property: 'random',
            message: 'Math.random() is banned for gameplay determinism. Use seeded rng from src/core/rng.ts.'
          },
          {
            object: 'Date',
            property: 'now',
            message: 'Date.now() is banned in deterministic simulation systems/rulesets (AGENTS.md §6).'
          }
        ]
      }
    },
    {
      // Pure JSON-serializable ECS components (AGENTS.md Section 4): No Map or Set in components.types.ts
      files: ['src/types/components.types.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'TSImportType',
            message: 'Inline import() types are banned (AGENTS.md §8). Import the type at the top of the file.'
          },
          {
            selector: 'TSTypeReference[typeName.name=/^(Map|Set|ReadonlyMap|ReadonlySet|WeakMap|WeakSet)$/]',
            message: 'Map and Set are banned inside ECS component definitions because components must be JSON-serializable via JSON.stringify (AGENTS.md §4).'
          }
        ]
      }
    }
  ]
};

