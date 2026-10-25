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

