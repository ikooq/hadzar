# Contributing to hadzar

Thanks for helping make time together easier.

## Local setup

1. Use Node.js 22.13 or newer.
2. Copy `.env.example` to `.env` and add the Supabase URL and publishable key for local development.
3. Install dependencies with `npm ci`.
4. Start the app with `npm run dev`.

## Before opening a pull request

Run the same checks used by GitHub Actions:

```sh
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Keep migrations backwards-compatible where possible, explain any required Supabase changes in the pull request, and never commit `.env`, service-role keys, passwords, or private user data.
