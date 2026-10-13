-- Фаза 5. Продажи и товары: участники workspace вносят продажи, владелец ведёт справочник товаров.
-- Источник продажи (лид по телефону) приложение находит при показе: модель и окно атрибуции
-- меняются в настройках, и пересчитывать сохранённые связи при каждой смене не нужно.

-- Кто внёс продажу, записывает база, а не браузер
alter table public.sales alter column created_by set default auth.uid();
-- Телефон только в E.164: по нему продажа связывается с лидом
alter table public.sales add constraint sales_phone_e164 check (phone ~ '^\+[1-9][0-9]{6,14}$');

-- Товар и объявление-источник должны быть из того же workspace, что и продажа
create function private.sale_refs_ok(ws uuid, product uuid, ad uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (product is null or exists (select 1 from public.products p where p.id = product and p.workspace_id = ws))
     and (ad is null or exists (select 1 from public.ads a where a.id = ad and a.workspace_id = ws));
$$;
revoke all on function private.sale_refs_ok(uuid, uuid, uuid) from public;
grant execute on function private.sale_refs_ok(uuid, uuid, uuid) to authenticated, service_role;

grant insert (workspace_id, phone, customer_name, amount, currency, product_id, cost, sold_on, comment, input, manual_ad_id, external_id)
  on public.sales to authenticated;
-- После добавления менеджер меняет только источник, выбранный вручную
grant update (manual_ad_id) on public.sales to authenticated;
grant delete on public.sales to authenticated;

create policy sales_member_insert on public.sales for insert to authenticated
  with check (
    private.is_member(workspace_id)
    and created_by = (select auth.uid())
    and private.sale_refs_ok(workspace_id, product_id, manual_ad_id)
  );
create policy sales_member_update on public.sales for update to authenticated
  using (private.is_member(workspace_id))
  with check (private.is_member(workspace_id) and private.sale_refs_ok(workspace_id, product_id, manual_ad_id));
-- Удалить продажу может тот, кто её внёс, и владелец workspace
create policy sales_delete on public.sales for delete to authenticated
  using (private.is_member(workspace_id) and (created_by = (select auth.uid()) or private.is_owner(workspace_id)));

-- Товары с ценой и себестоимостью влияют на прибыль всех отчётов: их ведёт владелец.
-- Товар не удаляется, а уходит в архив (archived_at): на него ссылаются продажи.
grant insert (workspace_id, name, price, cost_type, cost) on public.products to authenticated;
grant update (name, price, cost_type, cost, archived_at) on public.products to authenticated;
create policy products_owner_insert on public.products for insert to authenticated
  with check (private.is_owner(workspace_id));
create policy products_owner_update on public.products for update to authenticated
  using (private.is_owner(workspace_id))
  with check (private.is_owner(workspace_id));
