-- Фаза 1. Пользователи, workspace и участники. Изоляция данных — через RLS.
-- Аккаунты создаёт только сервер (Edge Function `team`): регистрации нет, вход по приглашению.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text not null,
  full_name         text not null default '',
  -- Владелец платформы: создаёт workspace и выдаёт доступы клиентам
  is_platform_admin boolean not null default false,
  created_at        timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));

create table public.workspaces (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(trim(name)) > 0),
  timezone           text not null default 'Asia/Almaty',
  default_country    text not null default 'KZ',
  -- Валюта, в которой менеджеры вносят продажи
  sales_currency     text not null default 'KZT' check (sales_currency in ('USD', 'KZT')),
  -- Средняя маржа, %, если у продажи не указан товар
  margin_pct         numeric not null default 55 check (margin_pct between 0 and 100),
  -- Цели в валюте продаж; null = не заданы
  target_cac         numeric check (target_cac is null or target_cac > 0),
  target_romi        numeric,
  attribution_model  text not null default 'last' check (attribution_model in ('last', 'first')),
  attribution_window int not null default 30 check (attribution_window in (7, 14, 30, 60, 90)),
  -- Пока реклама не подключена, интерфейс показывает демо-данные
  demo_data          boolean not null default true,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- В v1 все участники видят всё; поле заложено под будущие роли
  role         text not null default 'member' check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- Проверки доступа. SECURITY DEFINER, чтобы политики не зацикливались на собственных таблицах.
create function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and is_platform_admin);
$$;

create function private.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members where workspace_id = ws and user_id = (select auth.uid())
  );
$$;

create function private.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

create function private.shares_workspace(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;

revoke all on function private.is_platform_admin(), private.is_member(uuid), private.is_owner(uuid), private.shares_workspace(uuid) from public;
grant execute on function private.is_platform_admin(), private.is_member(uuid), private.is_owner(uuid), private.shares_workspace(uuid) to authenticated, service_role;

-- Профиль создаётся вместе с пользователем
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(coalesce(new.email, '')), coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

revoke all on public.profiles, public.workspaces, public.workspace_members from anon, authenticated;

-- profiles: видно себя и коллег по workspace; менять можно только своё имя
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_platform_admin()) or private.shares_workspace(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- workspaces: видят участники; настройки меняет владелец. Создание и удаление — только сервер.
grant select on public.workspaces to authenticated;
grant update (name, timezone, sales_currency, margin_pct, target_cac, target_romi, attribution_model, attribution_window)
  on public.workspaces to authenticated;
create policy workspaces_select on public.workspaces for select to authenticated
  using (private.is_member(id) or (select private.is_platform_admin()));
create policy workspaces_update on public.workspaces for update to authenticated
  using (private.is_owner(id) or (select private.is_platform_admin()))
  with check (private.is_owner(id) or (select private.is_platform_admin()));

-- workspace_members: состав видят участники; менять состав — только сервер
grant select on public.workspace_members to authenticated;
create policy workspace_members_select on public.workspace_members for select to authenticated
  using (private.is_member(workspace_id) or (select private.is_platform_admin()));
