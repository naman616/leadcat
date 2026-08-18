import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { findDuplicateContacts, mergeContacts } from "@/lib/dedup.server";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * See docs/specs/03-dedup.md. Detection is read-only and on-demand — the
 * query only runs while this dialog is open. Each group lets the caller
 * pick which contact is canonical (default: the oldest); merge is
 * irreversible (deletes the other contact rows), so it's a distinct
 * confirm step per group rather than a bulk "merge everything" action.
 */
export function DuplicatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [canonicalByGroup, setCanonicalByGroup] = useState<Record<number, string>>({});

  const duplicatesQuery = useQuery({
    queryKey: ["duplicate-contacts"],
    queryFn: () => findDuplicateContacts(),
    enabled: open,
  });
  const groups = useMemo(() => duplicatesQuery.data ?? [], [duplicatesQuery.data]);

  // Default each group's canonical pick to its oldest contact once the
  // groups load, without clobbering a selection the user already made.
  useEffect(() => {
    setCanonicalByGroup((prev) => {
      const next = { ...prev };
      groups.forEach((g, i) => {
        if (!next[i] && g.contacts[0]) next[i] = g.contacts[0].id;
      });
      return next;
    });
  }, [groups]);

  const mergeMutation = useMutation({
    mutationFn: mergeContacts,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["duplicate-contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success(
        `Merged ${result.mergedContacts} contact${result.mergedContacts === 1 ? "" : "s"}` +
          (result.mergedLeads > 0 ? ` · ${result.mergedLeads} lead(s) reassigned` : ""),
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Merge failed"),
  });

  function submitMerge(groupIndex: number) {
    const group = groups[groupIndex];
    if (!group) return;
    const canonicalId = canonicalByGroup[groupIndex];
    if (!canonicalId) return;
    const duplicateIds = group.contacts.map((c) => c.id).filter((id) => id !== canonicalId);
    if (duplicateIds.length === 0) return;
    mergeMutation.mutate({
      data: { canonicalContactId: canonicalId, duplicateContactIds: duplicateIds },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" /> Duplicate Contacts
          </DialogTitle>
          <DialogDescription>
            Contacts sharing a phone number or email. Pick which one to keep — their leads move to
            it and the others are deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {duplicatesQuery.isLoading && (
            <div className="grid place-items-center py-12 text-sm text-muted-foreground">
              Scanning for duplicates...
            </div>
          )}
          {duplicatesQuery.isError && (
            <div className="grid place-items-center py-12 text-sm text-destructive">
              Couldn't load duplicates.
            </div>
          )}
          {!duplicatesQuery.isLoading && !duplicatesQuery.isError && groups.length === 0 && (
            <div className="grid place-items-center py-12 text-center text-sm text-muted-foreground">
              No duplicate contacts found.
            </div>
          )}

          {groups.map((group, groupIndex) => (
            <div
              key={group.contacts.map((c) => c.id).join(",")}
              className="rounded-xl border border-border"
            >
              <div className="flex items-center justify-between border-b border-border bg-secondary/50 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  Matched on
                  {group.matchedOn.map((m) => (
                    <span
                      key={m}
                      className="rounded-full bg-accent px-2 py-0.5 text-accent-foreground"
                    >
                      {m === "phone" ? "Phone" : "Email"}
                    </span>
                  ))}
                </div>
                <Button
                  size="sm"
                  disabled={mergeMutation.isPending}
                  onClick={() => submitMerge(groupIndex)}
                >
                  {mergeMutation.isPending ? "Merging..." : "Merge"}
                </Button>
              </div>
              <ul className="divide-y divide-border">
                {group.contacts.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <input
                      type="radio"
                      name={`canonical-${groupIndex}`}
                      checked={canonicalByGroup[groupIndex] === c.id}
                      onChange={() =>
                        setCanonicalByGroup((prev) => ({ ...prev, [groupIndex]: c.id }))
                      }
                      className="size-4 accent-[oklch(0.68_0.11_178)]"
                      aria-label={`Keep ${c.fullName} as the canonical contact`}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "font-semibold",
                          canonicalByGroup[groupIndex] === c.id && "text-primary",
                        )}
                      >
                        {c.fullName}
                        {canonicalByGroup[groupIndex] === c.id && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            (keep)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.phone ?? "—"} · {c.email ?? "—"} · {c.leadCount} lead
                        {c.leadCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
