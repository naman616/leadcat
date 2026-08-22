-- ============================================================================
-- Phase 2 slice: project_media — metadata only (id, type, file name, storage
-- path, uploader) for a project's brochures / floor plans / price sheets /
-- RERA docs. RLS enabled in this same migration, same discipline as every
-- other tenant table. docs/specs/02-inventory.md previously listed this
-- table under "explicitly deferred" pending a storage decision — this
-- migration lands the metadata layer only. storage_path is a plain string
-- (where a Supabase Storage object key/URL will eventually go); wiring an
-- actual upload flow against a real bucket is still deferred.
-- ============================================================================

-- CreateEnum
CREATE TYPE "project_media_type" AS ENUM ('brochure', 'floor_plan', 'price_sheet', 'rera_doc', 'other');

-- CreateTable
CREATE TABLE "project_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "type" "project_media_type" NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — the per-project media list view filters on this.
CREATE INDEX "project_media_org_id_project_id_idx" ON "project_media"("org_id", "project_id");

-- AddForeignKey
ALTER TABLE "project_media" ADD CONSTRAINT "project_media_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_media" ADD CONSTRAINT "project_media_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_media" ADD CONSTRAINT "project_media_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- Row Level Security.
--
-- Any org member can view a project's media — same openness as contacts /
-- projects/towers/units elsewhere in this app. Upload and delete are
-- admin-gated: mirrors the exact shape and reasoning of "org admins can
-- delete contacts" in 20260818230000_contacts_dedup (app.is_org_admin(org_id),
-- which treats 'owner' and 'admin' as admin-level — see app.is_org_admin in
-- 20260815054857_init). A shared media library is more sensitive to
-- accidental/malicious churn (wrong price sheet uploaded, RERA doc deleted)
-- than the fully-open write access projects/towers/units get, so this
-- doesn't reuse their "any member can write" shape. No UPDATE policy —
-- media rows are replace-by-delete-and-reupload, not edited in place
-- (append-only, same shape as lead_activities); an attempted UPDATE fails
-- closed like any other RLS-blocked write in this app, no trigger needed.
-- ============================================================================

ALTER TABLE public.project_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view project media"
  ON public.project_media FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org admins can upload project media"
  ON public.project_media FOR INSERT
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can delete project media"
  ON public.project_media FOR DELETE
  USING (app.is_org_admin(org_id));
