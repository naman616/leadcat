import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withUserContext } from "./db.server";
import { requireUserId } from "./current-user.server";

// Accepts a string or number and validates it as a non-negative money
// amount — a form field sends a string, a programmatic caller might send a
// number, and Prisma's Decimal columns accept either.
const moneySchema = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .pipe(z.number().nonnegative());

// ============================================================================
// Booking — createBooking (src/lib/booking.server.ts) creates a `confirmed`
// booking, flips the Unit to `Booked`, and logs a system LeadActivity, all
// in one transaction — same shape as updateUnitPrice
// (src/lib/unit-price.server.ts) and mergeContacts (src/lib/dedup.server.ts).
// ============================================================================

const createBookingSchema = z.object({
  leadId: z.string().uuid(),
  unitId: z.string().uuid(),
  totalPrice: moneySchema,
  channelPartnerId: z.string().uuid().optional(),
});

export const createBooking = createServerFn({ method: "POST" })
  .validator(createBookingSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: data.leadId } });
      const unit = await tx.unit.findUniqueOrThrow({ where: { id: data.unitId } });

      // The lead and unit are each individually RLS-scoped to orgs the
      // caller belongs to, but a member of more than one org could
      // otherwise pair a lead from org A with a unit from org B — same
      // cross-org-pinning defense-in-depth mergeContacts applies to
      // duplicate contacts in src/lib/dedup.server.ts.
      if (lead.orgId !== unit.orgId) {
        throw new Error("Lead and unit must belong to the same organization");
      }

      if (data.channelPartnerId) {
        const channelPartner = await tx.channelPartner.findUniqueOrThrow({
          where: { id: data.channelPartnerId },
        });
        if (channelPartner.orgId !== lead.orgId) {
          throw new Error("Channel partner must belong to the same organization");
        }
      }

      const booking = await tx.booking.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          unitId: unit.id,
          bookedBy: userId,
          channelPartnerId: data.channelPartnerId ?? null,
          totalPrice: data.totalPrice,
          status: "confirmed",
        },
      });

      await tx.unit.update({ where: { id: unit.id }, data: { status: "Booked" } });

      await tx.leadActivity.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          type: "system",
          body: `Booking confirmed for unit ${unit.unitNumber} (total price ${data.totalPrice})`,
          createdBy: userId,
        },
      });

      // totalPrice is a Prisma Decimal, which isn't JSON-serializable across
      // the createServerFn boundary — stringify it, same convention as
      // units.price (see src/lib/unit-price.server.ts) which is stored as a
      // string throughout the app already.
      return { ...booking, totalPrice: booking.totalPrice.toString() };
    });
  });

export const listBookings = createServerFn({ method: "GET" })
  .validator(z.object({ leadId: z.string().uuid().optional() }).optional())
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const bookings = await tx.booking.findMany({
        where: data?.leadId ? { leadId: data.leadId } : {},
        orderBy: { createdAt: "desc" },
      });
      return bookings.map((booking) => ({
        ...booking,
        totalPrice: booking.totalPrice.toString(),
      }));
    });
  });

// ============================================================================
// Cost sheet — one per booking. totalAmount is computed here in application
// code (basePrice + sum of otherCharges' numeric values), not a generated
// column, keeping the math simple and visible per the task brief.
// ============================================================================

const createCostSheetSchema = z.object({
  bookingId: z.string().uuid(),
  basePrice: moneySchema,
  otherCharges: z.record(z.string(), z.number()).optional(),
});

export const createCostSheet = createServerFn({ method: "POST" })
  .validator(createCostSheetSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: data.bookingId } });

      const chargesTotal = Object.values(data.otherCharges ?? {}).reduce(
        (sum, value) => sum + value,
        0,
      );
      const totalAmount = data.basePrice + chargesTotal;

      const costSheet = await tx.costSheet.create({
        data: {
          orgId: booking.orgId,
          bookingId: booking.id,
          basePrice: data.basePrice,
          // exactOptionalPropertyTypes rejects an explicit `undefined` for
          // an optional key — only include it when actually present, same
          // pattern as src/lib/lovable-error-reporting.ts's `stack` field.
          ...(data.otherCharges !== undefined && { otherCharges: data.otherCharges }),
          totalAmount,
        },
      });

      return {
        ...costSheet,
        basePrice: costSheet.basePrice.toString(),
        totalAmount: costSheet.totalAmount.toString(),
      };
    });
  });

export const listCostSheets = createServerFn({ method: "GET" })
  .validator(z.object({ bookingId: z.string().uuid().optional() }).optional())
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const costSheets = await tx.costSheet.findMany({
        where: data?.bookingId ? { bookingId: data.bookingId } : {},
        orderBy: { createdAt: "desc" },
      });
      return costSheets.map((costSheet) => ({
        ...costSheet,
        basePrice: costSheet.basePrice.toString(),
        totalAmount: costSheet.totalAmount.toString(),
      }));
    });
  });

// ============================================================================
// Payment schedule — generatePaymentSchedule bulk-creates milestones;
// recordPayment updates one. Permission is enforced entirely by RLS (any
// org member); nothing extra checked in application code, same as
// completeTask/reopenTask in src/lib/tasks.server.ts.
// ============================================================================

const generatePaymentScheduleSchema = z.object({
  bookingId: z.string().uuid(),
  milestones: z
    .array(
      z.object({
        label: z.string().min(1),
        dueAmount: moneySchema,
        dueDate: z.string().datetime().optional(),
      }),
    )
    .min(1),
});

export const generatePaymentSchedule = createServerFn({ method: "POST" })
  .validator(generatePaymentScheduleSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: data.bookingId } });

      await tx.paymentMilestone.createMany({
        data: data.milestones.map((milestone) => ({
          orgId: booking.orgId,
          bookingId: booking.id,
          label: milestone.label,
          dueAmount: milestone.dueAmount,
          dueDate: milestone.dueDate ? new Date(milestone.dueDate) : null,
        })),
      });

      const milestones = await tx.paymentMilestone.findMany({
        where: { bookingId: booking.id },
        orderBy: { createdAt: "asc" },
      });
      return milestones.map((milestone) => ({
        ...milestone,
        dueAmount: milestone.dueAmount.toString(),
        paidAmount: milestone.paidAmount.toString(),
      }));
    });
  });

export const listPaymentMilestones = createServerFn({ method: "GET" })
  .validator(z.object({ bookingId: z.string().uuid().optional() }).optional())
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const milestones = await tx.paymentMilestone.findMany({
        where: data?.bookingId ? { bookingId: data.bookingId } : {},
        orderBy: { createdAt: "asc" },
      });
      return milestones.map((milestone) => ({
        ...milestone,
        dueAmount: milestone.dueAmount.toString(),
        paidAmount: milestone.paidAmount.toString(),
      }));
    });
  });

const recordPaymentSchema = z.object({
  milestoneId: z.string().uuid(),
  amount: moneySchema,
});

export const recordPayment = createServerFn({ method: "POST" })
  .validator(recordPaymentSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const milestone = await tx.paymentMilestone.findUniqueOrThrow({
        where: { id: data.milestoneId },
      });

      const paidAmount = Number(milestone.paidAmount) + data.amount;
      const dueAmount = Number(milestone.dueAmount);

      const updated = await tx.paymentMilestone.update({
        where: { id: data.milestoneId },
        data: {
          paidAmount,
          paidAt: new Date(),
          status: paidAmount >= dueAmount ? "paid" : "pending",
        },
      });

      return {
        ...updated,
        dueAmount: updated.dueAmount.toString(),
        paidAmount: updated.paidAmount.toString(),
      };
    });
  });

// ============================================================================
// Demand letters — content is a plain interpolated text/markdown template,
// not a real PDF (CLAUDE.md: no new dependency added for this). No "mark as
// sent" server function in this slice — status stays `draft` until that's a
// real workflow need.
// ============================================================================

const generateDemandLetterSchema = z.object({
  bookingId: z.string().uuid(),
  milestoneId: z.string().uuid(),
});

export const generateDemandLetter = createServerFn({ method: "POST" })
  .validator(generateDemandLetterSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: data.bookingId },
        include: {
          lead: { include: { contact: true } },
          unit: { include: { project: true } },
          organization: true,
        },
      });

      const milestone = await tx.paymentMilestone.findUniqueOrThrow({
        where: { id: data.milestoneId },
      });
      if (milestone.bookingId !== booking.id) {
        throw new Error("That milestone doesn't belong to this booking");
      }

      const amountDue = Number(milestone.dueAmount) - Number(milestone.paidAmount);

      const content = [
        `DEMAND LETTER`,
        ``,
        `To: ${booking.lead.contact.fullName}`,
        `From: ${booking.organization.name}`,
        ``,
        `Re: Unit ${booking.unit.unitNumber}, ${booking.unit.project.name}`,
        `Booking date: ${booking.bookingDate.toDateString()}`,
        `Total booking price: ${booking.totalPrice}`,
        ``,
        `This is a demand for payment of the "${milestone.label}" milestone.`,
        `Amount due: ${amountDue}`,
        milestone.dueDate ? `Due date: ${milestone.dueDate.toDateString()}` : null,
        ``,
        `Please remit payment at your earliest convenience.`,
      ]
        .filter((line) => line !== null)
        .join("\n");

      const demandLetter = await tx.demandLetter.create({
        data: {
          orgId: booking.orgId,
          bookingId: booking.id,
          milestoneId: milestone.id,
          content,
          amount: amountDue,
          status: "draft",
        },
      });

      return { ...demandLetter, amount: demandLetter.amount.toString() };
    });
  });

export const listDemandLetters = createServerFn({ method: "GET" })
  .validator(z.object({ bookingId: z.string().uuid().optional() }).optional())
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    return withUserContext(userId, async (tx) => {
      const demandLetters = await tx.demandLetter.findMany({
        where: data?.bookingId ? { bookingId: data.bookingId } : {},
        orderBy: { generatedAt: "desc" },
      });
      return demandLetters.map((letter) => ({ ...letter, amount: letter.amount.toString() }));
    });
  });
