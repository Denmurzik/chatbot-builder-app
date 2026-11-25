/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Запрет циклических зависимостей между модулями',
      severity: 'error',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'packages-no-apps',
      comment: 'Пакеты packages/* не могут зависеть от приложений apps/*',
      severity: 'error',
      from: {
        path: '^packages/',
      },
      to: {
        path: '^apps/',
      },
    },
    {
      name: 'model-no-project-packages',
      comment: '@chatbot/model не зависит ни от одного пакета или приложения проекта',
      severity: 'error',
      from: {
        path: '^packages/model/',
      },
      to: {
        path: '^(packages/(?!model/)|apps/)',
      },
    },
    {
      name: 'engine-core-only-model',
      comment: '@chatbot/engine-core из пакетов проекта зависит только от @chatbot/model',
      severity: 'error',
      from: {
        path: '^packages/engine-core/',
      },
      to: {
        path: '^(packages/(?!(engine-core|model)/)|apps/)',
      },
    },
    {
      name: 'web-allowed-packages',
      comment: 'apps/web из пакетов проекта импортирует только @chatbot/model и @chatbot/engine-core',
      severity: 'error',
      from: {
        path: '^apps/web/',
      },
      to: {
        path: '^packages/(?!(model|engine-core)/)',
      },
    },
    {
      name: 'no-cross-app-imports',
      comment: 'Запрет импортов между приложениями apps/*',
      severity: 'error',
      from: {
        path: '^apps/([^/]+)/',
      },
      to: {
        path: '^apps/',
        pathNot: '^apps/$1/',
      },
    },
    {
      name: 'api-business-no-interaction',
      comment:
        'В apps/api слой бизнес-логики не может зависеть от слоя взаимодействия (telegram, vk)',
      severity: 'error',
      from: {
        path: '^apps/api/src/(auth|projects|validation|publication|import-export|preview)/',
        pathNot:
          '(^|/)(app\\.module|main|configure-app|index|config)\\.ts$|\\.(test|int\\.test)\\.ts$|(^|/)testing/',
      },
      to: {
        path: '^apps/api/src/(telegram|vk)/',
      },
    },
    {
      name: 'api-base-no-upper-layers',
      comment:
        'В apps/api базовый слой (prisma, vault, queue, common) не может зависеть от бизнес-логики или взаимодействия',
      severity: 'error',
      from: {
        path: '^apps/api/src/(prisma|vault|queue|common)/',
        pathNot:
          '(^|/)(app\\.module|main|configure-app|index|config)\\.ts$|\\.(test|int\\.test)\\.ts$|(^|/)testing/',
      },
      to: {
        path: '^apps/api/src/(auth|projects|validation|publication|import-export|preview|telegram|vk)/',
      },
    },
    {
      name: 'api-projects-publication-isolated',
      comment: 'В apps/api модули projects и publication не могут зависеть друг от друга',
      severity: 'error',
      from: {
        path: '^apps/api/src/(projects|publication)/',
        pathNot:
          '(^|/)(app\\.module|main|configure-app|index|config)\\.ts$|\\.(test|int\\.test)\\.ts$|(^|/)testing/',
      },
      to: {
        path: '^apps/api/src/(projects|publication)/',
        pathNot: '^apps/api/src/$1/',
      },
    },
    {
      name: 'engine-business-no-interaction',
      comment:
        'В apps/engine слой бизнес-логики (dialog, dispatcher) не может зависеть от слоя взаимодействия (messenger, http, preview)',
      severity: 'error',
      from: {
        path: '^apps/engine/src/(dialog|dispatcher)/',
        pathNot:
          '(^|/)(app\\.module|main|configure-app|index|config)\\.ts$|\\.(test|int\\.test)\\.ts$|(^|/)testing/',
      },
      to: {
        path: '^apps/engine/src/(messenger|http|preview)/',
      },
    },
    {
      name: 'engine-base-no-upper-layers',
      comment:
        'В apps/engine базовый слой (infra) не может зависеть от бизнес-логики или взаимодействия',
      severity: 'error',
      from: {
        path: '^apps/engine/src/infra/',
        pathNot:
          '(^|/)(app\\.module|main|configure-app|index|config)\\.ts$|\\.(test|int\\.test)\\.ts$|(^|/)testing/',
      },
      to: {
        path: '^apps/engine/src/(dialog|dispatcher|messenger|http|preview)/',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: '(^|/)node_modules/|(^|/)dist/',
    },
    exclude: {
      path: '(^|/)coverage/|\\.(test|int\\.test)\\.(ts|tsx)$|(^|/)(test|testing|scripts|examples)/',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['main', 'types', 'typings'],
    },
    reporterOptions: {
      dot: {
        collapsePattern: '^(packages/[^/]+|apps/[^/]+/src/[^/]+)',
      },
      archi: {
        collapsePattern: '^(packages/[^/]+|apps/[^/]+/src/[^/]+)',
        filters: {
          includeOnly: {
            path: '^(packages|apps)/',
          },
        },
      },
    },
  },
};
