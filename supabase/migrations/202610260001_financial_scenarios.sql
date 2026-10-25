-- Scenarios are frozen experiments, separate from the immutable accounting ledger.
create table public.financial_scenarios (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 100),
  start_date date not null check(isfinite(start_date)),
  end_date date not null check(isfinite(end_date) and end_date>=start_date),
  opening_mode text not null check(opening_mode in ('actual','custom')),
  configuration jsonb not null,
  source_snapshot jsonb not null,
  frozen_at timestamptz not null default now()
);
create index on public.financial_scenarios(workspace_id,frozen_at);
alter table public.financial_scenarios enable row level security;
create policy scenario_read on public.financial_scenarios for select to authenticated using(public.owns_workspace(workspace_id));
revoke all on public.financial_scenarios from public,anon,authenticated;
grant select on public.financial_scenarios to authenticated;

create function public.save_scenario(w uuid,p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  scenario_id uuid; source jsonb; existing public.financial_scenarios; row jsonb; account jsonb;
  start_on date; end_on date; trial numeric := 0; native jsonb;
begin
  perform public.require_workspace(w);
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>200000 then raise exception 'Invalid scenario input'; end if;
  if (select count(*) from jsonb_object_keys(p))<>7 or not p ?& array['id','name','start_date','end_date','opening_mode','opening_balances','selected_transaction_ids'] then raise exception 'Invalid scenario fields'; end if;
  scenario_id := (p->>'id')::uuid;
  select * into existing from public.financial_scenarios where id=scenario_id;
  if found then
    if existing.workspace_id<>w then raise exception 'Scenario not found' using errcode='42501'; end if;
    if existing.configuration=p then return scenario_id; end if;
    raise exception 'Saved scenarios are immutable; create a new scenario';
  end if;
  if jsonb_typeof(p->'name') is distinct from 'string' or length(trim(p->>'name')) not between 1 and 100
    or jsonb_typeof(p->'start_date') is distinct from 'string' or (p->>'start_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p->'end_date') is distinct from 'string' or (p->>'end_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(p->>'opening_mode','') not in ('actual','custom') then raise exception 'Check the scenario name, dates and opening mode'; end if;
  start_on := (p->>'start_date')::date; end_on := (p->>'end_date')::date;
  if end_on<start_on then raise exception 'Start date must be on or before end date'; end if;
  if jsonb_typeof(p->'opening_balances') is distinct from 'array' or jsonb_typeof(p->'selected_transaction_ids') is distinct from 'array' then raise exception 'Balances and replay entries must be arrays'; end if;
  if jsonb_array_length(p->'opening_balances')>2000 or jsonb_array_length(p->'selected_transaction_ids')>2000 then raise exception 'Use at most 2000 opening accounts and 2000 replay entries'; end if;
  if (select count(*) from public.financial_scenarios where workspace_id=w)>=100 then raise exception 'Delete an old scenario before saving more than 100 scenarios'; end if;
  if p->>'opening_mode'='actual' and jsonb_array_length(p->'opening_balances')<>0 then raise exception 'Actual opening balances are copied from the source'; end if;
  if (select count(*) from jsonb_array_elements(p->'opening_balances'))<>(select count(distinct x->>'account_id') from jsonb_array_elements(p->'opening_balances') x)
    or (select count(*) from jsonb_array_elements(p->'selected_transaction_ids'))<>(select count(distinct x) from jsonb_array_elements(p->'selected_transaction_ids') x) then raise exception 'Accounts and replay entries must be unique'; end if;
  source := public.read_snapshot(w);
  if octet_length(source::text)>8000000 then raise exception 'The source snapshot exceeds the 8 MB scenario limit'; end if;
  for row in select value from jsonb_array_elements(p->'opening_balances') loop
    if jsonb_typeof(row) is distinct from 'object' or not row ?& array['account_id','book_balance','native_balance']
      or (select count(*) from jsonb_object_keys(row))<>3 or jsonb_typeof(row->'account_id') is distinct from 'string'
      or jsonb_typeof(row->'book_balance') is distinct from 'string' or (row->>'book_balance')!~'^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,8})?$'
      or (jsonb_typeof(row->'native_balance') not in ('string','null')) then raise exception 'Invalid opening balance'; end if;
    if row->>'account_id'='accumulated' then account := jsonb_build_object('type','equity','currency_code',null);
    else
      select value into account from jsonb_array_elements(source->'accounts') where value->>'id'=row->>'account_id' and value->>'type' in ('asset','liability','equity');
      if not found then raise exception 'Opening balances must use this workspace''s asset, liability or equity accounts'; end if;
    end if;
    native := row->'native_balance';
    if (account->>'currency_code' is null)<>(native='null'::jsonb) then raise exception 'Fixed-currency accounts require a native opening balance'; end if;
    if native<>'null'::jsonb then
      if (row->>'native_balance')!~'^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,8})?$' then raise exception 'Invalid native opening balance'; end if;
      if account->>'currency_code'=source->'workspace'->>'functional_currency_code' and (row->>'native_balance')::numeric<>(row->>'book_balance')::numeric then raise exception 'Home-currency native and book balances must match'; end if;
    end if;
    trial := trial+(row->>'book_balance')::numeric*case when account->>'type'='asset' then 1 else -1 end;
  end loop;
  if trial<>0 then raise exception 'Opening assets must equal liabilities plus equity, including accumulated results'; end if;
  for row in select value from jsonb_array_elements(p->'selected_transaction_ids') loop
    if jsonb_typeof(row) is distinct from 'string' then raise exception 'Invalid replay entry'; end if;
    if not exists(select 1 from jsonb_array_elements(source->'transactions') t where t->>'id'=row#>>'{}' and t->>'posted_at' is not null and (t->>'accounting_date')::date between start_on and end_on) then raise exception 'Replay entries must be posted in the selected workspace and period'; end if;
  end loop;
  insert into public.financial_scenarios(id,workspace_id,name,start_date,end_date,opening_mode,configuration,source_snapshot)
    values(scenario_id,w,trim(p->>'name'),start_on,end_on,p->>'opening_mode',p,source);
  return scenario_id;
end $$;

create function public.read_scenario(w uuid,scenario_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.owns_workspace(w) then raise exception 'Workspace not found' using errcode='42501'; end if;
  select configuration||jsonb_build_object('workspace_id',workspace_id,'source_snapshot',source_snapshot,'frozen_at',frozen_at) into result
    from public.financial_scenarios where workspace_id=w and id=scenario_id;
  if not found then raise exception 'Scenario not found' using errcode='42501'; end if;
  return result;
end $$;

create function public.delete_scenario(w uuid,scenario_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_workspace(w);
  delete from public.financial_scenarios where workspace_id=w and id=scenario_id;
  if not found then raise exception 'Scenario not found' using errcode='42501'; end if;
  return scenario_id;
end $$;
revoke all on function public.save_scenario(uuid,jsonb),public.read_scenario(uuid,uuid),public.delete_scenario(uuid,uuid) from public,anon;
grant execute on function public.save_scenario(uuid,jsonb),public.read_scenario(uuid,uuid),public.delete_scenario(uuid,uuid) to authenticated;
