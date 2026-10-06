-- Parents see their own statements in the portal.
--
-- When the admin marks a month's statement sent (Account > Families), the
-- page now stores what the statement said: a snapshot of its lines, totals,
-- dates and how-to-pay note, built by portal/js/billing-text.js
-- statementSnapshot (family amounts only; never tutor pay, rates' history or
-- admin notes). The billing tables stay admin-only; the paying parent reads
-- their own sent statements through my_statements(), which returns only the
-- snapshot rows and what was paid for each month.

alter table public.statements
  add column snapshot  jsonb check (snapshot is null or (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) <= 200000)),
  add column due_cents integer;

grant insert (snapshot, due_cents) on public.statements to authenticated;
grant update (snapshot, due_cents) on public.statements to authenticated;

-- The caller's own sent statements (newest first) with the payments recorded
-- for each month. Security definer so a parent never reads the billing tables.
create function public.my_statements()
returns table (period date, sent_on date, due_cents integer, paid_cents bigint, snapshot jsonb)
language sql stable security definer set search_path = ''
as $$
  select s.period, s.sent_on, s.due_cents,
         coalesce((select sum(p.amount_cents) from public.payments p
                    where p.parent_id = s.parent_id and p.period = s.period and p.voided_at is null), 0)::bigint,
         s.snapshot
    from public.statements s
   where s.parent_id = auth.uid() and s.snapshot is not null
   order by s.period desc
$$;

revoke execute on function public.my_statements() from public, anon;
grant execute on function public.my_statements() to authenticated;
