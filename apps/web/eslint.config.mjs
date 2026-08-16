// Flat config. Next 16 removed `next lint`, and eslint-config-next 16 requires
// ESLint >= 9, which no longer reads .eslintrc.json. `pnpm lint` now runs
// eslint directly — see the `lint` script in package.json.
import coreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'public/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  ...coreWebVitals,

  {
    rules: {
      // These three arrived with eslint-plugin-react-hooks v7, which
      // eslint-config-next 16 pulls in. They are React Compiler readiness
      // rules — none of them existed under Next 15, and none of them flags a
      // behaviour change in code that has been running in production.
      //
      // They fire 26 times across 18 dashboard files. Rewriting that many
      // useEffect bodies inside a framework-migration commit is the exact
      // trap docs/work-orders.md warns about for Batch G: an app that builds
      // and then misbehaves at runtime in ways a typecheck cannot see. It is
      // worse still here, because the dashboards are the part of this app
      // that moves members' money and the part with no test fixtures.
      //
      // So: visible as warnings, not silenced, and not blocking a deploy.
      // Scheduled as WO-27 — do them in their own pass, in small batches,
      // with a manual walk of each screen.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
];

export default config;
