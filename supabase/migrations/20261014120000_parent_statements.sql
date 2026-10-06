-- Parents see their own statements in the portal.
--
-- When the admin marks a month's statement sent (Account > Families), the
-- page now stores what the statement said: a snapshot of its lines, totals,
-- dates and how-to-pay note, built by portal/js/billing-text.js
-- statementSnapshot (family amounts only; never tutor pay, rates' history or
-- admin notes). The billing tables stay admin-only; the paying parent reads
-- their own sent statements through my_statements(), which returns only the
-- snapshot rows and the parent's own payments in total.

alter table public.statements
  add column snapshot  jsonb check (snapshot is null or (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) <= 200000)),
  add column due_cents integer;

grant insert (snapshot, due_cents) on public.statements to authenticated;
grant update (snapshot, due_cents) on public.statements to authenticated;

-- The caller's own sent statements (newest first), each with the caller's total
-- payments to date: every payment that is not voided, whichever month it was
-- recorded against and loose ones too. The same total is on every row; the
-- page subtracts the total saved in the snapshot when the statement was sent
-- to see what has been paid since (a voided payment lowers it again), because
-- a balance carried into a later month is paid under that later month.
-- Security definer so a parent never reads the billing tables.
create function public.my_statements()
returns table (period date, sent_on date, due_cents integer, paid_total_cents bigint, snapshot jsonb)
language sql stable security definer set search_path = ''
as $$
  with paid as (
    select coalesce(sum(p.amount_cents), 0)::bigint as total
      from public.payments p
     where p.parent_id = auth.uid() and p.voided_at is null
  )
  select s.period, s.sent_on, s.due_cents, paid.total, s.snapshot
    from public.statements s
   cross join paid
   where s.parent_id = auth.uid() and s.snapshot is not null
   order by s.period desc
$$;

revoke execute on function public.my_statements() from public, anon;
grant execute on function public.my_statements() to authenticated;
