-- Validéo : offres et administration
-- À exécuter après schema.sql, dans Supabase > SQL Editor.

-- 1. Profil de chaque utilisateur : son offre et son rôle
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan text not null default 'decouverte' check (plan in ('decouverte', 'solo', 'pro', 'studio')),
  plan_until date,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profil lisible par son proprietaire" on public.profiles;
create policy "profil lisible par son proprietaire" on public.profiles
  for select to authenticated using (id = auth.uid());
-- Aucune règle de modification : un utilisateur ne peut pas changer lui-même son offre.

-- 2. Adresse de l'administrateur
create or replace function public.admin_email() returns text language sql immutable as $$ select 'contactfulbert1@gmail.com'::text $$;

create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- 3. Création automatique du profil à l'inscription
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, is_admin, plan)
  values (new.id, new.email, lower(new.email) = admin_email(),
          case when lower(new.email) = admin_email() then 'studio' else 'decouverte' end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Comptes déjà existants
insert into public.profiles (id, email, is_admin, plan)
select id, email, lower(email) = public.admin_email(),
       case when lower(email) = public.admin_email() then 'studio' else 'decouverte' end
from auth.users
on conflict (id) do update set is_admin = excluded.is_admin or public.profiles.is_admin;

-- 4. Fonctions réservées à l'administrateur
create or replace function public.admin_list_users()
returns table (id uuid, email text, plan text, plan_until date, is_admin boolean, created_at timestamptz,
               last_sign_in_at timestamptz, confirmed boolean, clients int, projects int, synced_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Accès réservé à l''administrateur'; end if;
  return query
    select p.id, p.email, p.plan, p.plan_until, p.is_admin, p.created_at, u.last_sign_in_at,
           u.email_confirmed_at is not null,
           coalesce(jsonb_array_length(w.data -> 'clients'), 0),
           coalesce(jsonb_array_length(w.data -> 'projects'), 0),
           w.updated_at
    from profiles p join auth.users u on u.id = p.id
    left join workspaces w on w.owner = p.id
    order by p.created_at desc;
end $$;

create or replace function public.admin_set_plan(p_user uuid, p_plan text, p_until date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Accès réservé à l''administrateur'; end if;
  if p_plan not in ('decouverte', 'solo', 'pro', 'studio') then raise exception 'Offre inconnue'; end if;
  update profiles set plan = p_plan, plan_until = p_until where id = p_user;
end $$;

revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_set_plan(uuid, text, date) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_plan(uuid, text, date) to authenticated;
grant execute on function public.is_admin() to authenticated;
