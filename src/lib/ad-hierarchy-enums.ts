// Plain, client-safe values matching prisma/schema.prisma's AdPlatform enum
// members exactly. Same reason as src/lib/inventory-enums.ts:
// @prisma/client is Node-only and must never be imported by a file that also
// renders in the browser.
export const AD_PLATFORM_VALUES = ["meta", "google"] as const;

export type AdPlatformValue = (typeof AD_PLATFORM_VALUES)[number];

export const AD_PLATFORM_LABELS: Record<AdPlatformValue, string> = {
  meta: "Meta",
  google: "Google",
};
