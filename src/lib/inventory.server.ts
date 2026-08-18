import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withUserContext } from "./db.server";
import { requireUserId, requirePrimaryOrgId } from "./current-user.server";
import { PROJECT_TYPE_VALUES, UNIT_STATUS_VALUES } from "./inventory-enums";

const unitInclude = {
  project: { select: { id: true, name: true } },
  tower: { select: { id: true, name: true } },
} as const;

/**
 * Projects with real unit counts and a real "matching leads" count,
 * replacing the mock's arbitrary numbers. "Matching" is a case-insensitive
 * text match against leads.project — that column is still free text from
 * Phase 1, not a foreign key to projects.id (see docs/specs/02-inventory.md
 * for why this slice doesn't migrate it). One groupBy on leads covers every
 * project at once rather than one count query per project.
 */
export const listProjects = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();

  return withUserContext(userId, async (tx) => {
    const [projects, unitCounts, availableCounts, leadCounts] = await Promise.all([
      tx.project.findMany({ orderBy: { createdAt: "desc" } }),
      tx.unit.groupBy({ by: ["projectId"], _count: { _all: true } }),
      tx.unit.groupBy({
        by: ["projectId"],
        where: { status: "Available" },
        _count: { _all: true },
      }),
      tx.lead.groupBy({ by: ["project"], _count: { _all: true } }),
    ]);

    const totalByProject = new Map(unitCounts.map((u) => [u.projectId, u._count._all]));
    const availableByProject = new Map(availableCounts.map((u) => [u.projectId, u._count._all]));

    const leadCountByName = new Map<string, number>();
    for (const row of leadCounts) {
      if (!row.project) continue;
      const key = row.project.trim().toLowerCase();
      leadCountByName.set(key, (leadCountByName.get(key) ?? 0) + row._count._all);
    }

    return projects.map((p) => ({
      ...p,
      totalUnits: totalByProject.get(p.id) ?? 0,
      availableUnits: availableByProject.get(p.id) ?? 0,
      matchingLeads: leadCountByName.get(p.name.trim().toLowerCase()) ?? 0,
    }));
  });
});

const createProjectSchema = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  type: z.enum(PROJECT_TYPE_VALUES),
  startingPrice: z.string().optional(),
  unitConfigSummary: z.string().optional(),
});

export const createProject = createServerFn({ method: "POST" })
  .validator(createProjectSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.project.create({
        data: {
          orgId,
          name: data.name,
          city: data.city,
          type: data.type,
          startingPrice: data.startingPrice || null,
          unitConfigSummary: data.unitConfigSummary || null,
        },
      }),
    );
  });

export const listTowers = createServerFn({ method: "GET" })
  .validator(z.object({ projectId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.tower.findMany({ where: { projectId: data.projectId }, orderBy: { name: "asc" } }),
    );
  });

const createTowerSchema = z.object({ projectId: z.string().uuid(), name: z.string().min(1) });

export const createTower = createServerFn({ method: "POST" })
  .validator(createTowerSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.tower.create({ data: { orgId, projectId: data.projectId, name: data.name } }),
    );
  });

const listUnitsSchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(UNIT_STATUS_VALUES).optional(),
  search: z.string().optional(),
});

export const listUnits = createServerFn({ method: "GET" })
  .validator(listUnitsSchema.optional())
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    const where: Prisma.UnitWhereInput = {
      ...(data?.projectId ? { projectId: data.projectId } : {}),
      ...(data?.status ? { status: data.status } : {}),
      ...(data?.search
        ? {
            OR: [
              { unitNumber: { contains: data.search, mode: "insensitive" } },
              { configuration: { contains: data.search, mode: "insensitive" } },
              { project: { name: { contains: data.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    return withUserContext(userId, (tx) =>
      tx.unit.findMany({ where, include: unitInclude, orderBy: { createdAt: "desc" } }),
    );
  });

const createUnitSchema = z.object({
  projectId: z.string().uuid(),
  towerId: z.string().uuid().optional(),
  unitNumber: z.string().min(1),
  configuration: z.string().optional(),
  floor: z.string().optional(),
  area: z.string().optional(),
  price: z.string().optional(),
});

export const createUnit = createServerFn({ method: "POST" })
  .validator(createUnitSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const orgId = await requirePrimaryOrgId(userId);

    return withUserContext(userId, (tx) =>
      tx.unit.create({
        data: {
          orgId,
          projectId: data.projectId,
          towerId: data.towerId || null,
          unitNumber: data.unitNumber,
          configuration: data.configuration || null,
          floor: data.floor || null,
          area: data.area || null,
          price: data.price || null,
        },
        include: unitInclude,
      }),
    );
  });

const updateUnitStatusSchema = z.object({
  unitId: z.string().uuid(),
  status: z.enum(UNIT_STATUS_VALUES),
});

export const updateUnitStatus = createServerFn({ method: "POST" })
  .validator(updateUnitStatusSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, (tx) =>
      tx.unit.update({
        where: { id: data.unitId },
        data: { status: data.status },
        include: unitInclude,
      }),
    );
  });
