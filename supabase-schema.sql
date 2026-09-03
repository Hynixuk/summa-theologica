-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Sets up cross-device sync storage for the Summa Theologica reader app:
-- one row per signed-in user, holding their read-progress markers, quiz
-- best-scores, and last reading/audio position (mirrors the three
-- localStorage keys the app already uses: summa-read, summa-quiz-scores,
-- summa-session).

create table if not exists public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  read_keys jsonb not null default '[]'::jsonb,
  quiz_scores jsonb not null default '{}'::jsonb,
  session jsonb,
  updated_at timestamptz not null default now()
);

-- Row Level Security: every signed-in user can only ever read or write
-- their OWN row. This is what makes the anon public API key safe to embed
-- in client-side code - the key alone grants no access, only a valid
-- logged-in session for the matching user_id does.
alter table public.user_progress enable row level security;

create policy "Users can view their own progress"
  on public.user_progress for select
  using (auth.uid() = user_id);

create policy "Users can insert their own progress"
  on public.user_progress for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own progress"
  on public.user_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep updated_at current on every write, so the app can tell which side
-- (local vs. remote) is newer when merging after a login on a new device.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_progress_set_updated_at on public.user_progress;
create trigger user_progress_set_updated_at
  before update on public.user_progress
  for each row execute function public.set_updated_at();
