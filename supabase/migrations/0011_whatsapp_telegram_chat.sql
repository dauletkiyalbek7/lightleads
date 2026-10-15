-- Переписка с клиентами WhatsApp через Telegram: сообщения клиентов приходят в чат проекта,
-- ответ менеджера на такое сообщение уходит клиенту с номера компании.

-- О каком клиенте сообщение бота в чате Telegram. Только для сервера.
create table public.telegram_threads (
  chat_id      bigint not null,
  message_id   bigint not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Номер WhatsApp компании, с которого отвечать
  channel_id   uuid not null references public.lead_channels (id) on delete cascade,
  -- Номер клиента: только цифры, с кодом страны
  wa_id        text not null,
  created_at   timestamptz not null default now(),
  primary key (chat_id, message_id)
);
create index telegram_threads_workspace_idx on public.telegram_threads (workspace_id);
create index telegram_threads_channel_idx on public.telegram_threads (channel_id);
alter table public.telegram_threads enable row level security;
revoke all on public.telegram_threads from anon, authenticated;

-- Сообщения WhatsApp, которые уже обработаны: Meta может прислать одно и то же повторно. Только для сервера.
create table public.whatsapp_seen (
  message_id   text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  received_at  timestamptz not null default now()
);
create index whatsapp_seen_workspace_idx on public.whatsapp_seen (workspace_id);
alter table public.whatsapp_seen enable row level security;
revoke all on public.whatsapp_seen from anon, authenticated;

-- Заявки WhatsApp присылает в Telegram сама функция `meta-leads` сразу, вместе с перепиской:
-- в общую очередь они не попадают, иначе пришли бы дважды.
create or replace function private.queue_telegram_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.source not in ('manual', 'whatsapp')
     and new.created_at > now() - interval '1 day'
     and exists (select 1 from public.telegram_chats c where c.workspace_id = new.workspace_id and c.status = 'active')
  then
    insert into public.telegram_queue (lead_id, workspace_id) values (new.id, new.workspace_id) on conflict do nothing;
  end if;
  return new;
end;
$$;
