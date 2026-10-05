-- The admin's Account page: monthly family billing and biweekly tutor pay,
-- computed from the sessions on the calendar. The portal never stores hours or
-- amounts owed; it prices each session in the browser (portal/js/billing-model.js)
-- from the rates and policy below. What is stored is what a person decided:
-- rates with the date they apply from, per-session exceptions, payments
-- received, payouts made, adjustments, and when a statement was sent.
--
-- Every table here is admin only. Money rows are append only: a mistake is
-- voided with a reason (one way), never edited or deleted. Payments and payouts
-- keep a snapshot of the lines they covered, so a later calendar change shows
-- as a difference instead of rewriting what was paid.
--
-- Sessions gain cancelled_at (stamped by session_touch), an audit of the four
-- columns money depends on, and a guard: once a session has ended only an admin
-- can retime or delete it, and once its month or pay period is paid only an
-- admin can change its time, status or attendance. The Google sync and the
-- sweep (service role) are not guarded; their changes are audited like anyone's
-- and the Account page lists them for review.

-- Which linked parent gets the bill (at most one per student; see "Who pays" below)
alter table public.parent_students add column bills boolean not null default false;

-- ---------------------------------------------------------------------------
-- Settings and policy

create table public.billing_settings (
  id                 smallint primary key default 1 check (id = 1),
  business_name      text not null default 'VP Education Group' check (char_length(btrim(business_name)) between 1 and 80),
  payroll_anchor     date not null default '2026-11-01' check (extract(dow from payroll_anchor) = 0),  -- a Sunday
  pay_lag_days       smallint not null default 6 check (pay_lag_days between 0 and 7),
  due_day            smallint not null default 15 check (due_day between 1 and 28),   -- of the month after the billed one
  ledger_start       date not null default '2026-11-01' check (extract(day from ledger_start) = 1),
  referral_payee     text check (char_length(btrim(referral_payee)) between 1 and 80),
  referral_min_cents integer not null default 0 check (referral_min_cents between 0 and 1000000),  -- per pay period
  pay_note           text check (char_length(pay_note) <= 2000),                       -- printed on statements
  updated_by         uuid references public.profiles (id) on delete set null,
  updated_at         timestamptz not null default now()
);
insert into public.billing_settings (id) values (1);

-- No-show and unconfirmed rules, with history: the row with the latest
-- effective_from on or before a session's day applies to it
create table public.billing_policies (
  id                bigint generated always as identity primary key,
  effective_from    date not null unique,
  absent_family_pct smallint not null default 100 check (absent_family_pct between 0 and 100),
  absent_tutor_pct  smallint not null default 100 check (absent_tutor_pct between 0 and 100),
  count_unconfirmed boolean not null default true,   -- ended without attendance counts on screen
  created_by        uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);
insert into public.billing_policies (effective_from) values ('2026-11-01');

-- ---------------------------------------------------------------------------
-- Rates (never deleted; a wrong row is voided and a new one added)

-- What a family pays per hour for a student, by subject and optionally tutor.
-- A null subject or tutor means any.
create table public.family_rates (
  id             bigint generated always as identity primary key,
  student_id     uuid not null references public.profiles (id) on delete cascade,
  subject        text check (subject is null or char_length(btrim(subject)) between 1 and 60),
  tutor_id       uuid references public.profiles (id) on delete cascade,
  rate_cents     integer not null check (rate_cents between 0 and 100000),
  effective_from date not null,
  note           text check (char_length(note) <= 200),
  created_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  void_reason    text check (char_length(btrim(void_reason)) between 1 and 300),
  constraint family_rates_void check ((voided_at is null) = (void_reason is null))
);
create unique index family_rates_key on public.family_rates
  (student_id, coalesce(lower(btrim(subject)), ''), coalesce(tutor_id, '00000000-0000-0000-0000-000000000000'::uuid), effective_from)
  where voided_at is null;
create index family_rates_student_idx on public.family_rates (student_id, effective_from desc);

-- What a tutor (or a teaching admin, at $0) earns per hour, with the referral
-- fee per taught hour owed to billing_settings.referral_payee
create table public.tutor_rates (
  id             bigint generated always as identity primary key,
  tutor_id       uuid not null references public.profiles (id) on delete cascade,
  rate_cents     integer not null check (rate_cents between 0 and 100000),
  referral_cents integer not null default 0 check (referral_cents between 0 and 10000),
  effective_from date not null,
  note           text check (char_length(note) <= 200),
  created_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  void_reason    text check (char_length(btrim(void_reason)) between 1 and 300),
  constraint tutor_rates_void check ((voided_at is null) = (void_reason is null))
);
create unique index tutor_rates_key on public.tutor_rates (tutor_id, effective_from) where voided_at is null;

-- ---------------------------------------------------------------------------
-- Per-session exception, group membership and review mark

create table public.session_billing (
  session_id  bigint primary key references public.sessions (id) on delete cascade,
  charge_pct  smallint check (charge_pct between 0 and 100),   -- family; null = follow the policy
  pay_pct     smallint check (pay_pct between 0 and 100),      -- tutor; null = follow the policy
  reason      text check (reason in ('late_cancel', 'no_show_forgiven', 'trial', 'other')),
  group_key   text check (char_length(btrim(group_key)) between 1 and 40),  -- same key, tutor and day = one paid slot
  note        text check (char_length(note) <= 200),
  reviewed_at timestamptz,                                      -- Accept on the Needs attention list
  reviewed_by uuid references public.profiles (id) on delete set null,
  updated_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint session_billing_reason check (reason is null or charge_pct is not null or pay_pct is not null)
);
create index session_billing_group_idx on public.session_billing (group_key) where group_key is not null;

-- ---------------------------------------------------------------------------
-- Audit of the columns money depends on (written by trigger, admin read only)

create table public.session_edits (
  id             bigint generated always as identity primary key,
  session_id     bigint not null,             -- no foreign key: rows outlive deleted sessions
  student_id     uuid not null,
  tutor_id       uuid not null,
  editor         uuid,                        -- null for the service role (Google sync, sweep)
  action         text not null check (action in ('update', 'delete')),
  old_starts_at  timestamptz,
  new_starts_at  timestamptz,
  old_ends_at    timestamptz,
  new_ends_at    timestamptz,
  old_status     text,
  new_status     text,
  old_attendance text,
  new_attendance text,
  at             timestamptz not null default now()
);
create index session_edits_session_idx on public.session_edits (session_id, at desc);
create index session_edits_at_idx on public.session_edits (at desc);

-- ---------------------------------------------------------------------------
-- Money that moved (append only)

-- Received from a paying parent. period: the first day of the billed month, or
-- null for a prepayment or a transfer covering several months.
create table public.payments (
  id           bigint generated always as identity primary key,
  client_key   uuid not null unique,                         -- one row per form, however often it is sent
  parent_id    uuid not null references public.profiles (id) on delete restrict,
  payer_name   text not null default '',                     -- copied from the profile by trigger
  period       date check (period is null or extract(day from period) = 1),
  amount_cents integer not null check (amount_cents <> 0 and abs(amount_cents) <= 10000000),  -- negative = refund
  method       text not null default 'zelle' check (method in ('zelle', 'venmo', 'check', 'cash', 'card', 'other')),
  received_on  date not null default (now() at time zone 'America/Los_Angeles')::date,
  reference    text check (char_length(reference) <= 120),
  note         text check (char_length(note) <= 500),
  lines        jsonb not null default '[]' check (jsonb_typeof(lines) = 'array' and pg_column_size(lines) <= 200000),
  owed_cents   integer not null default 0 check (abs(owed_cents) <= 100000000),  -- what the page showed as owed
  recorded_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  void_reason  text check (char_length(btrim(void_reason)) between 1 and 300),
  constraint payments_void check ((voided_at is null) = (void_reason is null))
);
create index payments_parent_idx on public.payments (parent_id, period);

-- Paid to a tutor for a pay period, to the referral payee, or an opening
-- balance for what was paid this year before the portal
create table public.payouts (
  id           bigint generated always as identity primary key,
  client_key   uuid not null unique,
  kind         text not null default 'tutor' check (kind in ('tutor', 'referral', 'opening')),
  tutor_id     uuid references public.profiles (id) on delete restrict,   -- null only for kind = 'referral'
  payee_name   text not null default '',                                  -- copied by trigger
  period_start date not null,
  amount_cents integer not null check (abs(amount_cents) <= 10000000),
  minutes      integer not null default 0 check (minutes between 0 and 1000000),  -- payable minutes at pay time
  owed_cents   integer not null default 0 check (abs(owed_cents) <= 100000000),
  method       text not null default 'zelle' check (method in ('zelle', 'venmo', 'check', 'cash', 'payroll', 'other')),
  paid_on      date not null default (now() at time zone 'America/Los_Angeles')::date,
  reference    text check (char_length(reference) <= 120),
  note         text check (char_length(note) <= 500),
  lines        jsonb not null default '[]' check (jsonb_typeof(lines) = 'array' and pg_column_size(lines) <= 200000),
  recorded_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  void_reason  text check (char_length(btrim(void_reason)) between 1 and 300),
  constraint payouts_payee check ((kind = 'referral') = (tutor_id is null)),
  constraint payouts_zero  check (amount_cents <> 0 or (kind = 'tutor' and minutes > 0)),
  constraint payouts_void  check ((voided_at is null) = (void_reason is null))
);
create index payouts_period_idx on public.payouts (period_start, tutor_id);
create unique index payouts_opening_key on public.payouts (tutor_id) where kind = 'opening' and voided_at is null;

-- Fees, discounts and credits for a family month; bonuses, reimbursements and
-- deductions for a tutor period. Positive = more owed.
create table public.billing_adjustments (
  id           bigint generated always as identity primary key,
  client_key   uuid not null unique,
  party        text not null check (party in ('family', 'tutor')),
  party_id     uuid not null references public.profiles (id) on delete restrict,
  period       date not null,              -- month start (family) or period start (tutor)
  amount_cents integer not null check (amount_cents <> 0 and abs(amount_cents) <= 10000000),
  label        text not null check (label in ('late_fee', 'discount', 'credit', 'bonus', 'reimbursement', 'deduction', 'other')),
  note         text check (char_length(note) <= 300),
  recorded_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  void_reason  text check (char_length(btrim(void_reason)) between 1 and 300),
  constraint adjustments_void check ((voided_at is null) = (void_reason is null)),
  constraint adjustments_month check (party = 'tutor' or extract(day from period) = 1)
);
create index billing_adjustments_idx on public.billing_adjustments (party, party_id, period);

-- How to reach and get paid by a paying parent
create table public.billing_contacts (
  parent_id        uuid primary key references public.profiles (id) on delete cascade,
  phone            text check (char_length(phone) <= 40),
  pay_handle       text check (char_length(pay_handle) <= 120),
  preferred_method text check (preferred_method in ('zelle', 'venmo', 'check', 'cash', 'card', 'other')),
  billing_note     text check (char_length(billing_note) <= 500),
  updated_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now()
);

-- When a family's statement for a month went out
create table public.statements (
  parent_id uuid not null references public.profiles (id) on delete cascade,
  period    date not null check (extract(day from period) = 1),
  sent_on   date not null default (now() at time zone 'America/Los_Angeles')::date,
  sent_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  primary key (parent_id, period)
);

-- ---------------------------------------------------------------------------
-- Helpers

-- The first day of the pay period holding p_day: periods are 14 days from the anchor Sunday
create function private.pay_period_start(p_day date)
returns date
language sql stable security definer set search_path = ''
as $$
  select s.payroll_anchor + (14 * floor((p_day - s.payroll_anchor) / 14.0))::integer
    from public.billing_settings s
   where s.id = 1
$$;
revoke execute on function private.pay_period_start(date) from public;

-- The parent who pays for a student (at most one; see parent_students.bills)
create function private.payer_of(p_student uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select ps.parent_id from public.parent_students ps where ps.student_id = p_student and ps.bills limit 1
$$;
revoke execute on function private.payer_of(uuid) from public;

-- True when money has moved for the session's day: a tutor payout covers its
-- pay period, or the paying parent has a payment for its month
create function private.day_is_paid(p_tutor uuid, p_student uuid, p_day date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.payouts po
                  where po.kind = 'tutor' and po.voided_at is null
                    and po.tutor_id = p_tutor and po.period_start = private.pay_period_start(p_day))
      or exists (select 1 from public.payments pa
                  where pa.voided_at is null
                    and pa.parent_id = private.payer_of(p_student)
                    and pa.period = date_trunc('month', p_day)::date)
$$;
revoke execute on function private.day_is_paid(uuid, uuid, date) from public;

-- ---------------------------------------------------------------------------
-- Settings: who changed them; the anchor is frozen once any payout exists

create function private.billing_settings_touch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.payroll_anchor is distinct from old.payroll_anchor
     and exists (select 1 from public.payouts where kind <> 'opening') then
    raise exception 'payroll anchor is frozen once a payout exists' using errcode = '23514';
  end if;
  if new.ledger_start > old.ledger_start
     and (exists (select 1 from public.payments where voided_at is null and period < new.ledger_start)
          or exists (select 1 from public.payouts where voided_at is null and kind = 'tutor' and period_start < new.ledger_start)) then
    raise exception 'money is recorded before that ledger start' using errcode = '23514';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end
$$;
revoke execute on function private.billing_settings_touch() from public;
create trigger billing_settings_touch
  before update on public.billing_settings
  for each row execute function private.billing_settings_touch();

-- ---------------------------------------------------------------------------
-- Append-only rows: a void is one way and needs a reason; nothing else changes

create function private.void_only()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  o jsonb := to_jsonb(old) - 'voided_at' - 'void_reason' - 'note';
  n jsonb := to_jsonb(new) - 'voided_at' - 'void_reason' - 'note';
begin
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
revoke execute on function private.void_only() from public;

-- Rates: the note may change; a void is one way, and refused while a recorded
-- payment or payout priced a line with the row
create function private.rate_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  o jsonb := to_jsonb(old) - 'voided_at' - 'void_reason' - 'note';
  n jsonb := to_jsonb(new) - 'voided_at' - 'void_reason' - 'note';
  used boolean;
begin
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
revoke execute on function private.rate_guard() from public;

create trigger family_rates_guard before update on public.family_rates
  for each row execute function private.rate_guard();
create trigger tutor_rates_guard before update on public.tutor_rates
  for each row execute function private.rate_guard();

-- Payments: the payer's name is copied, and every session line must be one of
-- the parent's students
create function private.payments_fill()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.payer_name := coalesce((select p.full_name from public.profiles p where p.id = new.parent_id), '');
  if exists (select 1 from jsonb_array_elements(new.lines) l
              where l ? 'student_id'
                and not exists (select 1 from public.parent_students ps
                                 where ps.parent_id = new.parent_id
                                   and ps.student_id::text = (l ->> 'student_id'))) then
    raise exception 'a line is for a student of another family' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function private.payments_fill() from public;
create trigger payments_fill before insert on public.payments
  for each row execute function private.payments_fill();
create trigger payments_void_only before update on public.payments
  for each row execute function private.void_only();

create function private.payouts_fill()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'referral' then
    new.payee_name := coalesce((select s.referral_payee from public.billing_settings s where s.id = 1), 'Referral');
  else
    new.payee_name := coalesce((select p.full_name from public.profiles p where p.id = new.tutor_id), '');
  end if;
  return new;
end
$$;
revoke execute on function private.payouts_fill() from public;
create trigger payouts_fill before insert on public.payouts
  for each row execute function private.payouts_fill();
create trigger payouts_void_only before update on public.payouts
  for each row execute function private.void_only();
create trigger billing_adjustments_void_only before update on public.billing_adjustments
  for each row execute function private.void_only();

-- Exceptions and contacts: who changed them last
create function private.billing_touch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end
$$;
revoke execute on function private.billing_touch() from public;
create trigger session_billing_touch before update on public.session_billing
  for each row execute function private.billing_touch();
create trigger billing_contacts_touch before update on public.billing_contacts
  for each row execute function private.billing_touch();

-- ---------------------------------------------------------------------------
-- Who pays: at most one linked parent per student, the first one by default

update public.parent_students ps set bills = true
 where not exists (select 1 from public.parent_students o
                    where o.student_id = ps.student_id
                      and (o.created_at, o.parent_id::text) < (ps.created_at, ps.parent_id::text));
create unique index parent_students_one_payer on public.parent_students (student_id) where bills;

create function private.parent_students_payer()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not new.bills and not exists (select 1 from public.parent_students ps
                                    where ps.student_id = new.student_id and ps.bills) then
    new.bills := true;
  end if;
  return new;
end
$$;
revoke execute on function private.parent_students_payer() from public;
create trigger parent_students_payer before insert on public.parent_students
  for each row execute function private.parent_students_payer();

grant update (bills) on public.parent_students to authenticated;

-- Moves a student's bill to another linked parent in one statement (admin)
create function public.set_payer(p_student uuid, p_parent uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.parent_students where student_id = p_student and parent_id = p_parent) then
    raise exception 'that parent is not linked to the student' using errcode = '22023';
  end if;
  update public.parent_students set bills = false where student_id = p_student and bills and parent_id <> p_parent;
  update public.parent_students set bills = true where student_id = p_student and parent_id = p_parent;
end
$$;
revoke execute on function public.set_payer(uuid, uuid) from public, anon;
grant execute on function public.set_payer(uuid, uuid) to authenticated;
create policy "admin picks the payer" on public.parent_students
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Sessions: cancelled_at, a guard for ended and paid sessions, and an audit

alter table public.sessions add column cancelled_at timestamptz;

create or replace function private.session_touch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.starts_at is distinct from old.starts_at then
    new.moved_from := old.starts_at;
  end if;
  -- Only a change of time or status is news for the family; a new plan or place is not
  if new.starts_at is distinct from old.starts_at or new.status is distinct from old.status then
    new.changed_at := now();
  end if;
  -- When it was cancelled, so short notice can be told apart
  if new.status is distinct from old.status then
    new.cancelled_at := case when new.status = 'cancelled' then now() else null end;
  end if;
  return new;
end
$$;

-- Runs before sessions_mark_pending and sessions_touch (triggers fire by name),
-- so a refused change never reaches them. Only signed-in people other than the
-- admin are guarded: the Google sync and the sweep (service role), the Supabase
-- dashboard and account deletion carry no auth.uid() and pass. Sessions still
-- to come are never locked: a family may pay ahead, a period may be paid early.
-- Errcodes: VP001 a session that happened, VP002 a paid month or pay period.
create function private.sessions_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  tz constant text := 'America/Los_Angeles';
  retimed boolean;
begin
  if auth.uid() is null or private.is_service_request() or private.is_admin() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.ends_at <= now() then
      raise exception 'A session that already happened can be cancelled, not deleted' using errcode = 'VP001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.ends_at <= now() and private.day_is_paid(new.tutor_id, new.student_id, (new.starts_at at time zone tz)::date) then
      raise exception 'That day is in a month or pay period that has been paid; ask the admin' using errcode = 'VP002';
    end if;
    return new;
  end if;
  retimed := new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at;
  if retimed and (old.ends_at <= now() or new.ends_at <= now()) then
    raise exception 'Only the admin can change the time of a session that already happened, or move one into the past' using errcode = 'VP001';
  end if;
  if old.ends_at <= now()
     and (new.status is distinct from old.status or new.attendance is distinct from old.attendance)
     and private.day_is_paid(old.tutor_id, old.student_id, (old.starts_at at time zone tz)::date) then
    raise exception 'This session is in a month or pay period that has been paid; ask the admin' using errcode = 'VP002';
  end if;
  return new;
end
$$;
revoke execute on function private.sessions_guard() from public;
create trigger sessions_guard
  before insert or update or delete on public.sessions
  for each row execute function private.sessions_guard();

-- Only the four columns money depends on are recorded, so the sync's own
-- bookkeeping (sync_state, etag, google ids) adds nothing
create function private.sessions_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  who uuid := case when private.is_service_request() then null else auth.uid() end;
begin
  if tg_op = 'DELETE' then
    insert into public.session_edits (session_id, student_id, tutor_id, editor, action,
      old_starts_at, old_ends_at, old_status, old_attendance)
    values (old.id, old.student_id, old.tutor_id, who, 'delete',
      old.starts_at, old.ends_at, old.status::text, old.attendance);
    return old;
  end if;
  if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
     or new.status is distinct from old.status or new.attendance is distinct from old.attendance then
    insert into public.session_edits (session_id, student_id, tutor_id, editor, action,
      old_starts_at, new_starts_at, old_ends_at, new_ends_at, old_status, new_status, old_attendance, new_attendance)
    values (new.id, new.student_id, new.tutor_id, who, 'update',
      old.starts_at, new.starts_at, old.ends_at, new.ends_at, old.status::text, new.status::text,
      old.attendance, new.attendance);
  end if;
  return new;
end
$$;
revoke execute on function private.sessions_audit() from public;
create trigger sessions_audit
  after update or delete on public.sessions
  for each row execute function private.sessions_audit();

-- "This and following" never reaches back past now: a series edited from a
-- session that already happened changes the ones still to come (and, for the
-- admin, that session itself)
create or replace function public.edit_following_sessions(
  p_session bigint, p_shift integer, p_start_delta integer, p_end_delta integer, p_fields jsonb default '{}'::jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  s       public.sessions%rowtype;
  tz      constant text := 'America/Los_Angeles';
  changed integer;
  f       jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  select * into s from public.sessions where id = p_session;
  if not found or s.series_id is null or not private.can_change_sessions(s.tutor_id, s.student_id) then
    raise exception 'session not found' using errcode = '42501';
  end if;
  if p_shift is null or p_start_delta is null or p_end_delta is null
     or abs(p_shift) > 366 or abs(p_start_delta) > 1440 or abs(p_end_delta) > 1440 then
    raise exception 'bad change' using errcode = '22023';
  end if;

  with target as (
    select x.id,
           ((x.starts_at at time zone tz)::date + p_shift
              + private.shift_minutes((x.starts_at at time zone tz)::time, p_start_delta)) at time zone tz as new_start,
           ((x.ends_at at time zone tz)::date + p_shift
              + private.shift_minutes((x.ends_at at time zone tz)::time, p_end_delta)) at time zone tz as new_end,
           case when f ? 'subject' then nullif(btrim(f ->> 'subject'), '') else x.subject end as new_subject,
           case when f ? 'location' then nullif(btrim(f ->> 'location'), '') else x.location end as new_location,
           case when f ? 'meeting_url' then nullif(btrim(f ->> 'meeting_url'), '') else x.meeting_url end as new_url,
           case when f ? 'notes' then nullif(btrim(f ->> 'notes'), '') else x.notes end as new_notes
      from public.sessions x
     where x.series_id = s.series_id
       and x.tutor_id = s.tutor_id
       and x.student_id = s.student_id
       and ((x.id = s.id and (x.ends_at > now() or private.is_admin()))
            or x.starts_at >= greatest(s.starts_at, now()))
  )
  update public.sessions x
     set starts_at = t.new_start, ends_at = t.new_end, subject = t.new_subject,
         location = t.new_location, meeting_url = t.new_url, notes = t.new_notes
    from target t
   where x.id = t.id
     and (x.starts_at, x.ends_at, x.subject, x.location, x.meeting_url, x.notes)
         is distinct from (t.new_start, t.new_end, t.new_subject, t.new_location, t.new_url, t.new_notes);
  get diagnostics changed = row_count;

  update public.session_series r
     set start_time  = private.shift_minutes(r.start_time, p_start_delta),
         end_time    = private.shift_minutes(r.end_time, p_end_delta),
         last_date   = r.last_date + p_shift,
         until       = case when r.until is null then null else r.until + p_shift end,
         subject     = case when f ? 'subject' then nullif(btrim(f ->> 'subject'), '') else r.subject end,
         location    = case when f ? 'location' then nullif(btrim(f ->> 'location'), '') else r.location end,
         meeting_url = case when f ? 'meeting_url' then nullif(btrim(f ->> 'meeting_url'), '') else r.meeting_url end,
         notes       = case when f ? 'notes' then nullif(btrim(f ->> 'notes'), '') else r.notes end,
         updated_at  = now()
   where r.id = s.series_id
     and r.tutor_id = s.tutor_id
     and r.student_id = s.student_id;
  return changed;
end
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row security: admin only, on every table

revoke all on public.billing_settings, public.billing_policies, public.family_rates, public.tutor_rates,
              public.session_billing, public.session_edits, public.payments, public.payouts,
              public.billing_adjustments, public.billing_contacts, public.statements
  from anon, authenticated;
grant all on public.billing_settings, public.billing_policies, public.family_rates, public.tutor_rates,
             public.session_billing, public.session_edits, public.payments, public.payouts,
             public.billing_adjustments, public.billing_contacts, public.statements
  to service_role;

grant select on public.billing_settings, public.billing_policies, public.family_rates, public.tutor_rates,
                public.session_billing, public.session_edits, public.payments, public.payouts,
                public.billing_adjustments, public.billing_contacts, public.statements
  to authenticated;
grant update (business_name, payroll_anchor, pay_lag_days, due_day, ledger_start, referral_payee,
              referral_min_cents, pay_note) on public.billing_settings to authenticated;
grant insert (effective_from, absent_family_pct, absent_tutor_pct, count_unconfirmed)
  on public.billing_policies to authenticated;
grant insert (student_id, subject, tutor_id, rate_cents, effective_from, note) on public.family_rates to authenticated;
grant update (note, voided_at, void_reason) on public.family_rates to authenticated;
grant insert (tutor_id, rate_cents, referral_cents, effective_from, note) on public.tutor_rates to authenticated;
grant update (note, voided_at, void_reason) on public.tutor_rates to authenticated;
grant delete on public.session_billing to authenticated;
grant insert (session_id, charge_pct, pay_pct, reason, group_key, note, reviewed_at, reviewed_by)
  on public.session_billing to authenticated;
grant update (charge_pct, pay_pct, reason, group_key, note, reviewed_at, reviewed_by)
  on public.session_billing to authenticated;
grant insert (client_key, parent_id, period, amount_cents, method, received_on, reference, note, lines, owed_cents)
  on public.payments to authenticated;
grant update (voided_at, void_reason) on public.payments to authenticated;
grant insert (client_key, kind, tutor_id, period_start, amount_cents, minutes, owed_cents, method, paid_on,
              reference, note, lines) on public.payouts to authenticated;
grant update (voided_at, void_reason) on public.payouts to authenticated;
grant insert (client_key, party, party_id, period, amount_cents, label, note) on public.billing_adjustments to authenticated;
grant update (voided_at, void_reason) on public.billing_adjustments to authenticated;
grant delete on public.billing_contacts to authenticated;
grant insert (parent_id, phone, pay_handle, preferred_method, billing_note) on public.billing_contacts to authenticated;
grant update (phone, pay_handle, preferred_method, billing_note) on public.billing_contacts to authenticated;
grant delete on public.statements to authenticated;
grant insert (parent_id, period, sent_on) on public.statements to authenticated;
grant update (sent_on) on public.statements to authenticated;

alter table public.billing_settings    enable row level security;
alter table public.billing_policies    enable row level security;
alter table public.family_rates        enable row level security;
alter table public.tutor_rates         enable row level security;
alter table public.session_billing     enable row level security;
alter table public.session_edits       enable row level security;
alter table public.payments            enable row level security;
alter table public.payouts             enable row level security;
alter table public.billing_adjustments enable row level security;
alter table public.billing_contacts    enable row level security;
alter table public.statements          enable row level security;

-- Reads: admin only
create policy "admin reads billing settings" on public.billing_settings for select to authenticated using ((select private.is_admin()));
create policy "admin reads billing policies" on public.billing_policies for select to authenticated using ((select private.is_admin()));
create policy "admin reads family rates"     on public.family_rates     for select to authenticated using ((select private.is_admin()));
create policy "admin reads tutor rates"      on public.tutor_rates      for select to authenticated using ((select private.is_admin()));
create policy "admin reads session billing"  on public.session_billing  for select to authenticated using ((select private.is_admin()));
create policy "admin reads session edits"    on public.session_edits    for select to authenticated using ((select private.is_admin()));
create policy "admin reads payments"         on public.payments         for select to authenticated using ((select private.is_admin()));
create policy "admin reads payouts"          on public.payouts          for select to authenticated using ((select private.is_admin()));
create policy "admin reads adjustments"      on public.billing_adjustments for select to authenticated using ((select private.is_admin()));
create policy "admin reads billing contacts" on public.billing_contacts for select to authenticated using ((select private.is_admin()));
create policy "admin reads statements"       on public.statements       for select to authenticated using ((select private.is_admin()));

-- Writes: admin only, and a column naming a person must name the right kind of person
create policy "admin changes billing settings" on public.billing_settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin adds billing policies" on public.billing_policies for insert to authenticated
  with check ((select private.is_admin()));

create policy "admin adds family rates" on public.family_rates for insert to authenticated
  with check ((select private.is_admin()) and private.has_role(student_id, 'student')
              and (tutor_id is null or private.has_role(tutor_id, 'tutor') or private.has_role(tutor_id, 'admin')));
create policy "admin voids family rates" on public.family_rates for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin adds tutor rates" on public.tutor_rates for insert to authenticated
  with check ((select private.is_admin()) and (private.has_role(tutor_id, 'tutor') or private.has_role(tutor_id, 'admin')));
create policy "admin voids tutor rates" on public.tutor_rates for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "admin adds session billing" on public.session_billing for insert to authenticated
  with check ((select private.is_admin()));
create policy "admin changes session billing" on public.session_billing for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin removes session billing" on public.session_billing for delete to authenticated
  using ((select private.is_admin()));

create policy "admin records payments" on public.payments for insert to authenticated
  with check ((select private.is_admin()) and private.has_role(parent_id, 'parent'));
create policy "admin voids payments" on public.payments for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin records payouts" on public.payouts for insert to authenticated
  with check ((select private.is_admin())
              and (tutor_id is null or private.has_role(tutor_id, 'tutor') or private.has_role(tutor_id, 'admin')));
create policy "admin voids payouts" on public.payouts for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin records adjustments" on public.billing_adjustments for insert to authenticated
  with check ((select private.is_admin())
              and ((party = 'family' and private.has_role(party_id, 'parent'))
                   or (party = 'tutor' and (private.has_role(party_id, 'tutor') or private.has_role(party_id, 'admin')))));
create policy "admin voids adjustments" on public.billing_adjustments for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "admin adds billing contacts" on public.billing_contacts for insert to authenticated
  with check ((select private.is_admin()) and private.has_role(parent_id, 'parent'));
create policy "admin changes billing contacts" on public.billing_contacts for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin removes billing contacts" on public.billing_contacts for delete to authenticated
  using ((select private.is_admin()));

create policy "admin marks statements sent" on public.statements for insert to authenticated
  with check ((select private.is_admin()) and private.has_role(parent_id, 'parent'));
create policy "admin changes statements" on public.statements for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin removes statements" on public.statements for delete to authenticated
  using ((select private.is_admin()));
