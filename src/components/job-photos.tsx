"use client";

// Before / after photos on a job: snap from the phone, see them in a 3-up grid, tap to
// view, hold the trash to delete. Uploads go straight to Storage from the browser.
import { useEffect, useRef, useState } from "react";
import { deleteJobPhoto, listJobPhotos, photoShareLinks, recordJobPhotos, type JobPhoto } from "@/lib/actions/photos";
import { photoPath, prepPhoto } from "@/lib/photos";
import { createClient } from "@/lib/supabase/client";
import { smsHref } from "@/lib/format";
import { IconPlus, IconTrash } from "./icons";
import { useToast } from "./toast";
import { Busy, ConfirmPanel, Sheet } from "./ui";

export function JobPhotos({ appointmentId, owner, customerPhone }: { appointmentId: string; owner: boolean; customerPhone: string | null }) {
  const toast = useToast();
  const [photos, setPhotos] = useState<JobPhoto[] | null>(null);
  const [uploading, setUploading] = useState<"before" | "after" | null>(null);
  const [viewing, setViewing] = useState<JobPhoto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const inputs = { before: useRef<HTMLInputElement>(null), after: useRef<HTMLInputElement>(null) };

  async function load() {
    const res = await listJobPhotos(appointmentId);
    setPhotos(res.ok ? res.photos : []);
  }
  useEffect(() => {
    let stale = false;
    listJobPhotos(appointmentId).then((res) => {
      if (!stale) setPhotos(res.ok ? res.photos : []);
    });
    return () => {
      stale = true;
    };
  }, [appointmentId]);

  async function upload(kind: "before" | "after", files: FileList | null) {
    if (!files?.length) return;
    setUploading(kind);
    const db = createClient();
    const paths: string[] = [];
    let failed = 0;
    for (const file of Array.from(files).slice(0, 10)) {
      const blob = await prepPhoto(file);
      const path = photoPath(appointmentId, kind);
      const { error } = await db.storage.from("job-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) failed++;
      else paths.push(path);
    }
    const res = await recordJobPhotos(appointmentId, paths, kind);
    setUploading(null);
    if (!res.ok) return toast({ title: "Couldn't save the photos", detail: res.error, tone: "bad" });
    if (failed) toast({ title: `${failed} photo${failed === 1 ? "" : "s"} didn't upload`, detail: "Try again on better signal.", tone: "warn" });
    else toast({ title: `${paths.length} ${kind} photo${paths.length === 1 ? "" : "s"} added` });
    await load();
  }

  async function remove(p: JobPhoto) {
    setDeleting(true);
    const res = await deleteJobPhoto(p.id);
    setDeleting(false);
    if (!res.ok) return toast({ title: "Couldn't delete that photo", detail: res.error, tone: "bad" });
    setConfirmDelete(false);
    setViewing(null);
    toast({ title: "Photo deleted" });
    await load();
  }

  async function share() {
    setSharing(true);
    const res = await photoShareLinks(appointmentId);
    setSharing(false);
    if (!res.ok) return toast({ title: "Nothing to share yet", detail: res.error, tone: "warn" });
    const href = customerPhone ? `${smsHref(customerPhone)}&body=${encodeURIComponent(res.text)}` : null;
    if (href) window.open(href, "_self");
    else {
      await navigator.clipboard.writeText(res.text);
      toast({ title: "Photo links copied", detail: "No phone on file — paste them wherever you like." });
    }
  }

  const group = (kind: "before" | "after") => {
    const list = (photos ?? []).filter((p) => p.kind === kind);
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <p className="label">
            {kind === "before" ? "Before" : "After"}
            {list.length > 0 && <span className="num"> · {list.length}</span>}
          </p>
          <button type="button" className="btn btn-sm" disabled={!!uploading} onClick={() => inputs[kind].current?.click()}>
            {uploading === kind ? <Busy>Uploading…</Busy> : (
              <>
                <IconPlus width={14} height={14} /> Add {kind}
              </>
            )}
          </button>
          <input
            ref={inputs[kind]}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="sr-only"
            aria-label={`Add ${kind} photos`}
            onChange={(e) => {
              void upload(kind, e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {list.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {list.map((p, i) => (
              <button key={p.id} type="button" className="relative aspect-[4/3] overflow-hidden rounded-md bg-muted" onClick={() => setViewing(p)} aria-label={`${kind} photo ${i + 1} of ${list.length}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URLs; next/image can't optimize them */}
                <img src={p.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {photos === null ? <p className="text-xs text-faint">Loading photos…</p> : null}
      {group("before")}
      {group("after")}
      {owner && (photos ?? []).some((p) => p.kind === "after") && (
        <button type="button" className="btn btn-sm self-start" disabled={sharing} onClick={share}>
          {sharing ? <Busy>Preparing…</Busy> : "Text photos to the customer"}
        </button>
      )}

      {viewing && (
        <Sheet open onClose={() => { setViewing(null); setConfirmDelete(false); }} title={viewing.kind === "before" ? "Before" : "After"} wide>
          <div className="flex flex-col gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, see above */}
            <img src={viewing.url} alt={`${viewing.kind} photo`} className="w-full rounded-lg bg-muted" />
            {confirmDelete ? (
              <ConfirmPanel
                title="Delete this photo?"
                consequence="It's removed from the job and from storage."
                confirmLabel="Delete photo"
                busyLabel="Deleting…"
                destructive
                pending={deleting}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={() => remove(viewing)}
              />
            ) : (
              <button type="button" className="btn btn-danger self-start" onClick={() => setConfirmDelete(true)}>
                <IconTrash width={16} height={16} /> Delete
              </button>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}
