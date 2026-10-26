-- 0032: tighten the 0030 policies to what the app actually needs.
--   * appointment_events: the appointments_timeline trigger (security definer) writes
--     every row — signed-in users only ever read.
--   * appointment_photos: any crew member reads and adds (same model as appointments);
--     deleting is the owner or whoever took the photo.
--   * storage.objects (job-photos): the app removes objects through the service role in
--     deleteJobPhoto, so no user-level delete policy is needed.

drop policy if exists owners_all on appointment_events;
create policy read_events on appointment_events for select to authenticated using (true);

drop policy if exists owners_all on appointment_photos;
create policy read_photos on appointment_photos for select to authenticated using (true);
-- a worker can only record a photo as their own (or anonymous); the owner can record for anyone
create policy add_photos on appointment_photos for insert to authenticated
  with check (
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner'
    or taken_by is null
    or taken_by = my_employee_id()
  );
create policy delete_own_photos on appointment_photos for delete to authenticated
  using (
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'washer') = 'owner'
    or taken_by = my_employee_id()
  );

drop policy if exists "job photos delete" on storage.objects;
