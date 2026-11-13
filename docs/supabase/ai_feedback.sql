-- Copilot feedback (#232): rated copilot turns that users chose to share, to train a specialised modelling agent.
-- Apply once to the MyStudioReel suite project (SQL editor, or `supabase db push` from the suite repo).
-- Each row is one turn: the request, the commands the copilot ran with their results, its answer, the model before and
-- after (no PDF / image bytes), and the user's verdict. The app inserts as the signed-in user; row-level security keeps
-- each user to their own rows. Training jobs read with the service role key, which bypasses RLS.

create table if not exists public.ai_feedback (
  id          text primary key,                         -- the app's turn id (re-sharing the same turn is a no-op 409)
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  app         text not null,                            -- MyModellerReel (other Reel apps may share the table)
  app_version text,
  created_at  timestamptz not null default now(),
  rating      text not null check (rating in ('good', 'bad')),
  comment     text not null default '',
  tags        text[] not null default '{}',
  provider    text,
  model       text,
  prompt      text,
  record      jsonb not null,                           -- the whole training record (src/core/feedback.js, schema 1)
  constraint ai_feedback_record_size check (pg_column_size(record) < 4000000)
);

create index if not exists ai_feedback_created on public.ai_feedback (created_at desc);
create index if not exists ai_feedback_rating on public.ai_feedback (app, rating);

alter table public.ai_feedback enable row level security;

drop policy if exists "insert own feedback" on public.ai_feedback;
create policy "insert own feedback" on public.ai_feedback for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "read own feedback" on public.ai_feedback;
create policy "read own feedback" on public.ai_feedback for select to authenticated using (user_id = auth.uid());

drop policy if exists "delete own feedback" on public.ai_feedback;
create policy "delete own feedback" on public.ai_feedback for delete to authenticated using (user_id = auth.uid());
