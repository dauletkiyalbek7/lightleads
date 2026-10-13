-- Фаза 4 (вторая часть). Лиды из Meta: лид-формы страниц Facebook и WhatsApp (Cloud API).

-- Страница Facebook с лид-формами или номер WhatsApp, подключённые к workspace.
-- Канал принадлежит одному workspace: лид с него не должен попасть в чужую компанию.
create table public.lead_channels (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind         text not null check (kind in ('meta_page', 'whatsapp')),
  -- ID страницы Facebook или ID номера WhatsApp (phone_number_id)
  external_id  text not null,
  -- Для номера WhatsApp — ID аккаунта WhatsApp Business, которому он принадлежит
  parent_id    text,
  name         text not null default '',
  -- Для номера WhatsApp — сам номер, как его показывает Meta
  detail       text not null default '',
  status       text not null default 'active' check (status in ('active', 'error')),
  -- Что пошло не так при последнем приёме лида, понятным текстом
  error        text,
  last_lead_at timestamptz,
  -- До какого момента лид-формы страницы уже дочитаны плановой проверкой
  polled_at    timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (kind, external_id)
);
create index lead_channels_workspace_idx on public.lead_channels (workspace_id);
create index lead_channels_created_by_idx on public.lead_channels (created_by);

-- Участник видит каналы своего workspace; подключает и убирает их только сервер
alter table public.lead_channels enable row level security;
revoke all on public.lead_channels from anon, authenticated;
grant select on public.lead_channels to authenticated;
create policy lead_channels_member_select on public.lead_channels for select to authenticated
  using (private.is_member(workspace_id));

-- ID объявления на платформе. Лид может прийти раньше, чем объявление загрузится из кабинета
-- (кабинеты обновляются раз в 2 часа): по этому ID он привяжется к объявлению позже.
alter table public.leads add column external_ad_id text;
create index leads_unlinked_idx on public.leads (workspace_id, external_ad_id)
  where ad_id is null and external_ad_id is not null;

-- Привязывает лиды без объявления к объявлениям, которые уже загрузились. Возвращает число привязанных.
create function public.relink_leads() returns integer
language sql
set search_path = ''
as $$
  with linked as (
    update public.leads l
    set ad_id = a.id, adset_id = a.adset_id, campaign_id = a.campaign_id, platform = a.platform
    from public.ads a
    where l.ad_id is null
      and l.external_ad_id is not null
      and a.workspace_id = l.workspace_id
      and a.external_id = l.external_ad_id
    returning 1
  )
  select count(*)::int from linked;
$$;

-- Вызывает только Edge Function с ключом сервера
revoke all on function public.relink_leads() from public, anon, authenticated;
grant execute on function public.relink_leads() to service_role;

-- Раз в час: дочитать лиды форм, которые не пришли уведомлением, и привязать лиды к новым объявлениям
select cron.schedule(
  'meta-leads',
  '22 * * * *',
  $job$
  select net.http_post(
    url := 'https://vhhfrnmuabdroeovlred.supabase.co/functions/v1/meta-leads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_secrets where name = 'cron_secret')
    ),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);
