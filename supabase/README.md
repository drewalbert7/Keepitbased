# Supabase (global live chat)

## 1. Create a project

1. [Supabase](https://supabase.com) → New project → note **Project URL** and **anon** + **service_role** keys (Settings → API).

## 2. Apply schema

**Option A — SQL Editor (no extra secrets):** open `migrations/20260203120000_global_chat.sql`, copy all, SQL Editor → Run.

**Option B — one command from this repo:** in `backend/.env` you already have `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Add the **database password** from Supabase → **Settings → Database** (the Postgres password for the project):

```env
SUPABASE_DB_PASSWORD=your_database_password
```

Then:

```bash
cd backend && npm run setup:supabase-chat
```

That runs the migration via `psql` against `db.<project-ref>.supabase.co`, then verifies tables. If your network does not support IPv6, use Option A or set `SUPABASE_DB_URL` to the **Session pooler** URI from the same Database screen instead of the password shortcut.

**Option C — full URI only:** set `SUPABASE_DB_URL` to the connection string (Session or Direct), then `npm run migrate:supabase-chat`.

**Option D:** Supabase CLI `db push` / `db query --linked` if the project is linked.

## 3. Confirm Realtime

Dashboard → **Database** → **Replication** → ensure `chat_messages` and `chat_reactions` are enabled for **Realtime** (Supabase may auto-enable after `alter publication`).

## 4. App environment

Copy keys when you have them (placeholders are already in the repo templates):

| Variable | File(s) |
|----------|---------|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `backend/.env` (copy from `backend/.env.example`) or `config/environment/.env.template` |
| `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY` | `frontend/.env.development` / `frontend/.env.production` / `.env.local` — see `frontend/.env.example` |

**Backend** (`backend/.env`):

- `SUPABASE_URL=https://xxxx.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=` legacy JWT (`eyJ…`) or new secret (`sb_secret_…`) from the same API screen (server only)

**Frontend** (`frontend/.env` or `.env.local`):

- `REACT_APP_SUPABASE_URL` = same project URL
- `REACT_APP_SUPABASE_ANON_KEY` = **anon** JWT or **`sb_publishable_…`** public key

Chat **posts** always go through `POST /api/chat/*` (JWT + service role). The browser only uses the anon key for **Realtime subscriptions** and read policies above.
