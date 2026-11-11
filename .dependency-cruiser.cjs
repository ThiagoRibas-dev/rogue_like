/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular-in-foundation-and-cartridges',
      severity: 'error',
      comment: 'Runtime circular dependencies are forbidden inside foundational modules and inside individual ruleset cartridges (AGENTS.md §8).',
      from: {
        path: '^src/(types|constants|utils|rulesets/(classic|dnd35e))/'
      },
      to: {
        circular: true,
        viaOnly: {
          dependencyTypesNot: ['type-only'],
          pathNot: '^src/rulesets/registry\\.ts$'
        }
      }
    },
    {
      name: 'no-cross-ruleset-imports',
      severity: 'error',
      comment: 'Ruleset cartridges must be strictly isolated from one another (classic cannot import dnd35e and vice versa).',
      from: {
        path: '^src/rulesets/([^/]+)/'
      },
      to: {
        path: '^src/rulesets/([^/]+)/',
        pathNot: '^src/rulesets/$1/'
      }
    },
    {
      name: 'no-direct-cartridge-imports-outside-registry',
      severity: 'error',
      comment: 'Core engine, systems, actions, and console rendering must resolve rulesets via src/rulesets/registry.ts and never import concrete cartridge files directly. Cartridge-specific UI modules in src/rendering/ui/(dnd35e_|classic_ui_) may import their own cartridge.',
      from: {
        path: '^src/(core|systems|actions|rendering|map)/',
        pathNot: '^src/rendering/ui/(dnd35e_|classic_ui_)'
      },
      to: {
        path: '^src/rulesets/(classic|dnd35e)/'
      }
    },
    {
      name: 'no-cross-cartridge-ui-imports',
      severity: 'error',
      comment: 'Cartridge-specific UI modules must only import from their own cartridge.',
      from: {
        path: '^src/rendering/ui/(dnd35e|classic)_'
      },
      to: {
        path: '^src/rulesets/(classic|dnd35e)/',
        pathNot: '^src/rulesets/$1/'
      }
    },
    {
      name: 'headless-simulation-purity',
      severity: 'error',
      comment: 'Headless simulation modules (systems, rulesets, map, types, constants, utils) must never import from rendering or editor layers (AGENTS.md §8 & §9).',
      from: {
        path: '^src/(systems|rulesets|map|types|constants|utils)/'
      },
      to: {
        path: '^src/(rendering|editor)/'
      }
    },
    {
      name: 'downward-foundation-layer',
      severity: 'error',
      comment: 'Foundational types and constants must not import upward into core, systems, rulesets, actions, map, rendering, or editor.',
      from: {
        path: '^src/(types|constants)/'
      },
      to: {
        path: '^src/(core|systems|rulesets|actions|map|rendering|editor)/'
      }
    },
    {
      name: 'no-barrel-files',
      severity: 'error',
      comment: 'Barrel files (index.ts) are banned by AGENTS.md §8.',
      from: {},
      to: {
        path: '[/\\\\]index\\.ts$'
      }
    }
  ],
  options: {
    doNotFollow: {
      path: 'node_modules'
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json'
    }
  }
};
