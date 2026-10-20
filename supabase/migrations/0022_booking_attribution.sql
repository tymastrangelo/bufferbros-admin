-- Where each web booking came from: the website stamps utm/gclid/fbclid/referral
-- codes (first + last touch) and the "How did you hear about us?" answer onto the
-- appointment right after book_appointment inserts it. Feeds the Growth/marketing
-- view (cost per booking per channel). Shape: {first:{…}, last:{…}, heard:"Google"}.
alter table appointments add column if not exists attribution jsonb;
create index if not exists appointments_attribution_heard on appointments ((attribution ->> 'heard')) where attribution is not null;
