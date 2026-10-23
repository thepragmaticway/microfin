-- The ledger is writable only through commands. Every command retains the caller's
-- identity, checks ownership, and serializes writes within its workspace.
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check(length(display_name) between 1 and 100),
  created_at timestamptz not null default now()
);
create table public.currencies (
  code varchar(3) primary key check(code ~ '^[A-Z]{3}$'),
  minor_units smallint not null check(minor_units between 0 and 8)
);
insert into public.currencies values ('THB',2),('SGD',2),('MMK',2),('USD',2);
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id),
  name text not null check(length(trim(name)) between 1 and 100),
  kind text not null check(kind in ('personal','business')),
  functional_currency_code varchar(3) not null references public.currencies(code),
  timezone text not null default 'Asia/Bangkok',
  created_at timestamptz not null default now()
);
create index on public.workspaces(owner_user_id);
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  name text not null check(length(trim(name)) between 1 and 100),
  type text not null check(type in ('asset','liability','equity','revenue','expense')),
  role text not null check(role in ('general','bank','cash','wallet','credit_card','receivable','payable')),
  currency_code varchar(3) references public.currencies(code),
  is_active boolean not null default true,
  unique(workspace_id,id),
  check(role = 'general' or currency_code is not null),
  check(role not in ('bank','cash','wallet','receivable') or type='asset'),
  check(role not in ('credit_card','payable') or type='liability')
);
create table public.parties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  name text not null check(length(trim(name)) between 1 and 100),
  unique(workspace_id,id)
);
create table public.transactions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  accounting_date date not null check(isfinite(accounting_date)),
  kind text not null check(kind in ('income','expense','transfer','contribution','withdrawal','asset_purchase','deposit','invoice','bill','payment','opening_balance','adjustment','reversal')),
  description text not null check(length(trim(description)) between 1 and 500),
  party_id uuid,
  posted_at timestamptz,
  reversal_of_id uuid unique,
  created_at timestamptz not null default now(),
  unique(workspace_id,id),
  foreign key(workspace_id,party_id) references public.parties(workspace_id,id),
  foreign key(workspace_id,reversal_of_id) references public.transactions(workspace_id,id),
  check((kind='reversal') = (reversal_of_id is not null)),
  check(kind not in ('invoice','bill') or party_id is not null)
);
create index on public.transactions(workspace_id,accounting_date);
create index on public.transactions(workspace_id,party_id);
create table public.journal_lines (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  transaction_id uuid not null,
  account_id uuid not null,
  side text not null check(side in ('debit','credit')),
  amount numeric(28,8) not null check(amount>0 and amount<>'NaN'::numeric),
  currency_code varchar(3) not null references public.currencies(code),
  exchange_rate numeric(38,18) not null check(exchange_rate>0 and exchange_rate<>'NaN'::numeric),
  book_amount numeric(28,8) not null check(book_amount>=0 and book_amount<>'NaN'::numeric),
  rate_source text check(rate_source in ('manual','bank','carrying_value')),
  unique(workspace_id,id),
  foreign key(workspace_id,transaction_id) references public.transactions(workspace_id,id),
  foreign key(workspace_id,account_id) references public.accounts(workspace_id,id)
);
create index on public.journal_lines(workspace_id,transaction_id);
create index on public.journal_lines(workspace_id,account_id);
create table public.obligations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  recognition_line_id uuid not null unique,
  reference text check(length(reference)<=100),
  due_date date check(isfinite(due_date)),
  unique(workspace_id,id),
  foreign key(workspace_id,recognition_line_id) references public.journal_lines(workspace_id,id)
);
create table public.settlements (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  obligation_id uuid not null,
  clearing_line_id uuid not null unique,
  funding_line_id uuid not null unique,
  unique(workspace_id,id),
  foreign key(workspace_id,obligation_id) references public.obligations(workspace_id,id),
  foreign key(workspace_id,clearing_line_id) references public.journal_lines(workspace_id,id),
  foreign key(workspace_id,funding_line_id) references public.journal_lines(workspace_id,id),
  check(clearing_line_id<>funding_line_id)
);
create index on public.obligations(workspace_id,recognition_line_id);
create index on public.settlements(workspace_id,obligation_id);

create function public.owns_workspace(w uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workspaces where id=w and owner_user_id=auth.uid())
$$;
revoke all on function public.owns_workspace(uuid) from public;
grant execute on function public.owns_workspace(uuid) to authenticated;

alter table public.users enable row level security;
alter table public.currencies enable row level security;
alter table public.workspaces enable row level security;
alter table public.accounts enable row level security;
alter table public.parties enable row level security;
alter table public.transactions enable row level security;
alter table public.journal_lines enable row level security;
alter table public.obligations enable row level security;
alter table public.settlements enable row level security;
create policy profile_read on public.users for select to authenticated using(id=auth.uid());
create policy currency_read on public.currencies for select to authenticated using(true);
create policy workspace_read on public.workspaces for select to authenticated using(owner_user_id=auth.uid());
create policy account_read on public.accounts for select to authenticated using(public.owns_workspace(workspace_id));
create policy party_read on public.parties for select to authenticated using(public.owns_workspace(workspace_id));
create policy transaction_read on public.transactions for select to authenticated using(public.owns_workspace(workspace_id));
create policy line_read on public.journal_lines for select to authenticated using(public.owns_workspace(workspace_id));
create policy obligation_read on public.obligations for select to authenticated using(public.owns_workspace(workspace_id));
create policy settlement_read on public.settlements for select to authenticated using(public.owns_workspace(workspace_id));
revoke all on public.users,public.currencies,public.workspaces,public.accounts,public.parties,public.transactions,public.journal_lines,public.obligations,public.settlements from anon,authenticated;
grant select on public.users,public.currencies,public.workspaces,public.accounts,public.parties,public.transactions,public.journal_lines,public.obligations,public.settlements to authenticated;

create function public.require_workspace(w uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 -- One workspace lock covers posting, metadata changes, settlement and reversal.
 -- This deliberately favors correctness over unnecessary MVP write concurrency.
 perform 1 from public.workspaces where id=w and owner_user_id=auth.uid() for update;
 if not found then raise exception 'Workspace not found' using errcode='42501'; end if;
end $$;
revoke all on function public.require_workspace(uuid) from public,anon,authenticated;

create function public.create_workspace(p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare w uuid := (p->>'id')::uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=coalesce(p->>'timezone','Asia/Bangkok')) then raise exception 'Invalid timezone'; end if;
 insert into public.users(id,display_name) values(auth.uid(), coalesce(nullif(trim(p->>'display_name'),''),'Microfin user')) on conflict(id) do nothing;
 if exists(select 1 from public.workspaces where id=w) then
   perform public.require_workspace(w);
   if not exists(select 1 from public.workspaces where id=w and name=p->>'name' and kind=p->>'kind' and functional_currency_code=p->>'functional_currency_code' and timezone=coalesce(p->>'timezone','Asia/Bangkok')) then raise exception 'Retry conflicts with existing workspace'; end if;
   return w;
 end if;
 insert into public.workspaces(id,owner_user_id,name,kind,functional_currency_code,timezone) values(w,auth.uid(),p->>'name',p->>'kind',p->>'functional_currency_code',coalesce(p->>'timezone','Asia/Bangkok'));
 return w;
end $$;

create function public.save_account(w uuid,p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.accounts; i uuid := (p->>'id')::uuid;
begin
 perform public.require_workspace(w);
 select * into a from public.accounts where id=i;
 if found then
   if a.workspace_id<>w then raise exception 'Account not found' using errcode='42501'; end if;
   if exists(select 1 from public.journal_lines l join public.transactions t on t.id=l.transaction_id where l.account_id=i and t.posted_at is not null)
    and (a.type is distinct from p->>'type' or a.role is distinct from p->>'role' or a.currency_code is distinct from p->>'currency_code') then raise exception 'Used account classification is locked'; end if;
   update public.accounts set name=p->>'name',type=p->>'type',role=p->>'role',currency_code=p->>'currency_code',is_active=coalesce((p->>'is_active')::boolean,true) where id=i;
 else
   insert into public.accounts(id,workspace_id,name,type,role,currency_code,is_active) values(i,w,p->>'name',p->>'type',p->>'role',p->>'currency_code',coalesce((p->>'is_active')::boolean,true));
 end if;
 return i;
end $$;

create function public.save_party(w uuid,p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare i uuid := (p->>'id')::uuid;
begin
 perform public.require_workspace(w);
 if exists(select 1 from public.parties where id=i and workspace_id<>w) then raise exception 'Party not found' using errcode='42501'; end if;
 insert into public.parties(id,workspace_id,name) values(i,w,p->>'name') on conflict(id) do update set name=excluded.name;
 return i;
end $$;

-- Compare retries using semantic numeric values, not a mutable duplicate request log.
create function public.canonical_event(p jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',p->>'id','accounting_date',p->>'accounting_date','kind',p->>'kind','description',p->>'description','party_id',p->>'party_id',
 'lines',coalesce((select jsonb_agg(jsonb_build_object('id',x->>'id','account_id',x->>'account_id','side',x->>'side','amount',(x->>'amount')::numeric,'currency_code',x->>'currency_code','exchange_rate',(x->>'exchange_rate')::numeric,'book_amount',(x->>'book_amount')::numeric,'rate_source',x->>'rate_source') order by x->>'id') from jsonb_array_elements(nullif(p->'lines','null'::jsonb)) x),'[]'::jsonb),
 'obligation', case when p->'obligation' is null or p->'obligation'='null'::jsonb then 'null'::jsonb else jsonb_build_object('id',p#>>'{obligation,id}','recognition_line_id',p#>>'{obligation,recognition_line_id}','reference',p#>>'{obligation,reference}','due_date',p#>>'{obligation,due_date}') end,
 'settlements',coalesce((select jsonb_agg(jsonb_build_object('id',x->>'id','obligation_id',x->>'obligation_id','clearing_line_id',x->>'clearing_line_id','funding_line_id',x->>'funding_line_id') order by x->>'id') from jsonb_array_elements(nullif(p->'settlements','null'::jsonb)) x),'[]'::jsonb))
$$;

create function public.stored_event(i uuid) returns jsonb
language sql stable set search_path='' as $$
 select public.canonical_event(jsonb_build_object('id',t.id,'accounting_date',t.accounting_date,'kind',t.kind,'description',t.description,'party_id',t.party_id,
 'lines',(select jsonb_agg(to_jsonb(l)) from public.journal_lines l where l.transaction_id=t.id),
 'obligation',(select to_jsonb(o) from public.obligations o join public.journal_lines l on l.id=o.recognition_line_id where l.transaction_id=t.id),
 'settlements',(select jsonb_agg(to_jsonb(s)) from public.settlements s join public.journal_lines l on l.id=s.clearing_line_id where l.transaction_id=t.id))) from public.transactions t where t.id=i
$$;
revoke all on function public.canonical_event(jsonb),public.stored_event(uuid) from public,anon,authenticated;

create function public.event_active(i uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.transactions t where t.id=i and t.posted_at is not null and t.reversal_of_id is null and not exists(select 1 from public.transactions r where r.reversal_of_id=i and r.posted_at is not null))
$$;
revoke all on function public.event_active(uuid) from public,anon,authenticated;

create function public.validate_event(w uuid,i uuid) returns void
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
     -- Allocate split discharges in deterministic line order and leave the last remainder.
     select native-coalesce(sum(j.amount),0),book-coalesce(sum(j.book_amount),0) into native,book from public.journal_lines j where j.transaction_id=i and j.account_id=a.id and j.currency_code=l.currency_code and j.side=l.side and j.id<l.id;
     if native<l.amount or native<=0 then raise exception 'Insufficient foreign balance to discharge'; end if;
     expected := case when native=l.amount then book else round(book*l.amount/native,units) end;
     if l.rate_source<>'carrying_value' or l.book_amount<>expected then raise exception 'Discharge must preserve carrying value'; end if;
   end if;
 end loop;
 for o in select ob.*,j.account_id,j.side,j.amount,j.book_amount,j.currency_code,acc.role from public.obligations ob join public.journal_lines j on j.id=ob.recognition_line_id join public.accounts acc on acc.id=j.account_id where j.transaction_id=i loop
   if t.kind not in ('invoice','bill','opening_balance') or t.party_id is null then raise exception 'Invalid unpaid recognition'; end if;
   if (o.role='receivable' and o.side='debit' and t.kind in ('invoice','opening_balance')) or (o.role='payable' and o.side='credit' and t.kind in ('bill','opening_balance')) then null; else raise exception 'Invalid control recognition'; end if;
   if t.kind='opening_balance' and exists(select 1 from public.journal_lines j join public.accounts acc on acc.id=j.account_id where j.transaction_id=i and j.id<>o.recognition_line_id and acc.type<>'equity') then raise exception 'Opening unpaid balances require equity counterpart'; end if;
 end loop;
 if t.kind in ('invoice','bill') and (select count(*) from public.obligations ob join public.journal_lines j on j.id=ob.recognition_line_id where j.transaction_id=i)<>1 then raise exception 'Invoice or bill requires one unpaid item'; end if;
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

create function public.save_event(w uuid,p jsonb,post boolean default true) returns uuid
language plpgsql security definer set search_path='' as $$
declare i uuid := (p->>'id')::uuid; existing public.transactions; x jsonb;
begin
 perform public.require_workspace(w);
 if p->>'kind'='reversal' then raise exception 'Use reversal command'; end if;
 if jsonb_array_length(coalesce(p->'lines','[]'))>100 or jsonb_array_length(coalesce(p->'settlements','[]'))>50 then raise exception 'Too many postings'; end if;
 select * into existing from public.transactions where id=i;
 if found then
   if existing.workspace_id<>w then raise exception 'Transaction not found' using errcode='42501'; end if;
   if existing.posted_at is not null then
     if public.stored_event(i)<>public.canonical_event(p) then raise exception 'Retry conflicts with posted transaction'; end if;
     return i;
   end if;
   delete from public.settlements where clearing_line_id in (select id from public.journal_lines where transaction_id=i);
   delete from public.obligations where recognition_line_id in (select id from public.journal_lines where transaction_id=i);
   delete from public.journal_lines where transaction_id=i;
   update public.transactions set accounting_date=(p->>'accounting_date')::date,kind=p->>'kind',description=p->>'description',party_id=(p->>'party_id')::uuid where id=i;
 else
   insert into public.transactions(id,workspace_id,accounting_date,kind,description,party_id) values(i,w,(p->>'accounting_date')::date,p->>'kind',p->>'description',(p->>'party_id')::uuid);
 end if;
 for x in select * from jsonb_array_elements(p->'lines') loop
   if (x->>'amount')::numeric<>round((x->>'amount')::numeric,8) or (x->>'book_amount')::numeric<>round((x->>'book_amount')::numeric,8) or (x->>'exchange_rate')::numeric<>round((x->>'exchange_rate')::numeric,18) then raise exception 'Numeric precision exceeded'; end if;
   insert into public.journal_lines(id,workspace_id,transaction_id,account_id,side,amount,currency_code,exchange_rate,book_amount,rate_source) values((x->>'id')::uuid,w,i,(x->>'account_id')::uuid,x->>'side',(x->>'amount')::numeric,x->>'currency_code',(x->>'exchange_rate')::numeric,(x->>'book_amount')::numeric,x->>'rate_source');
 end loop;
 if p->'obligation' is not null and p->'obligation'<>'null'::jsonb then
   x:=p->'obligation';
   if not exists(select 1 from public.journal_lines where id=(x->>'recognition_line_id')::uuid and transaction_id=i) then raise exception 'Recognition line must belong to event'; end if;
   insert into public.obligations(id,workspace_id,recognition_line_id,reference,due_date) values((x->>'id')::uuid,w,(x->>'recognition_line_id')::uuid,x->>'reference',(x->>'due_date')::date);
 end if;
 for x in select * from jsonb_array_elements(p->'settlements') loop
   if not exists(select 1 from public.journal_lines where id=(x->>'clearing_line_id')::uuid and transaction_id=i) then raise exception 'Clearing line must belong to event'; end if;
   insert into public.settlements(id,workspace_id,obligation_id,clearing_line_id,funding_line_id) values((x->>'id')::uuid,w,(x->>'obligation_id')::uuid,(x->>'clearing_line_id')::uuid,(x->>'funding_line_id')::uuid);
 end loop;
 if post then
   perform public.validate_event(w,i);
   update public.transactions set posted_at=now() where id=i;
 end if;
 return i;
end $$;

create function public.reverse_event(w uuid,original uuid,reversal uuid,on_date date) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.transactions; existing public.transactions;
begin
 perform public.require_workspace(w);
 select * into t from public.transactions where id=original and workspace_id=w and posted_at is not null and reversal_of_id is null;
 if not found then raise exception 'Posted original not found'; end if;
 select * into existing from public.transactions where reversal_of_id=original;
 if found then
   if existing.id=reversal and existing.accounting_date=on_date then return reversal; end if;
   raise exception 'Transaction already reversed';
 end if;
 if on_date<t.accounting_date then raise exception 'Reversal predates original'; end if;
 if exists(select 1 from public.obligations o join public.journal_lines r on r.id=o.recognition_line_id join public.settlements s on s.obligation_id=o.id join public.journal_lines c on c.id=s.clearing_line_id where r.transaction_id=original and public.event_active(c.transaction_id)) then raise exception 'Reverse dependent payments first'; end if;
 -- Reversing an old payment can invalidate a later payment's carrying value.
 -- Native/book outstanding remain derived and exact; subsequent allocations use
 -- the restored carried remainder, rather than rewriting history.
 insert into public.transactions(id,workspace_id,accounting_date,kind,description,party_id,posted_at,reversal_of_id) values(reversal,w,on_date,'reversal','Reversal: '||left(t.description,490),t.party_id,now(),original);
 insert into public.journal_lines(id,workspace_id,transaction_id,account_id,side,amount,currency_code,exchange_rate,book_amount,rate_source)
 select gen_random_uuid(),w,reversal,account_id,case side when 'debit' then 'credit' else 'debit' end,amount,currency_code,exchange_rate,book_amount,rate_source from public.journal_lines where transaction_id=original;
 return reversal;
end $$;

-- Defense in depth against accidentally broadened grants in later migrations.
create function public.guard_posted() returns trigger language plpgsql set search_path='' as $$
declare target uuid;
begin
 if tg_table_name='transactions' then
   if old.posted_at is not null then raise exception 'Posted events are immutable'; end if;
 else
   if tg_table_name='journal_lines' then target:=old.transaction_id;
   elsif tg_table_name='obligations' then select transaction_id into target from public.journal_lines where id=old.recognition_line_id;
   else select transaction_id into target from public.journal_lines where id=old.clearing_line_id;
   end if;
   if exists(select 1 from public.transactions where id=target and posted_at is not null) then raise exception 'Posted postings and links are immutable'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger immutable_event before update or delete on public.transactions for each row execute function public.guard_posted();
create trigger immutable_line before update or delete on public.journal_lines for each row execute function public.guard_posted();
create trigger immutable_obligation before update or delete on public.obligations for each row execute function public.guard_posted();
create trigger immutable_settlement before update or delete on public.settlements for each row execute function public.guard_posted();
revoke all on function public.guard_posted() from public,anon,authenticated;
revoke all on function public.create_workspace(jsonb),public.save_account(uuid,jsonb),public.save_party(uuid,jsonb),public.save_event(uuid,jsonb,boolean),public.reverse_event(uuid,uuid,uuid,date) from public,anon;
grant execute on function public.create_workspace(jsonb),public.save_account(uuid,jsonb),public.save_party(uuid,jsonb),public.save_event(uuid,jsonb,boolean),public.reverse_event(uuid,uuid,uuid,date) to authenticated;
