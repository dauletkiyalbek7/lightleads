-- Большие рекламные кабинеты (сотни кампаний, тысячи объявлений): структура читается порциями,
-- а превью скачиваются только для объявлений, которые показывались.

-- Место, на котором остановился обход структуры кабинета (кампании → группы → объявления).
-- Пусто — обход закончен, следующий начнётся с начала.
alter table public.ad_accounts add column sync_cursor text;

-- Очередь превью: креативы без картинки, у которых есть работающее объявление или статистика.
-- Креативы старых объявлений без показов не скачиваем: их тысячи, а на экранах их нет.
-- total — размер всей очереди, чтобы показать, сколько осталось.
create function public.pending_thumbnails(p_account uuid, p_limit int)
returns table (id uuid, external_id text, type text, total bigint)
language sql
stable
set search_path = ''
as $$
  with pending as (
    select c.id, c.external_id, c.type
    from public.creatives c
    where c.account_id = p_account
      and c.thumbnail_path is null
      and exists (
        select 1
        from public.ads a
        where a.creative_id = c.id
          and (a.status = 'active' or exists (select 1 from public.insights_daily i where i.ad_id = a.id))
      )
  )
  select p.id, p.external_id, p.type, count(*) over ()
  from pending p
  order by p.id
  limit p_limit;
$$;

-- Вызывает только Edge Function с ключом сервера
revoke all on function public.pending_thumbnails(uuid, int) from public, anon, authenticated;
grant execute on function public.pending_thumbnails(uuid, int) to service_role;
