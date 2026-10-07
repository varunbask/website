-- Both parents see the family's bills: only when they share the whole family.
--
-- 20261022120000 let another parent read a paying parent's statement when
-- they are linked to every student on that statement. A statement's paid
-- total is every payment the paying parent has made, though, so in a
-- step-family (mom pays for Kevin, whom dad shares, and for Ava, whom he does
-- not) a month with only Kevin's lessons would show dad money paid for Ava.
-- Now the other parent also has to be linked to every student the paying
-- parent pays for today. Mom and dad of the same children see everything;
-- anyone who shares only part of a family sees none of the paying parent's
-- bills, and the paying parent still sees all of their own.
--
-- Same return type, so the function is replaced in place.

create or replace function public.my_statements()
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
             '{}'::uuid[]) as students,
           coalesce(
             (select array_agg(ps.student_id)
                from public.parent_students ps
               where ps.parent_id = s.parent_id and ps.bills),
             '{}'::uuid[]) as family
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
          or (cardinality(c.students) > 0
              and c.students <@ me.students
              and c.family <@ me.students))
   order by c.period desc, (c.parent_id = auth.uid()) desc, c.parent_id
$$;

revoke execute on function public.my_statements() from public, anon;
grant execute on function public.my_statements() to authenticated;
