-- ============================================================================
-- Phase 3.5 (issues #27-29): ad_daily_stats — one row per (ad, day) of
-- spend/impressions/clicks. See docs/specs/10-ad-spend-sync.md.
--
-- syncAdSpend (src/lib/ad-spend.server.ts) is a normal authenticated,
-- admin-triggered server function, not an anon webhook — it upserts through
-- withUserContext like any other admin write, no SECURITY DEFINER needed
-- here. Behind an AdSpendProvider seam (mock Meta/Google implementations
-- for now, same shape as MockWhatsAppProvider/MockTelephonyProvider) since
-- no real vendor credentials exist yet.
--
-- @@unique([ad_id, date]) is the whole "rolling re-sync" mechanism: every
-- sync run re-fetches the trailing 28 days and upserts on that key, because
-- ad platforms revise a day's own attributed numbers for days after it
-- ends — re-running is expected to change already-synced rows, not just
-- append new ones.
-- ============================================================================

-- CreateTable
CREATE TABLE "ad_daily_stats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "ad_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "spend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — the upsert key (rolling re-sync) and the parent-scoped list view.
CREATE UNIQUE INDEX "ad_daily_stats_ad_id_date_key" ON "ad_daily_stats"("ad_id", "date");
CREATE INDEX "ad_daily_stats_org_id_ad_id_idx" ON "ad_daily_stats"("org_id", "ad_id");

-- AddForeignKey
ALTER TABLE "ad_daily_stats" ADD CONSTRAINT "ad_daily_stats_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ad_daily_stats" ADD CONSTRAINT "ad_daily_stats_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Row Level Security. Same shape as ad_accounts/campaigns/ad_sets/ads
-- (20260822130000_ad_hierarchy): any org member can view, only org admins
-- can write. UPDATE is required (not just INSERT) because the rolling
-- re-sync's upsert overwrites an existing day's row. No DELETE policy —
-- nothing in this slice deletes a stat row; an admin cleaning up bad data
-- can be a follow-up if it turns out to matter.
-- ============================================================================

ALTER TABLE public.ad_daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view ad daily stats"
  ON public.ad_daily_stats FOR SELECT
  USING (app.is_org_member(org_id));

CREATE POLICY "org admins can create ad daily stats"
  ON public.ad_daily_stats FOR INSERT
  WITH CHECK (app.is_org_admin(org_id));

CREATE POLICY "org admins can update ad daily stats"
  ON public.ad_daily_stats FOR UPDATE
  USING (app.is_org_admin(org_id))
  WITH CHECK (app.is_org_admin(org_id));


-- ----------------------------------------------------------------------------
-- Pin org_id on UPDATE, same as every other tenant table — reuses the
-- existing generic app.prevent_org_id_change() trigger function.
-- ----------------------------------------------------------------------------

CREATE TRIGGER ad_daily_stats_prevent_org_id_change
  BEFORE UPDATE ON public.ad_daily_stats
  FOR EACH ROW EXECUTE FUNCTION app.prevent_org_id_change();
