-- Both parents see the family's bills.
--
-- A child can have two parents in the portal (mom and dad, each with a login),
-- and one of them gets the bill (parent_students.bills). Until now only that
-- paying parent saw the statements under Billing. Now the other parent sees
-- them too, read-only, when they are linked to every student on the
-- statement. A statement that also covers a child they are not linked to (a
-- half-sibling, say) stays with the paying parent alone.
--
-- Which students a statement covers is saved in its snapshot (student_ids,
-- written by billing-text.js statementSnapshot when the admin releases it). A
-- statement released before that falls back to the students the paying parent
-- is billed for now.
--
-- The return type grows (own, payer_id, payer_name), so the function is
-- dropped and made again. paid_total_cents is the paying parent's payments,
-- whoever is reading. Security definer so a parent never reads the billing
-- tables.

drop function public.my_statements();

create function public.my_statements()
returns table (
  period date,
  sent_on date,
  due_cents integer,
  paid_total_cents bigint,
  snapshot jsonb,
  own boolean,
  payer_id uuid,
  payer_name text
)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select coalesce(array_agg(ps.student_id), '{}'::uuid[]) as students
      from public.parent_students ps
     where ps.parent_id = auth.uid()
  ),
  covered as (
    select s.parent_id, s.period, s.sent_on, s.due_cents, s.snapshot,
           coalesce(
             (select array_agg(x::uuid)
                from jsonb_array_elements_text(
                       case when jsonb_typeof(s.snapshot -> 'student_ids') = 'array' then s.snapshot -> 'student_ids' end) x
               where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
             (select array_agg(ps.student_id)
                from public.parent_students ps
               where ps.parent_id = s.parent_id and ps.bills),
             '{}'::uuid[]) as students
      from public.statements s
     where s.snapshot is not null
  )
  select c.period, c.sent_on, c.due_cents,
         (select coalesce(sum(p.amount_cents), 0)::bigint
            from public.payments p
           where p.parent_id = c.parent_id and p.voided_at is null),
         c.snapshot,
         c.parent_id = auth.uid(),
         c.parent_id,
         coalesce((select pr.full_name from public.profiles pr where pr.id = c.parent_id), '')
    from covered c
   cross join me
   where auth.uid() is not null
     and (c.parent_id = auth.uid()
          or (cardinality(c.students) > 0 and c.students <@ me.students))
   order by c.period desc, (c.parent_id = auth.uid()) desc, c.parent_id
$$;

revoke execute on function public.my_statements() from public, anon;
grant execute on function public.my_statements() to authenticated;
