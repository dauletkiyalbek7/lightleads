-- Фаза 4. Лиды: ключ приёма заявок с сайта, исходные данные заявки и проверка формата телефона.

alter table public.leads
  -- Заявка в том виде, в каком её прислал сайт или вебхук: по ней разбирают спорные случаи
  add column raw_payload jsonb,
  -- Кто добавил лид вручную
  add column created_by uuid references public.profiles (id) on delete set null;
create index leads_created_by_idx on public.leads (created_by);

-- Телефон хранится только в E.164: по нему лид связывается с продажей
alter table public.leads add constraint leads_phone_e164 check (phone ~ '^\+[1-9][0-9]{6,14}$');

-- Ключ workspace для приёма лидов с сайта. По нему сервер понимает, чей это лид.
-- Ключ только добавляет лиды: прочитать по нему ничего нельзя.
create table public.ingest_keys (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  key          text not null unique default ('ws_' || encode(extensions.gen_random_bytes(16), 'hex')),
  created_at   timestamptz not null default now()
);
alter table public.ingest_keys enable row level security;
revoke all on public.ingest_keys from anon, authenticated;
grant select on public.ingest_keys to authenticated;
create policy ingest_keys_select on public.ingest_keys for select to authenticated using (private.is_member(workspace_id));

insert into public.ingest_keys (workspace_id) select id from public.workspaces on conflict do nothing;

create function private.create_ingest_key() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ingest_keys (workspace_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger workspaces_ingest_key after insert on public.workspaces
  for each row execute function private.create_ingest_key();
