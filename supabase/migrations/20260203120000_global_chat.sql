-- Global live chat (KeepItBased). Run in Supabase SQL editor or via CLI.
-- user_id references your app user integer (not Supabase auth.users).

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id integer not null,
  display_name text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint chat_messages_body_len check (char_length(trim(body)) between 1 and 2000)
);

create table if not exists public.chat_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id integer not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  constraint chat_reactions_emoji_len check (char_length(emoji) between 1 and 16),
  constraint chat_reactions_unique unique (message_id, user_id, emoji)
);

create index if not exists chat_messages_created_at_idx on public.chat_messages (created_at desc);
create index if not exists chat_reactions_message_id_idx on public.chat_reactions (message_id);

-- So Realtime DELETE payloads include message_id / user_id / emoji for clients
alter table public.chat_reactions replica identity full;

alter table public.chat_messages enable row level security;
alter table public.chat_reactions enable row level security;

-- Read-only for anon key (browser) so Realtime postgres_changes delivers rows.
drop policy if exists "chat_messages_select_all" on public.chat_messages;
create policy "chat_messages_select_all"
  on public.chat_messages for select
  to anon, authenticated
  using (true);

drop policy if exists "chat_reactions_select_all" on public.chat_reactions;
create policy "chat_reactions_select_all"
  on public.chat_reactions for select
  to anon, authenticated
  using (true);

-- Writes only via service_role (Node API) — no insert/update/delete policies for anon/authenticated.

-- Realtime publication (ignore errors if already member)
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.chat_reactions;
exception
  when duplicate_object then null;
end $$;
