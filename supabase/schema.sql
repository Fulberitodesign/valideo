-- Validéo : schéma Supabase
-- À exécuter une fois dans Supabase > SQL Editor.

-- 1. Espace de travail du monteur (toutes ses données, synchronisées entre appareils)
create table if not exists public.workspaces (
  owner uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
drop policy if exists "workspace du proprietaire" on public.workspaces;
create policy "workspace du proprietaire" on public.workspaces
  for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

-- 2. Espaces clients : un instantané par client, lisible uniquement via son lien secret
create table if not exists public.portals (
  token uuid primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  unique (owner, client_id)
);
alter table public.portals enable row level security;
drop policy if exists "portails du proprietaire" on public.portals;
create policy "portails du proprietaire" on public.portals
  for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

-- 3. Actions des clients (validation d'étape, commentaire, validation de média)
create table if not exists public.portal_actions (
  id bigint generated always as identity primary key,
  token uuid not null references public.portals(token) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('step', 'comment', 'approve')),
  payload jsonb not null,
  applied boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists portal_actions_owner_idx on public.portal_actions (owner, applied);
alter table public.portal_actions enable row level security;
drop policy if exists "actions lues par le proprietaire" on public.portal_actions;
create policy "actions lues par le proprietaire" on public.portal_actions
  for select to authenticated using (owner = auth.uid());
drop policy if exists "actions traitees par le proprietaire" on public.portal_actions;
create policy "actions traitees par le proprietaire" on public.portal_actions
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

-- 4. Accès client sans compte : uniquement par fonctions, avec le jeton secret
create or replace function public.get_portal(p_token uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'data', p.data,
    'pending', coalesce((select jsonb_agg(jsonb_build_object('type', a.type, 'payload', a.payload) order by a.id)
                         from portal_actions a where a.token = p.token and not a.applied), '[]'::jsonb))
  from portals p where p.token = p_token;
$$;

create or replace function public.portal_action(p_token uuid, p_type text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner into v_owner from portals where token = p_token;
  if v_owner is null then raise exception 'Espace client introuvable'; end if;
  if p_type not in ('step', 'comment', 'approve') then raise exception 'Action inconnue'; end if;
  if length(p_payload::text) > 8000 then raise exception 'Action trop volumineuse'; end if;
  if (select count(*) from portal_actions where token = p_token and created_at > now() - interval '1 hour') > 300 then
    raise exception 'Trop d''actions, réessayez plus tard';
  end if;
  insert into portal_actions (token, owner, type, payload) values (p_token, v_owner, p_type, p_payload);
end $$;

revoke all on function public.get_portal(uuid) from public;
revoke all on function public.portal_action(uuid, text, jsonb) from public;
grant execute on function public.get_portal(uuid) to anon, authenticated;
grant execute on function public.portal_action(uuid, text, jsonb) to anon, authenticated;

-- 5. Temps réel : le monteur est prévenu dès qu'un client agit
do $$ begin
  alter publication supabase_realtime add table public.portal_actions;
exception when duplicate_object then null; end $$;

-- 6. Stockage privé des médias et preuves de paiement (dossier = id du monteur)
insert into storage.buckets (id, name, public) values ('valideo-media', 'valideo-media', false)
on conflict (id) do nothing;

drop policy if exists "media lecture proprietaire" on storage.objects;
create policy "media lecture proprietaire" on storage.objects for select to authenticated
  using (bucket_id = 'valideo-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "media ajout proprietaire" on storage.objects;
create policy "media ajout proprietaire" on storage.objects for insert to authenticated
  with check (bucket_id = 'valideo-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "media modif proprietaire" on storage.objects;
create policy "media modif proprietaire" on storage.objects for update to authenticated
  using (bucket_id = 'valideo-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "media suppression proprietaire" on storage.objects;
create policy "media suppression proprietaire" on storage.objects for delete to authenticated
  using (bucket_id = 'valideo-media' and (storage.foldername(name))[1] = auth.uid()::text);
