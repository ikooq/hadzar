# hadzar

A shared space for two people with busy lives. English UI, individual email/password accounts, chosen names and unique nicknames, and invitation-only pair membership.

[![CI](https://github.com/ikooq/hadzar/actions/workflows/ci.yml/badge.svg)](https://github.com/ikooq/hadzar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Hadzar helps a couple find time together, keep small promises, and remember the things that matter without turning their private space into a social feed.

## Current status

The app and Supabase database migrations are implemented. A clearly labelled, in-memory sample workspace is available while the backend is not configured. It is not a substitute for registration: no sample data is saved and no accounts are faked.

Live email delivery and password recovery still depend on the connected Supabase project's email settings. The published Site is public, while application data remains private through database Row Level Security. Realtime updates are enabled when the Supabase project includes the `supabase_realtime` publication.

## Connect Supabase

1. Create a Supabase project at https://supabase.com/dashboard.
2. For a new database, run these files in order: `supabase/migrations/202609140001_hadzar.sql`, `supabase/migrations/202609190001_pair_requests.sql`, `supabase/migrations/202609190002_repair_pair_requests.sql`, `supabase/migrations/202609200001_product_improvements.sql`, `supabase/migrations/202609210001_focus_integrity.sql`, `supabase/migrations/202609220001_shared_plans_notifications.sql`, `supabase/migrations/202609230001_moment_followthrough.sql`, and `supabase/migrations/202609240001_rituals_extensions.sql`. For an existing hadzar database, run the repair, product improvements, focus integrity, shared plans, moment follow-through, and rituals/extensions files after checking which earlier migrations are already present. They are safe to rerun and refresh the API schema cache. Publishing the website does not apply external Supabase migrations.
3. In Authentication, enable Email and password, require email confirmation, and set a minimum password length of 8 or greater.
4. Set Site URL to the final hadzar URL. Allow that origin's root, invitation query URLs, and `/?recovery=1` as authentication redirect URLs. For local development allow `http://localhost:5173/**` as well. Use exact production-origin patterns, not an unrestricted global wildcard.
5. Configure custom SMTP for confirmations and password resets before public registration. Supabase's default mail service is for testing and limits recipients/delivery.
6. Copy the Project URL and Publishable key (or legacy anon key). No service-role key is used by this app.
7. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.env` for local development. Set the same two hosted runtime values through Sites before publishing the connected version. The config endpoint deliberately rejects privileged keys.
8. Register two test accounts, confirm both emails, create a pair with one, create its invitation link, and join using the second. Test a third unrelated account to confirm pair isolation. Verify password reset, realtime updates and reloading saved data on another device before inviting real couples.
9. If you want two-factor sign-in, enable TOTP enrollment and verification in Supabase Authentication settings. Users can then finish setup from Settings → Sign-in security in hadzar.

Supabase documentation: https://supabase.com/docs/guides/auth/passwords and https://supabase.com/docs/guides/database/postgres/row-level-security.

## Product behavior

- Each person has their own email/password account and profile. Nicknames use 3–24 letters, numbers, or underscores and are unique (normalized to lowercase).
- A person can belong to one pair. A pair holds at most two people. Invitations expire after seven days, are stored as SHA-256 hashes, and are consumed on joining. Rotating an invitation invalidates the old one. People with existing accounts can also send a request by nickname; the recipient can accept or decline it from the shared workspace banner.
- Incoming requests also appear before creating a space. Accepting combines solo spaces while keeping their events, notes, messages and commitments. The sender's existing space and shared settings take precedence; if only the recipient has a space, it is retained. Different timezones with existing recipient schedule data must be aligned in Settings before joining. Full pairs cannot be combined.
- Add busy blocks in the pair's timezone. Both partners must confirm the selected day's schedule before free windows appear. The algorithm unions busy intervals, applies the shared buffer, clips to shared hours, and filters by minimum duration.
- Shared plans recheck both confirmations and overlapping events in the database before saving.
- Busy blocks can be repeated for a week, weekdays, or four weekly occurrences. The selected day can be exported as an `.ics` calendar file or opened as a Google Calendar event without connecting an external calendar account.
- Busy event changes invalidate both schedule confirmations for that day. The schedule also surfaces the three longest confirmed windows in the next seven days.
- Shared-window proposals are serialized by a database lock around the overlap check and insert, then keep an explicit proposed/accepted/reschedule/declined state so both partners can respond without double-booking the moment.
- Busy blocks carry a series id for daily, weekday, and weekly repeats; a whole series can be removed from the event dialog. Notes can be shared or private, can carry a reminder time, and due reminders appear in the activity panel.
- Commitments include a responsible person, exact deadline and integer KZT amount. A task assigned to the partner requires their acceptance. Server functions protect deadline, amount, acceptance, completion and recorded-payment timestamps. Declines, cancellations and waived penalties remain in history instead of disappearing.
- A completed commitment can be confirmed by the person who created it. The schedule includes a small seven-day reflection with shared moments, kept promises and open commitments.
- Late accepted commitments appear as penalties, including those completed after the deadline. Recording payment is bookkeeping only; no bank or payment processor is connected.
- Notes can be created, edited, pinned and deleted by either partner. Messages preserve direction and sender identity. Shared records refresh through Supabase Realtime with an eight-second fallback while the page is visible. Chat loads the latest 100 messages, can load earlier history, and shows unread counts until the conversation is opened.
- Sent pair requests can be cancelled and show a distinct cancelled status. Completed commitments can be confirmed by the person who created them. Settings supports password changes, a complete JSON export, and account deletion.
- A person can leave a shared space safely; the remaining partner keeps their account and space. The workspace shows an offline state and pauses writes until the connection returns.
- Important request, message and commitment changes appear in a quiet in-app activity panel. The site includes a small PWA manifest and shell cache for installable mobile use; writes still require a live connection.
- Activity items are persisted in Supabase and update in realtime. Chat messages written while offline wait in a user-scoped local outbox, keep their client id for idempotent retries, and show a visible sync count after reconnection.
- New accounts get a short first-run setup panel that points to shared hours, a first busy block, and day confirmation without blocking exploration.
- Desktop keeps notes and chat in a right column. Mobile uses six tabs. The sample workspace is ephemeral; real records live in Supabase, not browser storage. Supabase manages the login session in browser storage.
- No external calendar synchronization, automatic bank debit or server-side push notifications are claimed or configured.
- Shared plans can be labelled as a date, quick catch-up, errands, quiet time, or a recurring ritual. Weekly and monthly rituals are created atomically, and a responsible partner can request a deadline extension for the creator to accept or decline.
- Local quiet hours prevent notification badges and due-date reminders from interrupting the couple's chosen rest window. The preference is device-local by design; durable activity notifications remain available in the in-app panel.

## Development

Node 22.13 or newer is required.

```sh
npm ci
npm run dev
npm run build
npx tsc --noEmit
npm test
```

GitHub Actions runs the same lint, type-check, test, and build checks for every change to `main`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the local workflow and [SECURITY.md](SECURITY.md) for private reporting guidance.

On Windows hosts whose npm launcher cannot resolve paths containing spaces, run npm's JavaScript entry point directly:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run dev
```

Database tests run the actual migration on embedded PostgreSQL (PGlite) with Supabase-shaped auth roles. They check membership, invitation rotation/reuse, cross-pair RLS, impersonation, task ownership and consent, payment guards, and shared-window validation. They do not emulate Supabase Auth email delivery.

The app is built with React/TypeScript and the Sites Vinext Worker starter. `app/workspace.tsx` contains the six working surfaces; `app/auth-screen.tsx` contains account flows; `app/hadzar.tsx` coordinates session and onboarding; `lib/schedule.ts` implements window detection.

The root `proxy.ts` adds security headers to every application response. Keep the live deployment check in release validation: verify those headers, `/api/config`, and the Supabase schema before inviting real users.

## Design

Cold silver `#E8ECEF`, sheet `#F8FAFB`, person A `#58778D`, person B `#82708C`, together `#EAC64B`, responsibility `#9B4B5D`. Cormorant Garamond for expressive time and monetary figures; Golos Text for the interface. The shared window owns the sole saturated color surface.

## Privacy and notifications

The public repository contains application source only. Local `.env` files are ignored, and the app accepts only the Supabase publishable key in the browser. Real records are protected by Supabase Row Level Security and are not included in the sample workspace.

Hadzar currently provides durable in-app notifications, quiet hours, PWA shell caching, offline chat retry, optional device notifications for reminders, and optional TOTP MFA through Supabase Auth. It intentionally does not claim server-side Web Push, bank integrations, or external calendar synchronization until those services are configured and tested end to end.
