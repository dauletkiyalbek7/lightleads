-- Продажи из Telegram: менеджер нажимает «✅ Продажа» под заявкой в чате проекта и отвечает суммой.

alter table public.sales drop constraint sales_input_check;
alter table public.sales add constraint sales_input_check
  check (input in ('manual', 'csv', 'sheets', 'amocrm', 'bitrix24', 'telegram'));

-- Кто закрыл продажу, если внёс её не пользователь LightLeads, а менеджер в Telegram.
-- Браузер это поле не задаёт: в права на запись продаж (0008) оно не входит.
alter table public.sales add column seller_name text not null default '';

-- Вопрос бота «какая сумма?» по заявке: ответ на это сообщение записывается продажей по этому лиду. Только для сервера.
create table public.telegram_sale_prompts (
  chat_id      bigint not null,
  message_id   bigint not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id      uuid not null references public.leads (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (chat_id, message_id)
);
create index telegram_sale_prompts_workspace_idx on public.telegram_sale_prompts (workspace_id);
create index telegram_sale_prompts_lead_idx on public.telegram_sale_prompts (lead_id);
alter table public.telegram_sale_prompts enable row level security;
revoke all on public.telegram_sale_prompts from anon, authenticated;
