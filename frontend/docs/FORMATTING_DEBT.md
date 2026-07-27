# Frontend formatting debt

Correctness lint and formatting validation are intentionally separate.
`npm run lint` checks JavaScript and JSX correctness, React, Hooks, and
accessibility rules. `npm run format:check` reports Prettier drift without
mixing formatting warnings into the correctness gate.

The existing frontend has substantial formatting and line-ending drift. It
should be migrated in reviewable, formatting-only batches:

1. configuration and small utilities;
2. active Capture, Measurement, and PWA files;
3. shared components;
4. pages;
5. tests;
6. remaining legacy directories.

Do not combine these batches with functional changes.
