-- ============================================================================
-- Phase 3 slice (issue #25): ad_accounts -> campaigns -> ad_sets -> ads.
-- Schema + manual admin CRUD only — see docs/specs/05-ad-attribution.md.
--
-- Deliberately NO foreign key from public.leads into any of these four
-- tables. Lead.ad_id / ad_set_id / campaign_id / source_id (added nullable
-- in 20260815102606_leads_core) stay freely-settable UUIDs: a lead's
-- attribution can arrive via webhook (Phase 3, not built yet) before this
-- org's ad metadata has been synced for that specific ad. An FK would
-- reject a lead insert whenever sync lags behind the ad platform's own
-- webhook delivery, which real ad-tech integrations do not guarantee stay
-- in order. The real Meta/Google API sync that would populate these tables
-- from live ad accounts is Phase 3.5 (issues #27-29), blocked on vendor
-- credentials — this migration only lands the schema an org admin can
-- hand-enter into today.
-- ============================================================================

-- CreateEnum
CREATE TYPE "ad_platform" AS ENUM ('meta', 'google');

-- CreateTable
CREATE TABLE "ad_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "platform" "ad_platform" NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "ad_account_id" UUID NOT NULL,
    "external_campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_sets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "external_ad_set_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "ad_set_id" UUID NOT NULL,
    "external_ad_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — every list-by-parent view below filters on these.
CREATE INDEX "ad_accounts_org_id_idx" ON "ad_accounts"("org_id");
CREATE INDEX "campaigns_org_id_ad_account_id_idx" ON "campaigns"("org_id", "ad_account_id");
CREATE INDEX "ad_sets_org_id_campaign_id_idx" ON "ad_sets"("org_id", "campaign_id");
CREATE INDEX "ads_org_id_ad_set_id_idx" ON "ads"("org_id", "ad_set_id");

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_ad_set_id_fkey" FOREIGN KEY ("ad_set_id") REFERENCES "ad_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Row Level Security.
--
-- Any org member can view the hierarchy (matches every other read-mostly
-- tenant table in this app). Writes — INSERT/UPDATE/DELETE — are admin-only
-- on all four tables, mirroring "org admins can upload/delete project
-- media" in 20260819010000_project_media (app.is_org_admin(org_id), which
-- treats 'owner' and 'admin' as admin-level). src/lib/ad-hierarchy.server.ts
-- only exposes create+list at every level plus delete on the leaf (Ad)
-- level, but the RLS itself covers UPDATE/DELETE on all four so a future
-- admin-facing edit/cleanup UI doesn't need a follow-up migration.
-- ============================================================================

ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view ad accounts"
  ON public.ad_accounts FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org admins can create ad accounts"
  ON public.ad_accounts FOR INSERT
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can update ad accounts"
  ON public.ad_accounts FOR UPDATE
  USING (app.is_org_admin(org_id))
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can delete ad accounts"
  ON public.ad_accounts FOR DELETE
  USING (app.is_org_admin(org_id));

CREATE POLICY "org members can view campaigns"
  ON public.campaigns FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org admins can create campaigns"
  ON public.campaigns FOR INSERT
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can update campaigns"
  ON public.campaigns FOR UPDATE
  USING (app.is_org_admin(org_id))
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can delete campaigns"
  ON public.campaigns FOR DELETE
  USING (app.is_org_admin(org_id));

CREATE POLICY "org members can view ad sets"
  ON public.ad_sets FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org admins can create ad sets"
  ON public.ad_sets FOR INSERT
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can update ad sets"
  ON public.ad_sets FOR UPDATE
  USING (app.is_org_admin(org_id))
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can delete ad sets"
  ON public.ad_sets FOR DELETE
  USING (app.is_org_admin(org_id));

CREATE POLICY "org members can view ads"
  ON public.ads FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org admins can create ads"
  ON public.ads FOR INSERT
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can update ads"
  ON public.ads FOR UPDATE
  USING (app.is_org_admin(org_id))
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can delete ads"
  ON public.ads FOR DELETE
  USING (app.is_org_admin(org_id));


-- ----------------------------------------------------------------------------
-- Pin org_id on UPDATE, same as leads/contacts/projects (see
-- *_fix_role_escalation_and_org_pinning and 20260818220000_inventory_core) —
-- reuses that migration's generic app.prevent_org_id_change() trigger
-- function rather than redefining it.
-- ----------------------------------------------------------------------------

CREATE TRIGGER ad_accounts_prevent_org_id_change
  BEFORE UPDATE ON public.ad_accounts
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();

CREATE TRIGGER campaigns_prevent_org_id_change
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();

CREATE TRIGGER ad_sets_prevent_org_id_change
  BEFORE UPDATE ON public.ad_sets
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();

CREATE TRIGGER ads_prevent_org_id_change
  BEFORE UPDATE ON public.ads
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();
