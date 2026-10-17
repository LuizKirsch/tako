# GitHub fixtures

The `*.sample.json` files start hand-written from the GraphQL schema.
Replace them with real responses from your account:

```bash
npx tsx scripts/capture-fixtures.ts            # uses your first open project
npx tsx scripts/capture-fixtures.ts PVT_xxx    # or a specific project
```

Then run `npm test`. If a parser test fails, the real API differs from what
the code assumed: fix the parser, not the fixture. The test expectations
(project names, counts) will need updating to match your data.
