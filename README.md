# Household Budget Tracker

A small self-hosted app for tracking a shared monthly budget. Anyone with
access can log a transaction (amount, date, description, store, and who entered it),
and the app subtracts it from that month's budget.

- **Backend:** Node.js + Express + SQLite (via `better-sqlite3`), single file (`server.js`)
- **Frontend:** plain HTML/CSS/JS, no build step (`public/`)
- **Storage:** one SQLite file on disk, persisted through a Docker volume

## Running it

You need Docker and Docker Compose installed on your server/NAS.

```bash
docker compose up -d --build
```

The app will be available at `http://<your-server>:3000`. Data is stored in
`./data/budget.db` on the host, so it survives container rebuilds/restarts.

To stop it: `docker compose down` (data is untouched since it lives in the
`./data` folder, not inside the container).

### Running without Docker (optional, for local testing)

```bash
npm install
npm start
```

This requires build tools for `better-sqlite3` to compile (`python3`,
`make`, `g++`) if a prebuilt binary isn't available for your platform.

## First-time setup

1. Open the app in a browser.
2. Click **Manage people** and add the names of everyone who'll be logging
   transactions (e.g. "Alex", "Jordan").
3. Click **Set budget for this month** and enter your monthly budget.
4. Start logging transactions. Enter a positive amount for money spent, or a
   negative amount for a refund/extra income.

The Store field suggests stores you've entered before (any month) as you
type — pick one with the arrow keys and Enter. Type a store that doesn't
exist yet and you'll be asked whether to add it; declining cancels the entry.

Below the ledger, a **Spent by store** list shows each store's net total for
the month on screen (stores are matched case-insensitively; transactions
without a store appear as "No store"), largest first.

Each calendar month gets its own budget — use the arrows next to the month
name to set a different budget or review past months. Past transactions and
budgets aren't deleted when the month changes.

## Exposing it externally with Cloudflare

The app itself has no login system — it relies on Cloudflare in front of it
for both access control and identity. The general shape:

1. **Cloudflare Tunnel** — install `cloudflared` on the same machine (or
   Docker network) as this app and create a tunnel pointing at
   `http://localhost:3000`. This gets you a public hostname without opening
   any ports on your router.
2. **Cloudflare Access** — put that hostname behind an Access application
   and set up a policy (e.g. "allow these specific email addresses" or
   "allow anyone with a @yourdomain.com email"). This is what actually gates
   who can reach the app — there's no separate login screen in the app
   itself.
3. **Identity passthrough (optional)** — when Access is in front of the app,
   it adds a `Cf-Access-Authenticated-User-Email` header to every request.
   The app reads this header and, if the email matches a name you've added
   under **Manage people**, pre-selects that person in the "Entered by"
   dropdown. This is a convenience only, not enforced — anyone who can reach
   the app can still pick any name from the dropdown, since the app doesn't
   have per-user passwords. If you want the header to strictly determine who
   gets credited (rather than just pre-filling the dropdown), that's a small
   follow-up change to `server.js` (use `req.accessIdentity` directly instead
   of trusting `req.body.user`).

Cloudflare's own docs walk through both pieces in detail:
- Tunnels: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/
- Access: https://developers.cloudflare.com/cloudflare-one/policies/access/

## Notes / things you might want to extend

- There's no authentication inside the app itself — it's meant to sit behind
  Cloudflare Access. Don't expose port 3000 directly to the internet without
  something in front of it.
- Deleting a transaction first shows a confirmation dialog with the entry's
  date, store, description, amount, and who entered it, so entries can't be
  removed by accident. Cancel or clicking outside the dialog keeps the entry.
- Transactions can't be edited after they're added, only deleted and
  re-entered — this was left out to keep the first version simple.
- The `data/` folder is the entire database. Back it up by copying
  `data/budget.db` (and the `-wal`/`-shm` files if present) periodically.
