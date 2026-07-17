-- Web bookings now need the owner's approval before they're confirmed.
-- Enum addition lives alone: a new enum value can't be *used* in the same
-- transaction that adds it, so the functions that reference it are in 0006.
alter type appointment_status add value if not exists 'pending' before 'scheduled';
