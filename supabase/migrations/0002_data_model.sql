-- Фаза 1. Таблицы данных (PROMPT.md, раздел 12). У каждой есть workspace_id и RLS.
-- Сейчас участникам разрешено только чтение. Права записи добавляются в той фазе,
-- где появляется соответствующий экран; рекламные данные всегда пишет только сервер.

-- Курс НБРК: тенге за 1 USD на дату. Общий для всех workspace.
create table public.exchange_rates (
  date       date primary key,
  usd_kzt    numeric not null check (usd_kzt > 0),
  source     text not null default 'nbrk',
  fetched_at timestamptz not null default now()
);

create table public.ad_connections (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  platform           text not null check (platform in ('meta', 'tiktok')),
  status             text not null default 'active' check (status in ('active', 'token_expired', 'disconnected')),
  external_user_id   text,
  external_user_name text,
  scopes             text[] not null default '{}',
  token_expires_at   timestamptz,
  connected_by       uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Токены лежат отдельно и зашифрованы. Политик нет: читает только сервер, в браузер они не попадают.
create table public.ad_connection_secrets (
  connection_id           uuid primary key references public.ad_connections (id) on delete cascade,
  workspace_id            uuid not null references public.workspaces (id) on delete cascade,
  token_encrypted         text not null,
  refresh_token_encrypted text,
  updated_at              timestamptz not null default now()
);

create table public.ad_accounts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  connection_id  uuid not null references public.ad_connections (id) on delete cascade,
  platform       text not null check (platform in ('meta', 'tiktok')),
  external_id    text not null,
  name           text not null,
  currency       text not null check (currency in ('USD', 'KZT')),
  timezone       text not null default 'Asia/Almaty',
  status         text not null default 'active' check (status in ('active', 'token_expired')),
  -- Пользователь выбирает, какие кабинеты синхронизировать
  selected       boolean not null default true,
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (workspace_id, platform, external_id)
);

create table public.campaigns (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id   uuid not null references public.ad_accounts (id) on delete cascade,
  platform     text not null check (platform in ('meta', 'tiktok')),
  external_id  text not null,
  name         text not null,
  objective    text,
  status       text not null default 'active' check (status in ('active', 'paused')),
  daily_budget numeric,
  updated_at   timestamptz not null default now(),
  unique (account_id, external_id)
);

create table public.adsets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id  uuid not null references public.campaigns (id) on delete cascade,
  external_id  text not null,
  name         text not null,
  status       text not null default 'active' check (status in ('active', 'paused')),
  updated_at   timestamptz not null default now(),
  unique (campaign_id, external_id)
);

create table public.creatives (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  account_id     uuid not null references public.ad_accounts (id) on delete cascade,
  external_id    text not null,
  name           text not null,
  type           text not null check (type in ('video', 'image', 'carousel')),
  title          text not null default '',
  body           text not null default '',
  cta            text not null default '',
  -- Пути в Supabase Storage
  thumbnail_path text,
  video_path     text,
  duration_sec   int,
  updated_at     timestamptz not null default now(),
  unique (account_id, external_id)
);

create table public.ads (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id   uuid not null references public.ad_accounts (id) on delete cascade,
  campaign_id  uuid not null references public.campaigns (id) on delete cascade,
  adset_id     uuid not null references public.adsets (id) on delete cascade,
  creative_id  uuid references public.creatives (id) on delete set null,
  platform     text not null check (platform in ('meta', 'tiktok')),
  external_id  text not null,
  name         text not null,
  status       text not null default 'active' check (status in ('active', 'paused')),
  start_date   date,
  end_date     date,
  updated_at   timestamptz not null default now(),
  unique (account_id, external_id)
);

-- Статистика уровня «объявление × день» в валюте рекламного аккаунта
create table public.insights_daily (
  ad_id           uuid not null references public.ads (id) on delete cascade,
  date            date not null,
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  currency        text not null check (currency in ('USD', 'KZT')),
  spend           numeric not null default 0,
  impressions     bigint not null default 0,
  reach           bigint not null default 0,
  clicks          bigint not null default 0,
  -- Конверсии по данным пикселя: показываются отдельно от реальных продаж
  pixel_purchases int not null default 0,
  pixel_value     numeric not null default 0,
  video_plays     bigint not null default 0,
  video_3s        bigint not null default 0,
  video_hold      bigint not null default 0,
  video_watch_sec numeric not null default 0,
  primary key (ad_id, date)
);

create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Телефон в формате E.164: по нему лид связывается с продажей
  phone        text not null,
  name         text not null default '',
  source       text not null check (source in ('meta_form', 'tiktok_form', 'website', 'whatsapp', 'instagram', 'manual')),
  platform     text check (platform in ('meta', 'tiktok')),
  campaign_id  uuid references public.campaigns (id) on delete set null,
  adset_id     uuid references public.adsets (id) on delete set null,
  ad_id        uuid references public.ads (id) on delete set null,
  external_id  text,
  utm          jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create unique index leads_external_key on public.leads (workspace_id, source, external_id) where external_id is not null;

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null,
  price        numeric not null default 0 check (price >= 0),
  cost_type    text not null default 'amount' check (cost_type in ('amount', 'percent')),
  cost         numeric not null default 0 check (cost >= 0),
  archived_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table public.sales (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  phone         text not null,
  customer_name text not null default '',
  amount        numeric not null check (amount >= 0),
  currency      text not null check (currency in ('USD', 'KZT')),
  product_id    uuid references public.products (id) on delete set null,
  cost          numeric not null default 0 check (cost >= 0),
  sold_on       date not null,
  comment       text not null default '',
  input         text not null default 'manual' check (input in ('manual', 'csv', 'sheets', 'amocrm', 'bitrix24')),
  -- Источник, выбранный менеджером вручную, если лид по телефону не найден
  manual_ad_id  uuid references public.ads (id) on delete set null,
  external_id   text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table public.sale_attributions (
  sale_id      uuid primary key references public.sales (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id      uuid references public.leads (id) on delete set null,
  ad_id        uuid references public.ads (id) on delete set null,
  model        text not null check (model in ('last', 'first')),
  matched_by   text not null check (matched_by in ('phone', 'manual', 'none')),
  computed_at  timestamptz not null default now()
);

create table public.crm_connections (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider     text not null check (provider in ('amocrm', 'bitrix24')),
  status       text not null default 'active' check (status in ('active', 'token_expired', 'disconnected')),
  settings     jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create table public.crm_connection_secrets (
  connection_id   uuid primary key references public.crm_connections (id) on delete cascade,
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  token_encrypted text not null,
  updated_at      timestamptz not null default now()
);

create table public.sheet_connections (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  spreadsheet_id text not null,
  sheet_name     text not null default '',
  mapping        jsonb not null default '{}',
  status         text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  last_synced_at timestamptz,
  created_at     timestamptz not null default now()
);

create table public.ai_recommendations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind         text not null,
  priority     text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  title        text not null,
  body         text not null default '',
  action       text not null default '',
  entity_type  text,
  entity_id    uuid,
  status       text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at   timestamptz not null default now()
);

create table public.sync_runs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id   uuid not null references public.ad_accounts (id) on delete cascade,
  status       text not null check (status in ('running', 'success', 'error')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  rows         int not null default 0,
  error        text
);

create table public.audit_log (
  id           bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  details      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

-- Индексы под выборки по workspace и периоду и под внешние ключи
create index ad_connections_workspace_idx on public.ad_connections (workspace_id);
create index ad_connections_connected_by_idx on public.ad_connections (connected_by);
create index ad_connection_secrets_workspace_idx on public.ad_connection_secrets (workspace_id);
create index ad_accounts_connection_idx on public.ad_accounts (connection_id);
create index campaigns_workspace_idx on public.campaigns (workspace_id);
create index adsets_workspace_idx on public.adsets (workspace_id);
create index creatives_workspace_idx on public.creatives (workspace_id);
create index ads_workspace_idx on public.ads (workspace_id);
create index ads_campaign_idx on public.ads (campaign_id);
create index ads_adset_idx on public.ads (adset_id);
create index ads_creative_idx on public.ads (creative_id);
create index insights_daily_workspace_date_idx on public.insights_daily (workspace_id, date);
create index leads_workspace_phone_idx on public.leads (workspace_id, phone);
create index leads_workspace_created_idx on public.leads (workspace_id, created_at);
create index leads_campaign_idx on public.leads (campaign_id);
create index leads_adset_idx on public.leads (adset_id);
create index leads_ad_idx on public.leads (ad_id);
create index products_workspace_idx on public.products (workspace_id);
create index sales_workspace_sold_idx on public.sales (workspace_id, sold_on);
create index sales_workspace_phone_idx on public.sales (workspace_id, phone);
create index sales_product_idx on public.sales (product_id);
create index sales_manual_ad_idx on public.sales (manual_ad_id);
create index sales_created_by_idx on public.sales (created_by);
create index sale_attributions_workspace_idx on public.sale_attributions (workspace_id);
create index sale_attributions_lead_idx on public.sale_attributions (lead_id);
create index sale_attributions_ad_idx on public.sale_attributions (ad_id);
create index crm_connections_workspace_idx on public.crm_connections (workspace_id);
create index crm_connection_secrets_workspace_idx on public.crm_connection_secrets (workspace_id);
create index sheet_connections_workspace_idx on public.sheet_connections (workspace_id);
create index ai_recommendations_workspace_idx on public.ai_recommendations (workspace_id, status);
create index sync_runs_workspace_idx on public.sync_runs (workspace_id, started_at);
create index sync_runs_account_idx on public.sync_runs (account_id);
create index audit_log_workspace_idx on public.audit_log (workspace_id, created_at);
create index audit_log_actor_idx on public.audit_log (actor_id);

-- RLS: участник workspace читает его данные. Таблицы с секретами остаются без политик.
do $$
declare
  t text;
begin
  foreach t in array array[
    'ad_connections', 'ad_connection_secrets', 'ad_accounts', 'campaigns', 'adsets', 'creatives', 'ads',
    'insights_daily', 'leads', 'products', 'sales', 'sale_attributions', 'crm_connections',
    'crm_connection_secrets', 'sheet_connections', 'ai_recommendations', 'sync_runs', 'audit_log', 'exchange_rates'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;

  foreach t in array array[
    'ad_connections', 'ad_accounts', 'campaigns', 'adsets', 'creatives', 'ads', 'insights_daily', 'leads',
    'products', 'sales', 'sale_attributions', 'crm_connections', 'sheet_connections', 'ai_recommendations',
    'sync_runs', 'audit_log'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_member(workspace_id))',
      t || '_member_select', t
    );
  end loop;
end;
$$;

grant select on public.exchange_rates to authenticated;
create policy exchange_rates_select on public.exchange_rates for select to authenticated using (true);
