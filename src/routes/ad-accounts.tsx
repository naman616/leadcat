import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, RefreshCw, Trash2 } from "lucide-react";
import { AppShell, PrimaryAction } from "@/components/crm/AppShell";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  listAdAccounts,
  createAdAccount,
  listCampaigns,
  createCampaign,
  listAdSets,
  createAdSet,
  listAds,
  createAd,
  deleteAd,
} from "@/lib/ad-hierarchy.server";
import { AD_PLATFORM_VALUES, AD_PLATFORM_LABELS } from "@/lib/ad-hierarchy-enums";
import { syncAdSpend, listAdDailyStats } from "@/lib/ad-spend.server";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/ad-accounts")({
  head: () => ({
    meta: [
      { title: "Ad Accounts — Estatly Real Estate CRM" },
      {
        name: "description",
        content: "Manage ad accounts, campaigns, ad sets and ads, and sync spend data.",
      },
    ],
  }),
  component: AdAccountsPage,
});

/**
 * A single breadcrumb-style drill-down (accounts -> campaigns -> ad sets ->
 * ads) rather than a nested table, since only one level is ever "current"
 * at a time. Every level follows the same list+create dialog shape as
 * team.tsx; the ad_hierarchy server functions (issue #25) and syncAdSpend
 * (issues #27-29) already existed with zero UI before this page.
 */
function AdAccountsPage() {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [adSetId, setAdSetId] = useState<string | null>(null);

  const accountsQuery = useQuery({ queryKey: ["ad-accounts"], queryFn: () => listAdAccounts() });
  const campaignsQuery = useQuery({
    queryKey: ["ad-campaigns", accountId],
    queryFn: () => listCampaigns({ data: { adAccountId: accountId! } }),
    enabled: !!accountId,
  });
  const adSetsQuery = useQuery({
    queryKey: ["ad-sets", campaignId],
    queryFn: () => listAdSets({ data: { campaignId: campaignId! } }),
    enabled: !!campaignId,
  });
  const adsQuery = useQuery({
    queryKey: ["ads", adSetId],
    queryFn: () => listAds({ data: { adSetId: adSetId! } }),
    enabled: !!adSetId,
  });
  const statsQuery = useQuery({
    queryKey: ["ad-daily-stats", accountId],
    queryFn: () => listAdDailyStats({ data: { adAccountId: accountId! } }),
    enabled: !!accountId,
  });

  const account = accountsQuery.data?.find((a) => a.id === accountId);
  const campaign = campaignsQuery.data?.find((c) => c.id === campaignId);
  const adSet = adSetsQuery.data?.find((s) => s.id === adSetId);

  const [accountOpen, setAccountOpen] = useState(false);
  const [accountDraft, setAccountDraft] = useState({
    platform: "",
    externalAccountId: "",
    name: "",
  });
  const createAccountMutation = useMutation({
    mutationFn: createAdAccount,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ad-accounts"] });
      setAccountOpen(false);
      toast.success("Ad account added");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add ad account"),
  });

  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignDraft, setCampaignDraft] = useState({ externalCampaignId: "", name: "" });
  const createCampaignMutation = useMutation({
    mutationFn: createCampaign,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ad-campaigns", accountId] });
      setCampaignOpen(false);
      toast.success("Campaign added");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add campaign"),
  });

  const [adSetOpen, setAdSetOpen] = useState(false);
  const [adSetDraft, setAdSetDraft] = useState({ externalAdSetId: "", name: "" });
  const createAdSetMutation = useMutation({
    mutationFn: createAdSet,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ad-sets", campaignId] });
      setAdSetOpen(false);
      toast.success("Ad set added");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add ad set"),
  });

  const [adOpen, setAdOpen] = useState(false);
  const [adDraft, setAdDraft] = useState({ externalAdId: "", name: "" });
  const createAdMutation = useMutation({
    mutationFn: createAd,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ads", adSetId] });
      setAdOpen(false);
      toast.success("Ad added");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add ad"),
  });

  const deleteAdMutation = useMutation({
    mutationFn: deleteAd,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ads", adSetId] });
      toast.success("Ad deleted");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not delete ad"),
  });

  const syncMutation = useMutation({
    mutationFn: syncAdSpend,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["ad-daily-stats", accountId] });
      toast.success(`Synced ${result.syncedAds} ad(s), ${result.syncedDays} day-rows`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Sync failed"),
  });

  const totals = (statsQuery.data ?? []).reduce(
    (acc, s) => ({
      impressions: acc.impressions + s.impressions,
      clicks: acc.clicks + s.clicks,
      spend: acc.spend + Number(s.spend),
    }),
    { impressions: 0, clicks: 0, spend: 0 },
  );

  return (
    <AppShell
      title="Ad Accounts"
      actions={
        !accountId ? (
          <PrimaryAction
            label="Add Ad Account"
            onClick={() => {
              setAccountDraft({ platform: "", externalAccountId: "", name: "" });
              setAccountOpen(true);
            }}
          />
        ) : undefined
      }
    >
      <div className="space-y-4">
        <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <button
            onClick={() => {
              setAccountId(null);
              setCampaignId(null);
              setAdSetId(null);
            }}
            className={cn("hover:text-foreground", !accountId && "font-semibold text-foreground")}
          >
            Ad Accounts
          </button>
          {account && (
            <>
              <ChevronRight className="size-3.5" />
              <button
                onClick={() => {
                  setCampaignId(null);
                  setAdSetId(null);
                }}
                className={cn(
                  "hover:text-foreground",
                  !campaignId && "font-semibold text-foreground",
                )}
              >
                {account.name}
              </button>
            </>
          )}
          {campaign && (
            <>
              <ChevronRight className="size-3.5" />
              <button
                onClick={() => setAdSetId(null)}
                className={cn("hover:text-foreground", !adSetId && "font-semibold text-foreground")}
              >
                {campaign.name}
              </button>
            </>
          )}
          {adSet && (
            <>
              <ChevronRight className="size-3.5" />
              <span className="font-semibold text-foreground">{adSet.name}</span>
            </>
          )}
        </nav>

        {!accountId && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(accountsQuery.data ?? []).map((a) => (
              <button
                key={a.id}
                onClick={() => setAccountId(a.id)}
                className="rounded-xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[var(--shadow-card)]"
              >
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold">
                  {AD_PLATFORM_LABELS[a.platform]}
                </span>
                <p className="mt-2 text-sm font-semibold">{a.name}</p>
                <p className="text-xs text-muted-foreground">{a.externalAccountId}</p>
              </button>
            ))}
            {accountsQuery.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">No ad accounts yet.</p>
            )}
          </div>
        )}

        {accountId && !campaignId && (
          <>
            <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
              <div>
                <p className="text-sm font-semibold">Spend (trailing 28 days)</p>
                <p className="text-xs text-muted-foreground">
                  {totals.impressions.toLocaleString()} impressions ·{" "}
                  {totals.clicks.toLocaleString()} clicks · ₹{totals.spend.toLocaleString()} spend
                </p>
              </div>
              <Button
                onClick={() => syncMutation.mutate({ data: { adAccountId: accountId } })}
                disabled={syncMutation.isPending}
              >
                <RefreshCw
                  className={cn("mr-2 size-4", syncMutation.isPending && "animate-spin")}
                />
                {syncMutation.isPending ? "Syncing..." : "Sync Now"}
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Campaigns
              </h2>
              <button
                onClick={() => {
                  setCampaignDraft({ externalCampaignId: "", name: "" });
                  setCampaignOpen(true);
                }}
                className="text-sm font-semibold text-primary hover:underline"
              >
                + Add Campaign
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(campaignsQuery.data ?? []).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCampaignId(c.id)}
                  className="rounded-xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[var(--shadow-card)]"
                >
                  <p className="text-sm font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.externalCampaignId}</p>
                </button>
              ))}
              {campaignsQuery.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">No campaigns yet.</p>
              )}
            </div>
          </>
        )}

        {campaignId && !adSetId && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Ad Sets
              </h2>
              <button
                onClick={() => {
                  setAdSetDraft({ externalAdSetId: "", name: "" });
                  setAdSetOpen(true);
                }}
                className="text-sm font-semibold text-primary hover:underline"
              >
                + Add Ad Set
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(adSetsQuery.data ?? []).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setAdSetId(s.id)}
                  className="rounded-xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[var(--shadow-card)]"
                >
                  <p className="text-sm font-semibold">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.externalAdSetId}</p>
                </button>
              ))}
              {adSetsQuery.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">No ad sets yet.</p>
              )}
            </div>
          </>
        )}

        {adSetId && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Ads
              </h2>
              <button
                onClick={() => {
                  setAdDraft({ externalAdId: "", name: "" });
                  setAdOpen(true);
                }}
                className="text-sm font-semibold text-primary hover:underline"
              >
                + Add Ad
              </button>
            </div>
            <div className="divide-y divide-border rounded-xl border border-border bg-card">
              {(adsQuery.data ?? []).map((ad) => (
                <div key={ad.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-semibold">{ad.name}</p>
                    <p className="text-xs text-muted-foreground">{ad.externalAdId}</p>
                  </div>
                  <button
                    onClick={() => deleteAdMutation.mutate({ data: { id: ad.id } })}
                    aria-label="Delete ad"
                    className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              {adsQuery.data?.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">No ads yet.</p>
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Ad Account</DialogTitle>
            <DialogDescription>The platform account this org's ads live under.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Platform</Label>
              <Select
                value={accountDraft.platform}
                onValueChange={(v) => setAccountDraft((d) => ({ ...d, platform: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select platform" />
                </SelectTrigger>
                <SelectContent>
                  {AD_PLATFORM_VALUES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {AD_PLATFORM_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>External Account ID</Label>
              <Input
                value={accountDraft.externalAccountId}
                onChange={(e) =>
                  setAccountDraft((d) => ({ ...d, externalAccountId: e.target.value }))
                }
                placeholder="act_123456789"
              />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={accountDraft.name}
                onChange={(e) => setAccountDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Main Meta Account"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (
                  !accountDraft.platform ||
                  !accountDraft.externalAccountId.trim() ||
                  !accountDraft.name.trim()
                ) {
                  toast.error("Fill in every field");
                  return;
                }
                createAccountMutation.mutate({
                  data: {
                    platform: accountDraft.platform as "meta" | "google",
                    externalAccountId: accountDraft.externalAccountId.trim(),
                    name: accountDraft.name.trim(),
                  },
                });
              }}
              disabled={createAccountMutation.isPending}
            >
              {createAccountMutation.isPending ? "Adding..." : "Add Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={campaignOpen} onOpenChange={setCampaignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>External Campaign ID</Label>
              <Input
                value={campaignDraft.externalCampaignId}
                onChange={(e) =>
                  setCampaignDraft((d) => ({ ...d, externalCampaignId: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={campaignDraft.name}
                onChange={(e) => setCampaignDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (
                  !accountId ||
                  !campaignDraft.externalCampaignId.trim() ||
                  !campaignDraft.name.trim()
                ) {
                  toast.error("Fill in every field");
                  return;
                }
                createCampaignMutation.mutate({
                  data: {
                    adAccountId: accountId,
                    externalCampaignId: campaignDraft.externalCampaignId.trim(),
                    name: campaignDraft.name.trim(),
                  },
                });
              }}
              disabled={createCampaignMutation.isPending}
            >
              {createCampaignMutation.isPending ? "Adding..." : "Add Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adSetOpen} onOpenChange={setAdSetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Ad Set</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>External Ad Set ID</Label>
              <Input
                value={adSetDraft.externalAdSetId}
                onChange={(e) => setAdSetDraft((d) => ({ ...d, externalAdSetId: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={adSetDraft.name}
                onChange={(e) => setAdSetDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (!campaignId || !adSetDraft.externalAdSetId.trim() || !adSetDraft.name.trim()) {
                  toast.error("Fill in every field");
                  return;
                }
                createAdSetMutation.mutate({
                  data: {
                    campaignId,
                    externalAdSetId: adSetDraft.externalAdSetId.trim(),
                    name: adSetDraft.name.trim(),
                  },
                });
              }}
              disabled={createAdSetMutation.isPending}
            >
              {createAdSetMutation.isPending ? "Adding..." : "Add Ad Set"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adOpen} onOpenChange={setAdOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Ad</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>External Ad ID</Label>
              <Input
                value={adDraft.externalAdId}
                onChange={(e) => setAdDraft((d) => ({ ...d, externalAdId: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={adDraft.name}
                onChange={(e) => setAdDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (!adSetId || !adDraft.externalAdId.trim() || !adDraft.name.trim()) {
                  toast.error("Fill in every field");
                  return;
                }
                createAdMutation.mutate({
                  data: {
                    adSetId,
                    externalAdId: adDraft.externalAdId.trim(),
                    name: adDraft.name.trim(),
                  },
                });
              }}
              disabled={createAdMutation.isPending}
            >
              {createAdMutation.isPending ? "Adding..." : "Add Ad"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
