-- Deleting a person who once entered a rate, recorded a payment or payout, or
-- added an adjustment: the foreign key blanks their created_by or recorded_by
-- (on delete set null), and the append-only guards from 20261010120000 refused
-- that blanking as an edit, so the delete failed. The guards now let exactly
-- that through (the column becoming null, nothing else changing) and still
-- refuse every other change. Money rows keep restricting the delete of the
-- parent or tutor they are about.

create or replace function private.void_only()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  o jsonb := to_jsonb(old) - 'voided_at' - 'void_reason' - 'note';
  n jsonb := to_jsonb(new) - 'voided_at' - 'void_reason' - 'note';
begin
  -- The person who recorded it was deleted: only recorded_by became null
  if (to_jsonb(new) - 'recorded_by') = (to_jsonb(old) - 'recorded_by')
     and new.recorded_by is null and old.recorded_by is not null then
    return new;
  end if;
  if old.voided_at is not null then
    raise exception 'already voided' using errcode = '23514';
  end if;
  if new.voided_at is null then
    raise exception 'only a void can change this row' using errcode = '23514';
  end if;
  -- payments, payouts and adjustments keep their note as recorded
  if tg_table_name in ('payments', 'payouts', 'billing_adjustments')
     and new.note is distinct from old.note then
    raise exception 'only a void can change this row' using errcode = '23514';
  end if;
  if o <> n then
    raise exception 'only a void can change this row' using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function private.rate_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  o jsonb := to_jsonb(old) - 'voided_at' - 'void_reason' - 'note';
  n jsonb := to_jsonb(new) - 'voided_at' - 'void_reason' - 'note';
  used boolean;
begin
  -- The person who entered it was deleted: only created_by became null
  if (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by')
     and new.created_by is null and old.created_by is not null then
    return new;
  end if;
  if o <> n then
    raise exception 'a rate cannot be changed; void it and add a new one' using errcode = '23514';
  end if;
  if old.voided_at is not null and (new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason) then
    raise exception 'already voided' using errcode = '23514';
  end if;
  if old.voided_at is null and new.voided_at is not null then
    if tg_table_name = 'family_rates' then
      select exists (select 1 from public.payments p, jsonb_array_elements(p.lines) l
                      where p.voided_at is null and (l ->> 'rate_id') = old.id::text) into used;
    else
      select exists (select 1 from public.payouts p, jsonb_array_elements(p.lines) l
                      where p.voided_at is null and (l ->> 'tutor_rate_id') = old.id::text) into used;
    end if;
    if used then
      raise exception 'this rate priced a paid month; add a new rate instead' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
