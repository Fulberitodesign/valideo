-- Validéo : paiements des abonnements via Moneroo (Mobile Money et carte bancaire)
-- Les lignes sont créées et validées uniquement par les fonctions serveur (clé de service),
-- jamais directement par le navigateur.

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'moneroo',
  provider_id text unique,
  plan text not null check (plan in ('solo', 'pro', 'studio')),
  period text not null check (period in ('month', 'year')),
  method text,
  amount integer not null,
  currency text not null default 'XOF',
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'cancelled', 'mismatch')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);
alter table public.payments enable row level security;

drop policy if exists "paiements visibles par leur auteur ou l'admin" on public.payments;
create policy "paiements visibles par leur auteur ou l'admin" on public.payments
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- Aucune règle d'écriture : seules les fonctions serveur (clé de service) écrivent dans cette table.
