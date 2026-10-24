-- Карточка лида: комментарий менеджера и привязка заявок к объявлениям, которые загрузились позже заявки.

-- Комментарий к лиду пишут участники проекта прямо из браузера; остальные колонки лида им менять нельзя
alter table public.leads add column note text not null default '';
grant update (note) on public.leads to authenticated;
create policy leads_member_update_note on public.leads
  for update to authenticated
  using (private.is_member(workspace_id))
  with check (private.is_member(workspace_id));

-- Лид, пришедший раньше своего объявления, привязывался ежечасным relink_leads (0009). Новый кабинет
-- догружается частями несколько часов, поэтому лид привязывается сразу, как только объявление появилось.

create or replace function private.link_waiting_leads() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.leads l
     set ad_id = a.id, adset_id = a.adset_id, campaign_id = a.campaign_id, platform = a.platform
    from inserted a
   where l.ad_id is null
     and l.workspace_id = a.workspace_id
     and l.external_ad_id = a.external_id;
  return null;
end;
$$;
revoke all on function private.link_waiting_leads() from public;

create trigger ads_link_waiting_leads
  after insert on public.ads
  referencing new table as inserted
  for each statement execute function private.link_waiting_leads();

-- Лиды, которые уже ждут своё объявление
select public.relink_leads();
