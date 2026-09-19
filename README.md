# hadzar

A shared space for two people with busy lives. English UI, individual email/password accounts, chosen names and unique nicknames, and invitation-only pair membership.

## Current status

The app and Supabase database schema are implemented. A clearly labelled, in-memory sample workspace is available while the backend is not configured. It is not a substitute for registration: no sample data is saved and no accounts are faked.

Live email delivery, signup, password recovery, and cross-device synchronization must be verified after a real Supabase project is connected. Sites currently hosts an owner-private review version; opening registration to other couples also requires changing the Site audience to public. Application data remains private through database Row Level Security.

## Connect Supabase

1. Create a Supabase project at https://supabase.com/dashboard.
2. Run `supabase/migrations/202609140001_hadzar.sql` once in its SQL Editor, then run `supabase/migrations/202609190001_pair_requests.sql`. The second migration adds nickname-based requests with Accept/Decline actions for people who already have accounts. Run each migration once, in filename order; do not rerun an already applied migration.
3. In Authentication, enable Email and password, require email confirmation, and set a minimum password length of 8 or greater.
4. Set Site URL to the final hadzar URL. Allow that origin's root, invitation query URLs, and `/?recovery=1` as authentication redirect URLs. For local development allow `http://localhost:5173/**` as well. Use exact production-origin patterns, not an unrestricted global wildcard.
5. Configure custom SMTP for confirmations and password resets before public registration. Supabase's default mail service is for testing and limits recipients/delivery.
6. Copy the Project URL and Publishable key (or legacy anon key). No service-role key is used by this app.
7. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.env` for local development. Set the same two hosted runtime values through Sites before publishing the connected version. The config endpoint deliberately rejects privileged keys.
8. Register two test accounts, confirm both emails, create a pair with one, create its invitation link, and join using the second. Test a third unrelated account to confirm pair isolation. Verify password reset and reloading saved data on another device before inviting real couples.

Supabase documentation: https://supabase.com/docs/guides/auth/passwords and https://supabase.com/docs/guides/database/postgres/row-level-security.

## Product behavior

- Each person has their own email/password account and profile. Nicknames use 3–24 letters, numbers, or underscores and are unique (normalized to lowercase).
- A person can belong to one pair. A pair holds at most two people. Invitations expire after seven days, are stored as SHA-256 hashes, and are consumed on joining. Rotating an invitation invalidates the old one. People with existing accounts can also send a request by nickname; the recipient can accept or decline it from the shared workspace banner.
- Add busy blocks in the pair's timezone. Both partners must confirm the selected day's schedule before free windows appear. The algorithm unions busy intervals, applies the shared buffer, clips to shared hours, and filters by minimum duration.
- Shared plans recheck both confirmations and overlapping events in the database before saving.
- Commitments include a responsible person, exact deadline and integer KZT amount. A task assigned to the partner requires their acceptance. Server functions protect deadline, amount, acceptance, completion and recorded-payment timestamps.
- Late accepted commitments appear as penalties, including those completed after the deadline. Recording payment is bookkeeping only; no bank or payment processor is connected.
- Notes can be created, edited, pinned and deleted by either partner. Messages preserve direction and sender identity. Data refreshes every eight seconds while the page is visible. Chat loads the latest 100 messages and can load earlier history.
- Desktop keeps notes and chat in a right column. Mobile uses six tabs. The sample workspace is ephemeral; real records live in Supabase, not browser storage. Supabase manages the login session in browser storage.
- No external calendar synchronization, automatic bank debit or push notifications are claimed or configured.

## Development

Node 22.13 or newer is required.

```sh
npm ci
npm run dev
npm run build
npx tsc --noEmit
node tests/schedule.mjs
node tests/database.mjs
```

On Windows hosts whose npm launcher cannot resolve paths containing spaces, run npm's JavaScript entry point directly:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run dev
```

Database tests run the actual migration on embedded PostgreSQL (PGlite) with Supabase-shaped auth roles. They check membership, invitation rotation/reuse, cross-pair RLS, impersonation, task ownership and consent, payment guards, and shared-window validation. They do not emulate Supabase Auth email delivery.

The app is built with React/TypeScript and the Sites Vinext Worker starter. `app/workspace.tsx` contains the six working surfaces; `app/auth-screen.tsx` contains account flows; `app/hadzar.tsx` coordinates session and onboarding; `lib/schedule.ts` implements window detection.

## Design

Cold silver `#E8ECEF`, sheet `#F8FAFB`, person A `#58778D`, person B `#82708C`, together `#EAC64B`, responsibility `#9B4B5D`. Cormorant Garamond for expressive time and monetary figures; Golos Text for the interface. The shared window owns the sole saturated color surface.
