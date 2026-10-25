-- One statement snapshot prevents a payment committed between separate table
-- requests from producing a temporarily inconsistent report.
create function public.read_snapshot(w uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.owns_workspace(w) then raise exception 'Workspace not found' using errcode='42501'; end if;
 return jsonb_build_object(
 'workspace',(select to_jsonb(ws) from public.workspaces ws where id=w),
 'accounts',coalesce((select jsonb_agg(to_jsonb(a) order by a.name,a.id) from public.accounts a where workspace_id=w),'[]'::jsonb),
 'parties',coalesce((select jsonb_agg(to_jsonb(p) order by p.name,p.id) from public.parties p where workspace_id=w),'[]'::jsonb),
 'transactions',coalesce((select jsonb_agg(to_jsonb(t) order by t.accounting_date desc,t.created_at desc) from public.transactions t where workspace_id=w),'[]'::jsonb),
 'lines',coalesce((select jsonb_agg(to_jsonb(j)||jsonb_build_object('amount',j.amount::text,'book_amount',j.book_amount::text,'exchange_rate',j.exchange_rate::text) order by j.id) from public.journal_lines j where workspace_id=w),'[]'::jsonb),
 'obligations',coalesce((select jsonb_agg(to_jsonb(o)) from public.obligations o where workspace_id=w),'[]'::jsonb),
 'settlements',coalesce((select jsonb_agg(to_jsonb(s)) from public.settlements s where workspace_id=w),'[]'::jsonb));
end $$;
revoke all on function public.read_snapshot(uuid) from public,anon;
grant execute on function public.read_snapshot(uuid) to authenticated;
