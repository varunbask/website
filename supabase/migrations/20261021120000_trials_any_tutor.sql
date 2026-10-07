-- Free trial lessons with any tutor.
--
-- The billing migration refused a 'trial' mark on any session whose tutor was
-- not an admin (trigger session_billing_trial). The old scheduler let the owner
-- mark any tutor's lesson as a free trial: the family pays nothing and the tutor
-- is still paid their standard hourly rate for it, which is how every
-- exception already works (an exception changes only what the family pays).
-- This drops that one rule and nothing else. Still enforced:
--   * a trial means the family pays 0 percent (check constraint session_billing_trial:
--     reason is distinct from 'trial' or charge_pct = 0)
--   * only the admin reads or writes session_billing (its row security policies)

drop trigger if exists session_billing_trial on public.session_billing;
drop function if exists private.session_billing_trial();
