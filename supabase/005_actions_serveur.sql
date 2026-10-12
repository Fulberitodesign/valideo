-- Validéo : les actions des clients et des équipes sont appliquées par le serveur,
-- même quand l'application du prestataire est fermée.
-- Chaque action (validation, commentaire, version validée, correction, lien) met à jour
-- immédiatement les espaces de toutes les personnes invitées sur le même projet.
-- Le prestataire retrouve tout à sa prochaine connexion (l'action reste en file d'attente
-- jusqu'à ce que son application l'intègre à son espace de travail).

create or replace function public.apply_action_to_portals() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  src public.portals%rowtype;
  v_role text; v_actor text; v_pid text; v_mid text; v_day text := to_char(now(), 'YYYY-MM-DD');
  r record; d jsonb; p jsonb; m jsonb; c jsonb; l jsonb;
  pi int; si int; mi int; ci int;
begin
  select * into src from public.portals where token = new.token;
  if not found then return new; end if;

  v_role := coalesce(src.data -> 'who' ->> 'role', 'client');
  v_actor := coalesce(src.data -> 'who' ->> 'name', nullif(src.data -> 'clients' -> 0 ->> 'company', ''), src.data -> 'clients' -> 0 ->> 'name', 'Client');
  if v_role = 'equipe' and new.type in ('step', 'approve') then return new; end if;

  v_pid := new.payload ->> 'projectId';
  v_mid := new.payload ->> 'mediaId';
  if v_pid is null and v_mid is not null then
    select x ->> 'projectId' into v_pid from jsonb_array_elements(coalesce(src.data -> 'media', '[]')) x where x ->> 'id' = v_mid limit 1;
  end if;
  if v_pid is null then return new; end if;
  -- Le projet doit faire partie de l'espace de la personne qui agit
  if not exists (select 1 from jsonb_array_elements(coalesce(src.data -> 'projects', '[]')) x where x ->> 'id' = v_pid) then return new; end if;

  for r in
    select token, data from public.portals
    where owner = src.owner and exists (select 1 from jsonb_array_elements(coalesce(data -> 'projects', '[]')) x where x ->> 'id' = v_pid)
  loop
    d := r.data; pi := null; si := null; mi := null; ci := null; p := null; m := null;

    if new.type in ('step', 'link') then
      select (t.o - 1)::int, t.x into pi, p from jsonb_array_elements(d -> 'projects') with ordinality as t(x, o) where t.x ->> 'id' = v_pid;
      if pi is null then continue; end if;

      if new.type = 'step' then
        select (t.o - 1)::int into si from jsonb_array_elements(coalesce(p -> 'steps', '[]')) with ordinality as t(x, o) where t.x ->> 'id' = new.payload ->> 'stepId';
        if si is null then continue; end if;
        d := jsonb_set(d, array['projects', pi::text, 'steps', si::text, 'client'], to_jsonb(coalesce((new.payload ->> 'value')::boolean, false)));
        d := jsonb_set(d, array['projects', pi::text, 'steps', si::text, 'clientAt'],
               case when coalesce((new.payload ->> 'value')::boolean, false) then to_jsonb(coalesce(new.payload ->> 'date', v_day)) else 'null'::jsonb end);
      else
        l := new.payload -> 'link';
        if l is null or coalesce(l ->> 'url', '') !~* '^https?://[^\s"''<>]+$' then continue; end if;
        if exists (select 1 from jsonb_array_elements(coalesce(p -> 'links', '[]')) x where x ->> 'id' = l ->> 'id') then continue; end if;
        d := jsonb_set(d, array['projects', pi::text, 'links'], coalesce(p -> 'links', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'id', l ->> 'id', 'url', l ->> 'url', 'title', left(coalesce(l ->> 'title', ''), 140), 'note', left(coalesce(l ->> 'note', ''), 200),
               'at', coalesce(l ->> 'at', now()::text), 'by', v_actor, 'role', case v_role when 'equipe' then 'team' else 'client' end)));
      end if;

    else
      select (t.o - 1)::int, t.x into mi, m from jsonb_array_elements(coalesce(d -> 'media', '[]')) with ordinality as t(x, o) where t.x ->> 'id' = v_mid;
      if mi is null then continue; end if;

      if new.type = 'comment' then
        c := new.payload -> 'comment';
        if c is null or exists (select 1 from jsonb_array_elements(coalesce(m -> 'comments', '[]')) x where x ->> 'id' = c ->> 'id') then continue; end if;
        d := jsonb_set(d, array['media', mi::text, 'comments'], coalesce(m -> 'comments', '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
               'id', c ->> 'id', 'v', (c ->> 'v')::numeric, 't', (c ->> 't')::numeric, 'x', (c ->> 'x')::numeric, 'y', (c ->> 'y')::numeric,
               'text', left(coalesce(c ->> 'text', ''), 2000), 'at', coalesce(c ->> 'at', now()::text),
               'author', case v_role when 'equipe' then 'team' else 'client' end, 'by', v_actor, 'resolved', false))));
      elsif new.type = 'approve' then
        if coalesce((new.payload ->> 'value')::boolean, true) then
          d := jsonb_set(d, array['media', mi::text, 'approvedV'], to_jsonb((new.payload ->> 'v')::numeric));
          d := jsonb_set(d, array['media', mi::text, 'approvedAt'], to_jsonb(coalesce(new.payload ->> 'date', v_day)));
        else
          d := jsonb_set(d, array['media', mi::text, 'approvedV'], 'null'::jsonb);
          d := jsonb_set(d, array['media', mi::text, 'approvedAt'], 'null'::jsonb);
        end if;
      elsif new.type = 'resolve' then
        select (t.o - 1)::int into ci from jsonb_array_elements(coalesce(m -> 'comments', '[]')) with ordinality as t(x, o) where t.x ->> 'id' = new.payload ->> 'commentId';
        if ci is null then continue; end if;
        d := jsonb_set(d, array['media', mi::text, 'comments', ci::text, 'resolved'], to_jsonb(coalesce((new.payload ->> 'value')::boolean, false)));
      end if;
    end if;

    update public.portals set data = d, updated_at = now() where token = r.token;
  end loop;
  return new;
end $$;

drop trigger if exists portal_actions_apply on public.portal_actions;
create trigger portal_actions_apply after insert on public.portal_actions
  for each row execute function public.apply_action_to_portals();
