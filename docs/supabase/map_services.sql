-- Map connections (#267): each user's web map and feature services and layer sets, so they follow the user to any
-- computer. Apply once to the MyStudioReel suite project (SQL editor, or `supabase db push` from the suite repo).
-- No secrets here: API keys and tokens stay in Windows Credential Manager on each computer.

create table if not exists public.map_services (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  app        text not null,                              -- MyModellerReel (other Reel apps may share the table)
  name       text not null,                              -- the user's name for the service or layer set
  kind       text not null check (kind in ('wmts', 'wms', 'wfs', 'ogcapi', 'ogcapi-features', 'xyz', 'layer-set')),
  url        text not null default '',
  config     jsonb not null default '{}',                -- layers, styles, defaults; a layer set's OWS Context document
  updated_at timestamptz not null default now(),
  primary key (user_id, app, name),
  constraint map_services_config_size check (pg_column_size(config) < 1000000)
);

alter table public.map_services enable row level security;

drop policy if exists "own map services" on public.map_services;
create policy "own map services" on public.map_services for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
