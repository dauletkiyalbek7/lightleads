-- Первый настоящий лид выключает демо-данные workspace, как и первый подключённый рекламный кабинет:
-- иначе лиды с сайта приходили бы в базу, а на экранах оставался бы демо-набор.
create function private.end_demo_on_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.workspaces set demo_data = false where id = new.workspace_id and demo_data;
  return new;
end;
$$;

create trigger leads_end_demo after insert on public.leads
  for each row execute function private.end_demo_on_lead();
