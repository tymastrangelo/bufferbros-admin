-- Two ticks on every job, whatever the service: post a story, add photos to the album.
-- The dashboard appends them when it seeds a checklist (EVERY_JOB in src/lib/checklist.ts —
-- keep the wording in step); the column default covers jobs that never get seeded
-- (website bookings), and the update adds them to jobs already on the calendar.
alter table appointments alter column checklist set default
  '[{"id":"always:story","name":"Post a story: video or photo with music, suds on the car","done":false},{"id":"always:album","name":"Add photos to our photo album","done":false}]'::jsonb;

update appointments
set checklist = checklist ||
  '[{"id":"always:story","name":"Post a story: video or photo with music, suds on the car","done":false},{"id":"always:album","name":"Add photos to our photo album","done":false}]'::jsonb
where status in ('pending', 'scheduled')
  and not checklist @> '[{"id":"always:story"}]'::jsonb;
