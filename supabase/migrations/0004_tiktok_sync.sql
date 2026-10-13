-- Фаза 3. Подключение TikTok Ads: результат по цели оптимизации и плановое обновление.

-- «Конверсии» из отчёта TikTok: результаты по цели оптимизации группы объявлений
-- (для лид-кампаний это лиды по данным кабинета). У Meta такого единого числа нет, там остаётся 0.
alter table public.insights_daily add column conversions int not null default 0;

-- Каждые 2 часа обновляем статистику TikTok за последние 3 дня. Минута другая, чем у Meta,
-- чтобы обновления двух платформ не шли одновременно.
select cron.schedule(
  'tiktok-sync',
  '37 */2 * * *',
  $job$
  select net.http_post(
    url := 'https://vhhfrnmuabdroeovlred.supabase.co/functions/v1/tiktok-oauth',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_secrets where name = 'cron_secret')
    ),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);
