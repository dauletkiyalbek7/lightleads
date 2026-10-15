-- Новые заявки в Telegram и лиды из Google-таблицы.

-- Google-таблица — отдельный источник: строки присылает скрипт таблицы через тот же адрес приёма, что и сайт
alter table public.leads drop constraint leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('meta_form', 'tiktok_form', 'website', 'whatsapp', 'instagram', 'manual', 'sheet'));

-- Чат Telegram (личный или группа), куда бот LightLeads присылает новые заявки проекта.
-- Один чат может получать заявки нескольких проектов: в сообщении указан проект.
create table public.telegram_chats (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  chat_id      bigint not null,
  -- Название группы или имя человека, как их показывает Telegram
  title        text not null default '',
  kind         text not null check (kind in ('private', 'group')),
  status       text not null default 'active' check (status in ('active', 'error')),
  -- Почему последняя заявка не дошла, понятным текстом
  error        text,
  last_sent_at timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (workspace_id, chat_id)
);
create index telegram_chats_chat_idx on public.telegram_chats (chat_id);
create index telegram_chats_created_by_idx on public.telegram_chats (created_by);

-- Участник видит чаты своего проекта; подключает и убирает их только сервер
alter table public.telegram_chats enable row level security;
revoke all on public.telegram_chats from anon, authenticated;
grant select on public.telegram_chats to authenticated;
create policy telegram_chats_member_select on public.telegram_chats for select to authenticated
  using (private.is_member(workspace_id));

-- Одноразовый код из ссылки на бота: по нему бот понимает, к какому проекту подключить чат.
-- Только для сервера.
create table public.telegram_link_codes (
  code         text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by   uuid references public.profiles (id) on delete cascade,
  expires_at   timestamptz not null
);
create index telegram_link_codes_workspace_idx on public.telegram_link_codes (workspace_id);
create index telegram_link_codes_created_by_idx on public.telegram_link_codes (created_by);
alter table public.telegram_link_codes enable row level security;
revoke all on public.telegram_link_codes from anon, authenticated;

-- Заявки, которые ещё не отправлены в Telegram. Только для сервера.
create table public.telegram_queue (
  lead_id      uuid primary key references public.leads (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  queued_at    timestamptz not null default now()
);
create index telegram_queue_workspace_idx on public.telegram_queue (workspace_id, queued_at);
alter table public.telegram_queue enable row level security;
revoke all on public.telegram_queue from anon, authenticated;

-- Новая заявка встаёт в очередь, если у проекта есть чат Telegram.
-- Не отправляем лиды, добавленные вручную (их автор уже знает о них), и старые заявки,
-- которые подгрузились задним числом: из прошлого месяца лид-форм или из истории таблицы.
create function private.queue_telegram_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.source <> 'manual'
     and new.created_at > now() - interval '1 day'
     and exists (select 1 from public.telegram_chats c where c.workspace_id = new.workspace_id and c.status = 'active')
  then
    insert into public.telegram_queue (lead_id, workspace_id) values (new.id, new.workspace_id) on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger leads_telegram_notice after insert on public.leads
  for each row execute function private.queue_telegram_notice();

-- Раз в минуту, и только когда в очереди что-то есть: отправить новые заявки в Telegram
select cron.schedule(
  'telegram-leads',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://vhhfrnmuabdroeovlred.supabase.co/functions/v1/telegram',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_secrets where name = 'cron_secret')
    ),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 60000
  )
  where exists (select 1 from public.telegram_queue);
  $job$
);
