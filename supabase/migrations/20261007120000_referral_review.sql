-- Referral review. The owner approves or declines each new referral, from
-- the Approve and Decline links in its notification email or on the People
-- > Referrals tab. Statuses become new, approved and declined (contacted
-- goes; the table was empty when this shipped, and any contacted row counts
-- as approved). reviewed_at records when the latest decision was made.

alter table public.referrals drop constraint if exists referrals_status_check;
update public.referrals set status = 'approved' where status = 'contacted';
alter table public.referrals
  add constraint referrals_status_check check (status in ('new', 'approved', 'declined')),
  add column reviewed_at timestamptz;

-- Every status change stamps reviewed_at (cleared when moved back to new)
create function private.stamp_referral_review()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_at := case when new.status = 'new' then null else now() end;
  end if;
  return new;
end;
$$;
revoke execute on function private.stamp_referral_review() from public;

create trigger referrals_stamp_review
  before update of status on public.referrals
  for each row execute function private.stamp_referral_review();
