-- Consultation requests. The "Book a free consultation" form on the landing
-- page posts to /api/referral like the referral form does, and is saved in the
-- same table: the person asking is stored as both the referrer and the family
-- (family_name, family_email, family_phone, grade, subjects, note, language),
-- so every existing check still holds. Three columns tell the two kinds apart
-- and keep what only a consultation asks for. Existing rows are referrals.
-- Visitors never read or write this table; admins read it on People > Referrals.

alter table public.referrals
  add column kind         text not null default 'referral' check (kind in ('referral', 'consultation')),
  add column contact_pref text check (contact_pref is null or char_length(contact_pref) <= 20),  -- best way to reach them
  add column lessons      text check (lessons is null or lessons in ('online', 'in_person', 'either'));
