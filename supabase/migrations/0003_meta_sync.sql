-- Фаза 2. Подключение Meta: недостающие поля, хранилище превью и плановое обновление.

-- Одно подключение на платформу в workspace: повторный вход обновляет токен
create unique index ad_connections_workspace_platform_key on public.ad_connections (workspace_id, platform);

-- Статус кабинета в самой Meta (1 — активен)
alter table public.ad_accounts add column external_status int;

-- Действия из отчётов Meta: лиды и начатые переписки по данным кабинета
alter table public.insights_daily
  add column platform_leads int not null default 0,
  add column messaging_started int not null default 0;

-- Превью креативов. Ссылки Meta живут недолго, поэтому картинки копируются сюда.
-- Бакет публичный на чтение: путь содержит случайные UUID workspace и креатива.
insert into storage.buckets (id, name, public) values ('creatives', 'creatives', true) on conflict (id) do nothing;

-- Служебные секреты сервера. Политик нет: читает только сервисная роль.
create table public.app_secrets (
  name       text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
insert into public.app_secrets (name, value) values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex'));

-- Каждые 2 часа обновляем статистику за последние 3 дня: Meta пересчитывает её задним числом
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'meta-sync',
  '7 */2 * * *',
  $job$
  select net.http_post(
    url := 'https://vhhfrnmuabdroeovlred.supabase.co/functions/v1/meta-oauth',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_secrets where name = 'cron_secret')
    ),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);
