-- Accounting core extension contract. Existing postings and legacy RPC signatures stay intact.
alter table public.transactions drop constraint transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check
 check(kind in ('income','expense','transfer','contribution','withdrawal','asset_purchase','deposit','invoice','bill','payment','opening_balance','adjustment','recognition','reversal'));

create table public.accounting_sources (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  module text not null check(module ~ '^[a-z][a-z0-9_]{0,49}$'),
  created_at timestamptz not null default now(),
  unique(workspace_id,id)
);
create table public.accounting_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  source_id uuid not null,
  operation text not null check(length(operation) between 1 and 100),
  request jsonb not null check(jsonb_typeof(request)='object'),
  transaction_id uuid not null unique,
  obligation_id uuid,
  transfer_evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(workspace_id,source_id,operation),
  foreign key(workspace_id,source_id) references public.accounting_sources(workspace_id,id),
  foreign key(workspace_id,transaction_id) references public.transactions(workspace_id,id),
  foreign key(workspace_id,obligation_id) references public.obligations(workspace_id,id)
);
create index on public.accounting_operations(workspace_id,obligation_id);
create table public.payroll_items (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  employee_party_id uuid not null,
  period text not null check(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_at timestamptz not null default now(),
  unique(workspace_id,id),
  foreign key(workspace_id,id) references public.accounting_sources(workspace_id,id),
  foreign key(workspace_id,employee_party_id) references public.parties(workspace_id,id)
);
create index on public.payroll_items(workspace_id,employee_party_id);
alter table public.accounting_sources enable row level security;
alter table public.accounting_operations enable row level security;
alter table public.payroll_items enable row level security;
create policy accounting_source_read on public.accounting_sources for select to authenticated using(public.owns_workspace(workspace_id));
create policy accounting_operation_read on public.accounting_operations for select to authenticated using(public.owns_workspace(workspace_id));
create policy payroll_item_read on public.payroll_items for select to authenticated using(public.owns_workspace(workspace_id));
revoke all on public.accounting_sources,public.accounting_operations,public.payroll_items from public,anon,authenticated;
grant select on public.accounting_sources,public.accounting_operations,public.payroll_items to authenticated;

create function public.guard_accounting_source() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception 'Accounting source history is immutable';
end $$;
create trigger immutable_accounting_source before update or delete on public.accounting_sources for each row execute function public.guard_accounting_source();
create trigger immutable_accounting_operation before update or delete on public.accounting_operations for each row execute function public.guard_accounting_source();
create trigger immutable_payroll_item before update or delete on public.payroll_items for each row execute function public.guard_accounting_source();

-- Private transaction primitives. A new module owns its own validated wrapper and
-- domain table; the ledger does not acquire a switch on that module's fields.
create function public.register_accounting_source(w uuid, source_id uuid, module_name text) returns void
language plpgsql security definer set search_path='' as $$
declare existing public.accounting_sources;
begin
 perform public.require_workspace(w);
 insert into public.accounting_sources(id,workspace_id,module) values(source_id,w,module_name) on conflict(id) do nothing;
 select * into strict existing from public.accounting_sources where id=source_id;
 if existing.workspace_id<>w or existing.module<>module_name then
   raise exception 'Source record not found' using errcode='42501';
 end if;
end $$;
create function public.prior_accounting_operation(w uuid, source_id uuid, operation_name text, request jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing public.accounting_operations;
begin
 if jsonb_typeof(request) is distinct from 'object' or octet_length(request::text)>200000 then raise exception 'Invalid source request'; end if;
 select * into existing from public.accounting_operations a
 where a.workspace_id=w and a.source_id=prior_accounting_operation.source_id and a.operation=operation_name;
 if found then
   if existing.request is distinct from (request-'id') then raise exception 'Retry conflicts with the source operation'; end if;
   return existing.transaction_id;
 end if;
 return null;
end $$;
create function public.record_accounting_operation(w uuid, source_id uuid, operation_name text, request jsonb, p jsonb, evidence jsonb default '[]'::jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior uuid; result uuid;
begin
 perform public.require_workspace(w);
 if not exists(select 1 from public.accounting_sources s where s.workspace_id=w and s.id=source_id) then raise exception 'Source record not found' using errcode='42501'; end if;
 prior := public.prior_accounting_operation(w,source_id,operation_name,request);
 if prior is not null then return prior; end if;
 if exists(select 1 from public.transactions t where t.id=(p->>'id')::uuid and t.workspace_id=w and t.posted_at is not null) then
   raise exception 'Posted transaction already belongs outside this source operation';
 end if;
 result := public.save_event(w,p,true);
 insert into public.accounting_operations(workspace_id,source_id,operation,request,transaction_id,obligation_id,transfer_evidence)
 values(w,source_id,operation_name,request-'id',result,(p#>>'{obligation,id}')::uuid,evidence);
 return result;
end $$;

-- Typed intent is also enforced at the authenticated RPC boundary. The server
-- builder is useful orchestration, not a trusted bypass of source provenance.
create function public.check_intent_fields(value jsonb, required_keys text[], allowed_keys text[]) returns void
language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(value) is distinct from 'object' or not value ?& required_keys
  or exists(select 1 from jsonb_object_keys(value) k where not k=any(allowed_keys))
 then raise exception 'Invalid accounting command request'; end if;
end $$;
create function public.match_intent_line(w uuid, p jsonb, used_ids uuid[], account_id uuid, expected_side text, native_amount numeric, code text, declared_rate numeric, expected_id uuid default null) returns uuid
language plpgsql set search_path='' as $$
declare a public.accounts; home text; disposes boolean; result uuid; expected_rate numeric;
begin
 select * into a from public.accounts x where x.workspace_id=w and x.id=account_id and x.is_active;
 if not found or native_amount is null or native_amount<=0 or native_amount='NaN'::numeric
  or declared_rate is null or declared_rate<=0 or declared_rate='NaN'::numeric
 then raise exception 'Invalid accounting command line intent'; end if;
 select functional_currency_code into strict home from public.workspaces where id=w;
 disposes := code<>home and ((a.type='asset' and expected_side='credit') or (a.type='liability' and expected_side='debit'));
 expected_rate := case when code=home then 1 else declared_rate end;
 select (l->>'id')::uuid into result from jsonb_array_elements(p->'lines') l
 where not (l->>'id')::uuid=any(used_ids)
  and (expected_id is null or (l->>'id')::uuid=expected_id)
  and (l->>'account_id')::uuid=account_id and l->>'side'=expected_side
  and (l->>'amount')::numeric=native_amount and l->>'currency_code'=code
  and (disposes or (l->>'exchange_rate')::numeric=expected_rate)
 order by l->>'id' limit 1;
 if result is null then raise exception 'Accounting event line does not match command intent'; end if;
 return result;
end $$;
create function public.check_intent_extras(w uuid, request jsonb, p jsonb, used_ids uuid[]) returns void
language plpgsql set search_path='' as $$
declare fee jsonb := request->'fee'; bank public.accounts; expense public.accounts; line_id uuid; home text; extra jsonb; extras integer;
begin
 if fee is not null then
   perform public.check_intent_fields(fee,array['account_id','funding_account_id','amount','rate'],array['account_id','funding_account_id','amount','rate']);
   select * into bank from public.accounts a where a.workspace_id=w and a.id=(fee->>'funding_account_id')::uuid and a.is_active;
   if not found or bank.role not in ('bank','cash','wallet','credit_card') then raise exception 'Invalid accounting fee source intent'; end if;
   select * into expense from public.accounts a where a.workspace_id=w and a.id=(fee->>'account_id')::uuid and a.is_active;
   if not found or expense.role<>'general' or expense.type<>'expense' then raise exception 'Invalid accounting fee category intent'; end if;
   line_id := public.match_intent_line(w,p,used_ids,bank.id,'credit',(fee->>'amount')::numeric,bank.currency_code,(fee->>'rate')::numeric);
   used_ids := used_ids || line_id;
   line_id := public.match_intent_line(w,p,used_ids,expense.id,'debit',(fee->>'amount')::numeric,bank.currency_code,(fee->>'rate')::numeric);
   used_ids := used_ids || line_id;
 end if;
 select count(*) into extras from jsonb_array_elements(p->'lines') l where not (l->>'id')::uuid=any(used_ids);
 if extras>1 then raise exception 'Unexpected accounting command postings'; end if;
 if extras=1 then
   select value into strict extra from jsonb_array_elements(p->'lines') where not (value->>'id')::uuid=any(used_ids);
   select functional_currency_code into strict home from public.workspaces where id=w;
   if extra->>'account_id' is distinct from request->>'fx_account_id' or extra->>'currency_code' is distinct from home
    or not exists(select 1 from public.accounts a where a.workspace_id=w and a.id=(extra->>'account_id')::uuid and a.is_active and a.role='general' and a.type in ('revenue','expense'))
   then raise exception 'Unexpected accounting command FX posting'; end if;
 end if;
end $$;
create function public.check_bookkeeping_intent(w uuid, request jsonb, p jsonb) returns void
language plpgsql set search_path='' as $$
declare command text := request->>'command'; kind text := request->>'kind'; source public.accounts; target public.accounts;
 used_ids uuid[] := '{}'::uuid[]; line_id uuid; source_side text; target_side text; part jsonb; targets jsonb; st jsonb; recognition public.journal_lines; n integer:=0;
 control_line uuid; line_account public.accounts; expected_reference text;
begin
 if jsonb_typeof(request) is distinct from 'object' or octet_length(request::text)>200000
  or command is null or command not in ('guided','manual','payment')
  or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>200000
 then raise exception 'Invalid bookkeeping command'; end if;
 if p->>'accounting_date' is distinct from request->>'accounting_date'
  or p->>'description' is distinct from request->>'description'
 then raise exception 'Accounting event header does not match command intent'; end if;
 if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_typeof(p->'settlements') is distinct from 'array' then raise exception 'Invalid accounting event request'; end if;
 if jsonb_array_length(p->'lines') not between 2 and 100 then raise exception 'Invalid accounting event line count'; end if;

 if command='manual' then
   perform public.check_intent_fields(request,array['command','accounting_date','description','party_id','lines'],array['id','command','accounting_date','description','party_id','lines']);
   if p->>'kind' is distinct from 'adjustment' or p->>'party_id' is distinct from request->>'party_id'
    or coalesce(p->'obligation','null'::jsonb)<>'null'::jsonb or jsonb_array_length(p->'settlements')<>0
    or jsonb_typeof(request->'lines') is distinct from 'array'
   then raise exception 'Invalid manual accounting command'; end if;
   if jsonb_array_length(request->'lines')<>jsonb_array_length(p->'lines') then raise exception 'Manual event lines do not match command intent'; end if;
   for part in select value from jsonb_array_elements(request->'lines') loop
     perform public.check_intent_fields(part,array['id','account_id','side','amount','currency_code','exchange_rate'],array['id','account_id','side','amount','currency_code','exchange_rate']);
     if part->>'side' not in ('debit','credit') then raise exception 'Invalid manual accounting side intent'; end if;
     select * into line_account from public.accounts a where a.workspace_id=w and a.id=(part->>'account_id')::uuid;
     if line_account.role in ('receivable','payable') then raise exception 'Use obligation commands for control accounts'; end if;
     line_id := public.match_intent_line(w,p,used_ids,(part->>'account_id')::uuid,part->>'side',(part->>'amount')::numeric,part->>'currency_code',(part->>'exchange_rate')::numeric,(part->>'id')::uuid);
     used_ids := used_ids || line_id;
   end loop;

 elsif command='guided' then
   perform public.check_intent_fields(request,array['command','kind','accounting_date','description','party_id','source_id','destination_id','amount','currency','rate','splits'],array['id','command','kind','accounting_date','description','party_id','source_id','destination_id','amount','currency','rate','splits','destination_amount','destination_rate','fx_account_id','reference','due_date']);
   if kind is null or kind not in ('income','expense','transfer','contribution','withdrawal','asset_purchase','deposit','invoice','bill','opening_balance')
    or p->>'kind' is distinct from kind or p->>'party_id' is distinct from request->>'party_id'
    or jsonb_array_length(p->'settlements')<>0 or jsonb_typeof(request->'splits') is distinct from 'array'
   then raise exception 'Invalid guided accounting command'; end if;
   select * into source from public.accounts a where a.workspace_id=w and a.id=(request->>'source_id')::uuid and a.is_active;
   if not found
    or (kind='invoice' and source.role<>'receivable')
    or (kind='bill' and source.role<>'payable')
    or (kind not in ('invoice','bill','opening_balance') and source.role not in ('bank','cash','wallet','credit_card'))
   then raise exception 'Invalid guided source account intent'; end if;
   source_side := case when kind in ('income','invoice','contribution') then 'debit' else 'credit' end;
   target_side := case when source_side='debit' then 'credit' else 'debit' end;
   line_id := public.match_intent_line(w,p,used_ids,source.id,source_side,(request->>'amount')::numeric,coalesce(source.currency_code,request->>'currency'),(request->>'rate')::numeric);
   used_ids := used_ids || line_id;
   if source.role in ('receivable','payable') then control_line:=line_id; end if;
   targets := case when jsonb_array_length(request->'splits')>0 then request->'splits'
     else jsonb_build_array(jsonb_build_object('account_id',request->>'destination_id','amount',coalesce(request->>'destination_amount',request->>'amount'))) end;
   for part in select value from jsonb_array_elements(targets) loop
     perform public.check_intent_fields(part,array['account_id','amount'],array['account_id','amount']);
     select * into target from public.accounts a where a.workspace_id=w and a.id=(part->>'account_id')::uuid and a.is_active;
     if not found
      or (kind in ('income','invoice') and (target.role<>'general' or target.type<>'revenue'))
      or (kind in ('expense','bill') and (target.role<>'general' or target.type<>'expense'))
      or (kind in ('contribution','withdrawal') and (target.role<>'general' or target.type<>'equity'))
      or (kind in ('asset_purchase','deposit') and (target.role<>'general' or target.type<>'asset'))
      or (kind='transfer' and target.role not in ('bank','cash','wallet','credit_card'))
     then raise exception 'Invalid guided destination account intent'; end if;
     line_id := public.match_intent_line(w,p,used_ids,target.id,target_side,(part->>'amount')::numeric,coalesce(target.currency_code,request->>'currency'),coalesce(request->>'destination_rate',request->>'rate')::numeric);
     used_ids := used_ids || line_id;
     if target.role in ('receivable','payable') then
       if control_line is not null then raise exception 'One obligation per recognition command'; end if;
       control_line:=line_id;
     end if;
   end loop;
   if control_line is null then
     if coalesce(p->'obligation','null'::jsonb)<>'null'::jsonb then raise exception 'Unexpected obligation in accounting command'; end if;
   else
     expected_reference := case when kind in ('invoice','bill') then request->>'reference' else nullif(request->>'reference','') end;
     if p#>>'{obligation,recognition_line_id}' is distinct from control_line::text
      or p#>>'{obligation,reference}' is distinct from expected_reference
      or p#>>'{obligation,due_date}' is distinct from request->>'due_date'
     then raise exception 'Obligation does not match accounting command intent'; end if;
   end if;
   perform public.check_intent_extras(w,request,p,used_ids);

 else
   perform public.check_intent_fields(request,array['command','accounting_date','description','allocations'],array['id','command','accounting_date','description','allocations','fx_account_id','fee']);
   if p->>'kind' is distinct from 'payment' or p->>'party_id' is not null
    or coalesce(p->'obligation','null'::jsonb)<>'null'::jsonb or jsonb_typeof(request->'allocations') is distinct from 'array'
   then raise exception 'Invalid settlement accounting command'; end if;
   if jsonb_array_length(request->'allocations') not between 1 and 50
    or jsonb_array_length(request->'allocations')<>jsonb_array_length(p->'settlements')
   then raise exception 'Payment allocations do not match command intent'; end if;
   for part in select value from jsonb_array_elements(request->'allocations') loop
     perform public.check_intent_fields(part,array['obligation_id','amount','funding_account_id','funding_amount','funding_rate'],array['obligation_id','amount','funding_account_id','funding_amount','funding_rate']);
     st:=p->'settlements'->n;
     if st->>'obligation_id' is distinct from part->>'obligation_id' then raise exception 'Payment obligation does not match command intent'; end if;
     select l.* into recognition from public.obligations o join public.journal_lines l on l.id=o.recognition_line_id where o.workspace_id=w and o.id=(part->>'obligation_id')::uuid;
     if not found then raise exception 'Payment obligation not found' using errcode='42501'; end if;
     select * into source from public.accounts a where a.workspace_id=w and a.id=(part->>'funding_account_id')::uuid and a.is_active;
     if not found or source.role not in ('bank','cash','wallet','credit_card') then raise exception 'Invalid payment funding account intent'; end if;
     line_id:=public.match_intent_line(w,p,used_ids,recognition.account_id,case when recognition.side='debit' then 'credit' else 'debit' end,(part->>'amount')::numeric,recognition.currency_code,recognition.exchange_rate,(st->>'clearing_line_id')::uuid);
     used_ids:=used_ids || line_id;
     line_id:=public.match_intent_line(w,p,used_ids,source.id,recognition.side,(part->>'funding_amount')::numeric,source.currency_code,(part->>'funding_rate')::numeric,(st->>'funding_line_id')::uuid);
     used_ids:=used_ids || line_id;
     n:=n+1;
   end loop;
   perform public.check_intent_extras(w,request,p,used_ids);
 end if;
end $$;

revoke all on function public.check_intent_fields(jsonb,text[],text[]),public.match_intent_line(uuid,jsonb,uuid[],uuid,text,numeric,text,numeric,uuid),public.check_intent_extras(uuid,jsonb,jsonb,uuid[]),public.check_bookkeeping_intent(uuid,jsonb,jsonb) from public,anon,authenticated;


-- Built-in application adapter for existing bookkeeping/invoice/bill commands.
create function public.save_bookkeeping_event(w uuid, source_id uuid, request jsonb, p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare module_name text;
begin
 perform public.require_workspace(w);
 perform public.check_bookkeeping_intent(w,request,p);
 module_name := case when p->>'kind' in ('invoice','bill') then 'invoicing' else 'bookkeeping' end;
 perform public.register_accounting_source(w,source_id,module_name);
 return public.record_accounting_operation(w,source_id,'record',request,p);
end $$;

-- Payroll domain adapter: employee/period rules stay here, outside validate_event.
create function public.save_payroll_accrual(w uuid, request jsonb, p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare source_id uuid := (request->>'source_id')::uuid; prior uuid; employee uuid := (request->>'employee_party_id')::uuid; expected_rate numeric; home text;
begin
 perform public.register_accounting_source(w,source_id,'payroll');
 prior := public.prior_accounting_operation(w,source_id,'recognition',request);
 if prior is not null then return prior; end if;
 if p->>'kind' is distinct from 'recognition' or (p->>'party_id')::uuid is distinct from employee
  or p->>'accounting_date' is distinct from request->>'accounting_date'
  or p->>'description' is distinct from request->>'description'
  or jsonb_array_length(p->'lines')<>2 or jsonb_array_length(p->'settlements')<>0
  or p#>>'{obligation,reference}' is distinct from request->>'reference'
  or p#>>'{obligation,due_date}' is distinct from request->>'due_date'
 then raise exception 'Salary recognition does not match its source'; end if;
 if request->>'period' !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  or (request->>'amount')::numeric<=0 then raise exception 'Invalid salary input'; end if;
 select functional_currency_code into strict home from public.workspaces where id=w;
 expected_rate := case when request->>'currency_code'=home then 1 else (request->>'exchange_rate')::numeric end;
 if not exists(select 1 from jsonb_array_elements(p->'lines') l join public.accounts a on a.id=(l->>'account_id')::uuid
  where a.workspace_id=w and a.id=(request->>'payable_account_id')::uuid and a.role='payable' and l->>'side'='credit'
   and (l->>'amount')::numeric=(request->>'amount')::numeric and l->>'currency_code'=request->>'currency_code'
   and (l->>'exchange_rate')::numeric=expected_rate and l->>'id'=p#>>'{obligation,recognition_line_id}')
 or not exists(select 1 from jsonb_array_elements(p->'lines') l join public.accounts a on a.id=(l->>'account_id')::uuid
  where a.workspace_id=w and a.id=(request->>'expense_account_id')::uuid and a.type='expense' and a.role='general' and l->>'side'='debit'
   and (l->>'amount')::numeric=(request->>'amount')::numeric and l->>'currency_code'=request->>'currency_code'
   and (l->>'exchange_rate')::numeric=expected_rate)
 then raise exception 'Salary accounts or values do not match its source'; end if;
 insert into public.payroll_items(id,workspace_id,employee_party_id,period) values(source_id,w,employee,request->>'period');
 return public.record_accounting_operation(w,source_id,'recognition',request,p);
end $$;

create function public.save_payroll_payment(w uuid, request jsonb, p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_source uuid := (request->>'source_id')::uuid; operation_name text := 'payment:'||((request->>'operation_id')::uuid)::text;
 prior uuid; obligation_id uuid; home text; target_currency text; part jsonb; st jsonb; clearing jsonb; funding jsonb;
 index integer := 0; evidence jsonb := '[]'::jsonb; used_ids uuid[] := '{}'::uuid[];
 funding_account public.accounts;
begin
 perform public.require_workspace(w);
 if not exists(select 1 from public.accounting_sources s join public.payroll_items pi on pi.id=s.id and pi.workspace_id=s.workspace_id where s.id=v_source and s.workspace_id=w and s.module='payroll') then raise exception 'Payroll source not found' using errcode='42501'; end if;
 prior := public.prior_accounting_operation(w,v_source,operation_name,request);
 if prior is not null then return prior; end if;
 select a.obligation_id into strict obligation_id from public.accounting_operations a where a.workspace_id=w and a.source_id=v_source and a.operation='recognition';
 select ws.functional_currency_code,l.currency_code into strict home,target_currency from public.obligations o join public.journal_lines l on l.id=o.recognition_line_id join public.workspaces ws on ws.id=o.workspace_id where o.id=obligation_id and o.workspace_id=w;
 if p->>'kind' is distinct from 'payment' or p->>'accounting_date' is distinct from request->>'accounting_date'
  or p->>'description' is distinct from request->>'description'
  or jsonb_array_length(request->'allocations') not between 1 and 50
  or jsonb_array_length(p->'settlements')<>jsonb_array_length(request->'allocations') then raise exception 'Salary payment does not match its source'; end if;
 for part in select value from jsonb_array_elements(request->'allocations') loop
   st := p->'settlements'->index;
   select value into strict clearing from jsonb_array_elements(p->'lines') where value->>'id'=st->>'clearing_line_id';
   select value into strict funding from jsonb_array_elements(p->'lines') where value->>'id'=st->>'funding_line_id';
   if (st->>'obligation_id')::uuid is distinct from obligation_id
    or (clearing->>'amount')::numeric is distinct from (part->>'amount')::numeric
    or (funding->>'amount')::numeric is distinct from (part->>'funding_amount')::numeric
    or funding->>'account_id' is distinct from part->>'funding_account_id'
    or funding->>'side'<>'credit' or clearing->>'side'<>'debit'
   then raise exception 'Salary payment allocation does not match its source'; end if;
   select * into funding_account from public.accounts a where a.workspace_id=w and a.id=(part->>'funding_account_id')::uuid and a.is_active;
   if not found or funding_account.role not in ('bank','cash','wallet','credit_card') then raise exception 'Invalid salary funding account intent'; end if;
   -- Fresh funding increases use the declared valuation; foreign reductions
   -- retain carrying values, which the ledger validates under its workspace lock.
   perform public.match_intent_line(w,p,used_ids,funding_account.id,'credit',(part->>'funding_amount')::numeric,funding_account.currency_code,(part->>'funding_rate')::numeric,(funding->>'id')::uuid);
   used_ids := used_ids || array[(clearing->>'id')::uuid,(funding->>'id')::uuid];
   evidence := evidence || jsonb_build_array(jsonb_build_object(
     'source_currency',funding->>'currency_code','target_currency',target_currency,
     'effective_rate',case when round((part->>'amount')::numeric/(part->>'funding_amount')::numeric,18)=0
       then ((part->>'amount')::numeric/(part->>'funding_amount')::numeric)::text
       else round((part->>'amount')::numeric/(part->>'funding_amount')::numeric,18)::text end,
     'provider_rate',part->>'provider_rate','provider',part->>'provider','reference',part->>'reference'));
   index := index+1;
 end loop;
 perform public.check_intent_extras(w,request,p,used_ids);
 return public.record_accounting_operation(w,v_source,operation_name,request,p,evidence);
end $$;

revoke all on function public.guard_accounting_source(),public.register_accounting_source(uuid,uuid,text),public.prior_accounting_operation(uuid,uuid,text,jsonb),public.record_accounting_operation(uuid,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.save_bookkeeping_event(uuid,uuid,jsonb,jsonb),public.save_payroll_accrual(uuid,jsonb,jsonb),public.save_payroll_payment(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_bookkeeping_event(uuid,uuid,jsonb,jsonb),public.save_payroll_accrual(uuid,jsonb,jsonb),public.save_payroll_payment(uuid,jsonb,jsonb) to authenticated;


-- Same accounting invariants, extended only with neutral recognition semantics.
-- Include same-event receipts in the carrying pool before allocating discharges.
create or replace function public.validate_event(w uuid,i uuid) returns void
language plpgsql set search_path='' as $$
declare
 t public.transactions; l record; a public.accounts; o record; s record;
 functional text; units int; remaining numeric; carried numeric; expected numeric; native numeric; book numeric;
begin
 select * into strict t from public.transactions where id=i and workspace_id=w;
 select functional_currency_code,c.minor_units into functional,units from public.workspaces ws join public.currencies c on c.code=ws.functional_currency_code where ws.id=w;
 if (select count(*) from public.journal_lines where transaction_id=i)<2 then raise exception 'At least two postings required'; end if;
 if (select sum(case side when 'debit' then book_amount else -book_amount end) from public.journal_lines where transaction_id=i)<>0 then raise exception 'Postings must balance'; end if;
 for l in select j.*,c.minor_units from public.journal_lines j join public.currencies c on c.code=j.currency_code where j.transaction_id=i order by j.id loop
   select * into strict a from public.accounts where id=l.account_id;
   if not a.is_active then raise exception 'Account is inactive'; end if;
   if a.currency_code is not null and a.currency_code<>l.currency_code then raise exception 'Account currency mismatch'; end if;
   if round(l.amount,l.minor_units)<>l.amount or round(l.book_amount,units)<>l.book_amount then raise exception 'Currency precision exceeded'; end if;
   if l.currency_code=functional then
     if l.exchange_rate<>1 or l.amount<>l.book_amount or l.rate_source is not null then raise exception 'Functional currency requires rate one'; end if;
   else
     if l.rate_source is null or round(l.amount*l.exchange_rate,units)<>l.book_amount then raise exception 'Invalid exchange conversion'; end if;
   end if;
   if a.role in ('receivable','payable') and not exists(select 1 from public.obligations where recognition_line_id=l.id) and not exists(select 1 from public.settlements where clearing_line_id=l.id) then raise exception 'Control account posting requires an unpaid item or payment link'; end if;
   -- Weighted carrying values for foreign balance disposals. The same workspace
   -- lock also protects concurrent transfers, not just invoice payments.
   if l.currency_code<>functional and a.type in ('asset','liability') and a.role not in ('receivable','payable') and ((a.type='asset' and l.side='credit') or (a.type='liability' and l.side='debit')) then
     select coalesce(sum(case when j.side=case a.type when 'asset' then 'debit' else 'credit' end then j.amount else -j.amount end),0),
       coalesce(sum(case when j.side=case a.type when 'asset' then 'debit' else 'credit' end then j.book_amount else -j.book_amount end),0)
     into native,book from public.journal_lines j join public.transactions tx on tx.id=j.transaction_id where j.account_id=a.id and j.currency_code=l.currency_code and tx.posted_at is not null and tx.id<>i;
     -- Pool increases committed by this same atomic event before discharges,
     -- regardless of randomized line UUID order (e.g. collection plus bank fee).
     select native+coalesce(sum(j.amount),0),book+coalesce(sum(j.book_amount),0)
       into native,book from public.journal_lines j
       where j.transaction_id=i and j.account_id=a.id and j.currency_code=l.currency_code
       and j.side=case a.type when 'asset' then 'debit' else 'credit' end;
     -- Allocate split discharges in deterministic line order and leave the last remainder.
     select native-coalesce(sum(j.amount),0),book-coalesce(sum(j.book_amount),0) into native,book from public.journal_lines j where j.transaction_id=i and j.account_id=a.id and j.currency_code=l.currency_code and j.side=l.side and j.id<l.id;
     if native<l.amount or native<=0 then raise exception 'Insufficient foreign balance to discharge'; end if;
     expected := case when native=l.amount then book else round(book*l.amount/native,units) end;
     if l.rate_source<>'carrying_value' or l.book_amount<>expected then raise exception 'Discharge must preserve carrying value'; end if;
   end if;
 end loop;
 for o in select ob.*,j.account_id,j.side,j.amount,j.book_amount,j.currency_code,acc.role from public.obligations ob join public.journal_lines j on j.id=ob.recognition_line_id join public.accounts acc on acc.id=j.account_id where j.transaction_id=i loop
   if t.kind not in ('invoice','bill','recognition','opening_balance') or t.party_id is null then raise exception 'Invalid unpaid recognition'; end if;
   if (o.role='receivable' and o.side='debit' and t.kind in ('invoice','recognition','opening_balance')) or (o.role='payable' and o.side='credit' and t.kind in ('bill','recognition','opening_balance')) then null; else raise exception 'Invalid control recognition'; end if;
   if t.kind='opening_balance' and exists(select 1 from public.journal_lines j join public.accounts acc on acc.id=j.account_id where j.transaction_id=i and j.id<>o.recognition_line_id and acc.type<>'equity') then raise exception 'Opening unpaid balances require equity counterpart'; end if;
 end loop;
 if t.kind in ('invoice','bill','recognition') and (select count(*) from public.obligations ob join public.journal_lines j on j.id=ob.recognition_line_id where j.transaction_id=i)<>1 then raise exception 'Invoice or bill requires one unpaid item'; end if;
 if (select count(*) from public.obligations ob join public.journal_lines j on j.id=ob.recognition_line_id where j.transaction_id=i)>1 then raise exception 'One unpaid item per recognition'; end if;
 if t.kind='payment' and not exists(select 1 from public.settlements linked join public.journal_lines j on j.id=linked.clearing_line_id where j.transaction_id=i) then raise exception 'Payment requires allocations'; end if;
 for s in select st.*,cl.transaction_id as clearing_tx,cl.account_id,cl.side,cl.amount,cl.book_amount,cl.currency_code,cl.rate_source,
   fl.transaction_id as funding_tx,fl.side as funding_side,fa.role as funding_role,
   rl.account_id as recognition_account,rl.side as recognition_side,rl.amount as recognition_amount,rl.book_amount as recognition_book,rl.currency_code as recognition_currency,rl.transaction_id as recognition_tx
   from public.settlements st join public.journal_lines cl on cl.id=st.clearing_line_id join public.journal_lines fl on fl.id=st.funding_line_id join public.accounts fa on fa.id=fl.account_id join public.obligations ob on ob.id=st.obligation_id join public.journal_lines rl on rl.id=ob.recognition_line_id where cl.transaction_id=i order by cl.id loop
   if t.kind<>'payment' or s.clearing_tx<>s.funding_tx or s.account_id<>s.recognition_account or s.currency_code<>s.recognition_currency or s.side=s.recognition_side or s.funding_side=s.side or s.funding_role not in ('bank','cash','wallet','credit_card') or not public.event_active(s.recognition_tx) then raise exception 'Invalid settlement pair'; end if;
   if exists(select 1 from public.settlements x where x.clearing_line_id=s.funding_line_id or x.funding_line_id=s.clearing_line_id) then raise exception 'Settlement lines cannot serve two roles'; end if;
   if t.accounting_date<(select accounting_date from public.transactions where id=s.recognition_tx) then raise exception 'Payment predates recognition'; end if;
   select s.recognition_amount-coalesce(sum(j.amount),0),s.recognition_book-coalesce(sum(j.book_amount),0) into remaining,carried
     from public.settlements other join public.journal_lines j on j.id=other.clearing_line_id
     where other.obligation_id=s.obligation_id and ((j.transaction_id<>i and public.event_active(j.transaction_id)) or (j.transaction_id=i and j.id<s.clearing_line_id));
   if s.amount>remaining or remaining<=0 then raise exception 'Payment exceeds outstanding amount'; end if;
   expected := case when s.amount=remaining then carried else round(carried*s.amount/remaining,units) end;
   if s.book_amount<>expected or (s.currency_code<>functional and s.rate_source<>'carrying_value') then raise exception 'Payment must discharge carrying value'; end if;
 end loop;
end $$;
revoke all on function public.validate_event(uuid,uuid) from public,anon,authenticated;
