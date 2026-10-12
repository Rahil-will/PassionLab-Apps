/**
 * ESLint flat config — module boundary rule (Phase 1).
 *
 * modules may only import npm packages, core/, own folder, or contracts.ts.
 *
 * Install: npm i -D eslint
 * Run:    npx eslint modules
 * Also:   node scripts/check-module-boundaries.mjs
 */
export default [
  {
    files: ['modules/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/pages/**',
                '**/components/**',
                '**/stores/**',
                '../production/**',
                '../shipment/**',
                '../../pages/**',
                '../../components/**',
                '../../lib/**',
                '../../stores/**',
              ],
              message:
                'modules/* may import core/*, its own folder, and other modules\' contracts.ts only. Use node scripts/check-module-boundaries.mjs for full enforcement.',
            },
          ],
        },
      ],
    },
  },
];
