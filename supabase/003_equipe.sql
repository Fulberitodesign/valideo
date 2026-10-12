-- Validéo : invitations personnelles et membres d'équipe
-- Ajoute l'action « resolve » (un membre d'équipe marque un commentaire corrigé).

alter table public.portal_actions drop constraint if exists portal_actions_type_check;
alter table public.portal_actions add constraint portal_actions_type_check
  check (type in ('step', 'comment', 'approve', 'resolve'));

create or replace function public.portal_action(p_token uuid, p_type text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner into v_owner from portals where token = p_token;
  if v_owner is null then raise exception 'Lien introuvable'; end if;
  if p_type not in ('step', 'comment', 'approve', 'resolve') then raise exception 'Action inconnue'; end if;
  if length(p_payload::text) > 8000 then raise exception 'Action trop volumineuse'; end if;
  if (select count(*) from portal_actions where token = p_token and created_at > now() - interval '1 hour') > 300 then
    raise exception 'Trop d''actions, réessayez plus tard';
  end if;
  insert into portal_actions (token, owner, type, payload) values (p_token, v_owner, p_type, p_payload);
end $$;

revoke all on function public.portal_action(uuid, text, jsonb) from public;
grant execute on function public.portal_action(uuid, text, jsonb) to anon, authenticated;
