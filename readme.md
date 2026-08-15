# Real Estate CRM — Full Build Plan

### A Lead Rat–class product, built agent-first

*Version 1.1 · August 2026 — adds §3.5 ad-level attribution*

---

## 0. Assumptions I'm working from

State it up front so you can correct me:

| Assumption                                                                  | If wrong, tell me                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Solo builder or 1–2 people, not a funded team                              | Changes the phasing, not the stack                                       |
| Primary market India, secondary UAE/Dubai                                   | Affects telephony, SMS, WhatsApp, compliance                             |
| You can read and reason about code, but don't want to hand-write most of it | This is the core assumption behind every agent recommendation            |
| Target customers: brokers, channel partners, and small-to-mid developers    | Enterprise developers need post-sales + ERP hooks, which changes Phase 5 |
| Budget for tooling ~$150–300/month during build                            | Stack below is chosen to keep this true                                  |

---

## 1. What you're actually building

Lead Rat is not one product. It's six products stapled together. Understanding the seams matters, because you will build them in sequence, not at once.

### 1.1 Feature inventory (mapped from Lead Rat)

**A. Lead management (the core — 40% of perceived value)**

- Multi-source lead capture: Magicbricks, 99acres, Housing.com, Meta Lead Ads, Google Ads, website forms, WhatsApp, IVR, inbound email
- Deduplication on phone/email with merge rules
- Auto-assignment: round-robin, load-balanced, rule-based (by project, budget, location, language)
- Lead lifecycle: New → Contacted → Qualified → Site Visit Scheduled → Site Visit Done → Negotiation → Booked / Dropped
- Follow-up scheduling with escalation on breach
- Bulk Excel upload
- Lead re-cycling (dropped leads back into nurture)

**B. Contact & client 360**

- Unified timeline: every call, WhatsApp, email, site visit, note
- Segmentation and tagging
- Family/co-applicant linkage (matters more in Indian real estate than most CRMs admit)

**C. Property & inventory**

- Hierarchy: Developer → Project → Tower/Phase → Unit
- Unit attributes: type, carpet/built-up/super area, floor, facing, view, price, status
- Availability states: Available → Blocked → Booked → Registered
- Media: brochures, floor plans, price sheets, RERA docs
- Price versioning (base price changes over time; you need history)

**D. Communication layer**

- Click-to-call + call recording + auto-logging (IVR/cloud telephony)
- WhatsApp Business API: templates, session messages, shared team inbox
- SMS (DLT-registered in India)
- Transactional + campaign email

**E. Sales pipeline & post-sales**

- Booking form, cost sheet, payment schedule
- Demand letters, receipts, outstanding tracking
- Channel partner brokerage: registration, lead attribution, commission slabs, invoicing

> **This is your differentiation.** Lead Rat reviews consistently flag missing/weak post-sales. Brokers tolerate it; developers don't. If you build post-sales properly you have a reason to exist beyond "cheaper Lead Rat."

**F. Reporting & analytics**

- Source-wise cost per lead and cost per booking
- **Ad-level attribution**: performance down to the individual ad ID — reach, spend, leads, bookings, cost per booking (see §3.5)
- Funnel conversion by stage, by executive, by project
- First-response TAT and follow-up compliance
- Site visit → booking ratio
- Team leaderboards and target vs achievement

**G. Platform**

- Multi-tenant SaaS with org hierarchy (Org → Team → User)
- Granular RBAC (a CP admin must never see another CP's leads)
- Mobile app for field executives — geo-tagged site visit check-in, offline capture
- Public API + webhooks (this is how you win integration-heavy customers)
- Audit log on everything (leads get "stolen"; you need forensics)

### 1.2 What to deliberately cut from v1

Cut these. They look important and aren't:

- Email marketing campaign builder (use a webhook to Mailchimp/Brevo)
- Custom report builder (ship 12 fixed reports + CSV export)
- Custom field builder / no-code form designer (huge complexity, low early demand)
- White-labelling
- In-app calling via WebRTC (use the telephony provider's dialer)

---

## 2. The non-code blockers — start these in Week 1

This is the section most build plans skip, and it's the one that will actually delay you by two months.

| Item                                                  | Lead time             | Notes                                                                                                                   |
| ----------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Meta Lead Ads API access**                    | 2–6 weeks            | Requires Business Verification + App Review for`leads_retrieval`. Start immediately.                                  |
| **WhatsApp Business API**                       | 1–3 weeks            | Go via a BSP (AiSensy, Interakt, Gupshup, Wati) — direct Cloud API is possible but BSPs handle template approval hell. |
| **DLT registration (India SMS)**                | 2–4 weeks            | TRAI mandate. Entity ID + header + template registration. No shortcut.                                                  |
| **Cloud telephony account**                     | 1–2 weeks            | Exotel, MyOperator, Knowlarity, Servetel. KYC required.                                                                 |
| **Property portal lead feeds**                  | 4–12 weeks, or never | **Read the warning below.**                                                                                       |
| **Payment gateway (for your own SaaS billing)** | 1–2 weeks            | Razorpay for India, Stripe for UAE/global.                                                                              |

### ⚠️ The portal integration reality check

Magicbricks, 99acres, and Housing.com **do not have open public lead APIs.** Every CRM that claims "auto-sync from 50+ sources" is doing one of three things:

1. **Official partner integration** — a commercial agreement with the portal. Slow, requires you to have scale first. Chicken-and-egg.
2. **Email parsing** — leads arrive in the client's inbox as notification emails; you parse them. This is what most Indian CRMs actually do. Legal, reliable enough, and you can ship it in a week.
3. **The client forwards/exports** — CSV upload, or the portal's own webhook if their plan includes one.

**Build #2 first.** A dedicated inbox per tenant (`leads+{tenant}@yourdomain.com`), an email ingestion pipeline, and per-portal parsers. Then bulk CSV. Then chase official APIs once you have customers to point at.

Do not promise portal APIs in your sales deck before you have them.

---

## 3. Tech stack

### 3.1 The selection principle

You are vibe coding. That changes the optimisation function. **Pick the stack the agents have seen the most of.** Every exotic framework choice costs you 3× in hallucinated APIs and debugging. Boring, high-training-data, TypeScript-everywhere is the correct answer here even where it isn't the technically optimal one.

### 3.2 Recommended stack

| Layer                             | Choice                                                                           | Why                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Language**                | TypeScript, end to end                                                           | One language across web, API, mobile, workers. Agents share type context across the whole repo.                                                             |
| **Monorepo**                | Turborepo + pnpm                                                                 | Shared types between web/mobile/API. Agents can reason across packages.                                                                                     |
| **Web app**                 | Next.js 15 (App Router) + React                                                  | Highest-training-data web stack in existence.                                                                                                               |
| **UI**                      | Tailwind + shadcn/ui + TanStack Table                                            | shadcn components are*copied into your repo*, so agents can read and modify them. Huge advantage over a black-box component library.                      |
| **API layer**               | tRPC (inside Next.js)                                                            | End-to-end type safety means the agent literally cannot ship a mismatched payload — the build fails. This single choice prevents a whole class of AI bugs. |
| **Public API**              | Separate REST layer (Hono or Next route handlers) + OpenAPI spec                 | tRPC is internal-only. Customers need REST + webhooks.                                                                                                      |
| **Database**                | PostgreSQL (Neon or Supabase)                                                    | Non-negotiable. You need relational integrity, RLS, JSONB, and full-text search.                                                                            |
| **ORM**                     | Prisma                                                                           | More agent training data than Drizzle. Migrations are explicit and reviewable.                                                                              |
| **Multi-tenancy**           | Shared DB,`org_id` on every table, **Postgres RLS enforced at DB level** | See §3.3 — this is the single most important design decision.                                                                                             |
| **Auth**                    | Better Auth (self-host) or Clerk (buy)                                           | Clerk gives you orgs + RBAC + invites in a day. Better Auth is free but you build more.**Recommendation: Clerk for v1**, migrate later if cost bites. |
| **Background jobs**         | Inngest                                                                          | Serverless-native, durable, retries, no Redis to babysit. Massively easier to vibe code than raw BullMQ. Use BullMQ + Upstash Redis only if you self-host.  |
| **Realtime**                | Supabase Realtime or Pusher                                                      | For live lead notifications and shared inbox presence.                                                                                                      |
| **File storage**            | Cloudflare R2 (S3-compatible)                                                    | Cheap egress. Brochures and call recordings add up fast.                                                                                                    |
| **Search**                  | Postgres FTS +`pg_trgm` in v1                                                  | Typesense/Meilisearch only if you exceed ~1M leads.                                                                                                         |
| **Mobile**                  | React Native + Expo (EAS Build)                                                  | Shares TypeScript types with web via the monorepo. Expo removes native build pain, which you cannot vibe code well.                                         |
| **Email (transactional)**   | Resend                                                                           | Simple API, good deliverability.                                                                                                                            |
| **Email (inbound parsing)** | Cloudflare Email Workers or Postmark inbound                                     | For the portal-lead ingestion pipeline.                                                                                                                     |
| **Telephony**               | Exotel (India) / Twilio (UAE + global)                                           | Abstract behind your own interface from day 1 — you will switch providers.                                                                                 |
| **WhatsApp**                | Meta Cloud API via a BSP                                                         | Wrap in the same messaging abstraction.                                                                                                                     |
| **SMS**                     | MSG91 (India), Twilio (UAE)                                                      | DLT-aware.                                                                                                                                                  |
| **Billing**                 | Razorpay Subscriptions (India) + Stripe (global)                                 |                                                                                                                                                             |
| **Observability**           | Sentry + Axiom + PostHog                                                         | Sentry catches what your tests didn't. PostHog tells you which of the 40 features anyone uses.                                                              |
| **Hosting**                 | Vercel (web) + Inngest Cloud + Neon (DB) + Fly.io (any long-running worker)      | Or: single Hetzner VPS + Coolify if you want ₹2,000/mo total. Trade-off is ops time.                                                                       |
| **CI**                      | GitHub Actions — typecheck, lint, unit, e2e (Playwright) on every PR            | **Mandatory. See §5.**                                                                                                                               |

### 3.3 Multi-tenancy — get this right on day one

This is the thing you cannot retrofit and cannot afford to let an agent improvise.

```
Rules, enforced without exception:
1. Every tenant-scoped table has org_id UUID NOT NULL.
2. Postgres Row Level Security is ON for every such table.
3. The app connects as a non-superuser role that RLS applies to.
4. Every request sets app.current_org_id in a transaction-local setting.
5. There is NO code path that queries with RLS bypassed except a
   single, audited, admin-only service using a separate DB role.
```

Why RLS and not just "add `where org_id = ?` everywhere": because an agent *will* eventually write a query without the filter. RLS makes that query return zero rows instead of leaking another broker's entire lead database. It converts your worst-case failure from a business-ending breach into a bug report.

**You personally review every line of the tenancy layer, the auth layer, and the billing layer.** Everything else can be agent-written and spot-checked.

### 3.4 Core data model sketch

```
organizations ── users ── teams ── team_members
      │
      ├── leads ── lead_activities
      │     ├── lead_assignments (history)
      │     ├── follow_ups
      │     └── site_visits
      │
      ├── contacts ── contact_channels (phone/email/whatsapp)
      │
      ├── projects ── towers ── units
      │     ├── project_media
      │     └── unit_price_history
      │
      ├── bookings ── payment_schedules ── payments ── demand_letters
      │
      ├── channel_partners ── cp_users ── brokerage_slabs ── cp_invoices
      │
      ├── lead_sources ── ad_accounts ── ad_campaigns ── ad_sets ── ads
      │     └── ad_daily_stats (spend/reach/impressions — see §3.5)
      │
      ├── communications (calls, whatsapp, sms, email — polymorphic)
      │     └── call_recordings ── transcripts
      │
      ├── tasks, notes, attachments
      ├── automation_rules ── rule_executions
      └── audit_log (append-only, every mutation)
```

Two modelling notes that will save you a rewrite:

- **`leads` and `contacts` are separate.** One person can be three leads (three projects, three sources). Merging them is the #1 CRM schema regret.
- **`lead_assignments` is a history table, not a column.** "Who had this lead in March" is a question you will be asked in a brokerage dispute.

### 3.5 Ad-level attribution

Campaign-level attribution ("Facebook → Diwali Campaign") is not enough. It won't tell you that creative #4 with the balcony shot is producing 60% of your site visits while three other ads in the same ad set burn budget. Every ad carries a unique ID on every platform — capture it, store it, and report on it.

#### 3.5.1 The ad hierarchy

Four levels, because that's Meta's actual structure and Google Ads maps onto it cleanly (campaign → ad group → ad):

```
lead_sources                (Meta, Google, Magicbricks, Website, Walk-in, Referral)
  └── ad_accounts           (account_id, platform, per tenant)
        └── ad_campaigns    (campaign_id, name, objective, project_id)
              └── ad_sets   (adset_id, targeting summary, daily_budget)
                    └── ads (ad_id, creative_id, headline, thumbnail_url, status)
```

Modelling this any flatter means you can't separate "which targeting works" from "which creative works." Those are two different budget decisions and you need to answer them independently.

Note `ad_campaigns.project_id` — linking campaigns to the project they promote is what makes per-project ROI possible later.

#### 3.5.2 Attribution columns on `leads`

One embedded block, all nullable — walk-ins and referrals have none of it:

```
leads:
  source_id            FK → lead_sources
  ad_id                FK → ads          ← the ad that produced this lead
  ad_set_id            FK → ad_sets
  campaign_id          FK → ad_campaigns
  creative_id          text
  form_id              text              (Meta lead form ID)
  platform_lead_id     text              (leadgen_id — dedup + reconciliation)
  click_id             text              (fbclid / gclid / wbraid / ctwa_clid)
  utm_source, utm_medium, utm_campaign, utm_content, utm_term
  landing_page_url     text
  referrer_url         text
  first_touch_ad_id    FK → ads          ← see below
  raw_payload          jsonb             (the untouched webhook body)
  captured_at          timestamptz
```

**Why store both first touch and last touch.** Real estate has 30–90 day consideration cycles. A buyer clicks your Instagram reel in March, ignores you, then fills a Google search form in May. Last-touch-only gives the reel zero credit and you kill the ad that actually built the interest. Two columns now; you cannot reconstruct this later.

**Why `raw_payload`.** Platforms add fields. When you discover in month six that you needed the placement or the ad's publisher platform, the data is already sitting in JSONB and you backfill instead of losing six months.

Index `(org_id, ad_id, captured_at)` and `(org_id, campaign_id, captured_at)` — every report below filters on those.

#### 3.5.3 `ad_daily_stats` — the table people forget

Lead counts alone cannot tell you which ad performed best. You need **spend and reach on the same axis**, and that data lives in the ad platform, not in the webhook payload.

```
ad_daily_stats:
  ad_id, date, impressions, reach, clicks, spend, currency,
  platform_leads_reported, synced_at
  PRIMARY KEY (ad_id, date)
```

Pull nightly via the **Meta Marketing API (Insights)** and the **Google Ads API**. Daily grain, not lifetime totals — lifetime totals make date-range filtering impossible.

Two things that will bite you:

- **Meta restates numbers for up to 28 days** as attribution windows settle. Re-sync a rolling 28-day window every night and upsert on `(ad_id, date)`. If you sync once and treat it as final, your CPL numbers will be quietly wrong.
- **Platform-reported lead counts will never match your CRM counts.** Store both. The delta is your webhook drop rate and it's a genuinely useful health metric — a sudden gap means your ingestion broke.

#### 3.5.4 Where each ID actually comes from

| Source                                 | What you get                                                            | How                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Meta Lead Ads**                | `ad_id`, `adgroup_id`, `campaign_id`, `form_id`, `leadgen_id` | All present in the webhook payload. Free.                                            |
| **Meta → website form**         | `fbclid` + UTM params                                                 | JS captures on page load, persists to a first-party cookie, submits as hidden fields |
| **Google Ads lead form ext.**    | `gclid`, then campaign/ad group by API lookup                         | `gclid` is not itself an ad ID — resolve it against the Ads API                   |
| **Google Ads → website**        | `gclid` / `wbraid` + UTMs                                           | Same cookie capture                                                                  |
| **Click-to-WhatsApp ads**        | `ctwa_clid` on the first inbound message webhook                      | Easy to miss, and a large channel for Indian real estate. Don't skip it.             |
| **Portal leads (99acres, MB)**   | Nothing below source level                                              | Accept it.`ad_id` stays null; attribution stops at source.                         |
| **Walk-in / referral / offline** | Nothing                                                                 | Manual source tagging only                                                           |

The cookie-capture script is ~30 lines and must run on **every** landing page. Persist to a first-party cookie with a 90-day expiry, and write the *first* value seen as well as the latest — that's what populates `first_touch_ad_id`.

#### 3.5.5 Reports this unlocks

Add these to the Phase 6 fixed-report list:

- **Ad performance leaderboard** — per ad: reach, impressions, clicks, spend, leads, qualified, site visits, bookings, CPL, cost per site visit, cost per booking, attributed booking value
- **Creative comparison** — ads within the same ad set, so targeting is held constant and the creative is the only variable
- **Campaign → project ROI** — attributed booking value ÷ spend, per project
- **Reach-to-booking funnel** — impressions → clicks → leads → qualified → site visit → booked, with drop-off % at each step
- **First-touch vs last-touch split** — where the two disagree is where budget is misallocated
- **Stale ad alert** — ads still spending with zero leads in 7 days

> **Default the leaderboard sort to cost per booking, not lead count.** Ranking by lead volume actively misleads: a cheap ad that floods you with unqualified enquiries will outrank an expensive one that brought three actual buyers. Bookings are sparse in the first months, so display CPL beside it as the leading indicator — but never make lead count the headline number.

#### 3.5.6 Build sequencing

- **Phase 1** — add the attribution columns to `leads` now, nullable and unpopulated. Retrofitting columns onto a live leads table with real customer data is painful; adding them empty costs nothing.
- **Phase 3** — the ad hierarchy tables, webhook parsing, and the website UTM/click-ID capture script.
- **Phase 3.5 (~4 days)** — the nightly Meta/Google spend sync. Small job, but it's the entire difference between "which ad got the most leads" and "which ad made us money."
- **Phase 6** — the reports above.

---

## 4. Which AI agent for what

The 2026 landscape has converged on models but diverged on harnesses. The right move is not "pick one tool" — it's assigning tools by task shape.

### 4.1 Your agent roster

| Tool                                 | Buy it for                                                                                | Rough cost      |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | --------------- |
| **Claude Code** (Opus 5)       | Architecture, backend, multi-file refactors, anything requiring the whole repo in context | Claude Max plan |
| **Cursor**                     | Editor-flow work: components, forms, tweaks, fast iteration with tab-completion           | $20–60/mo      |
| **Codex / Copilot agent mode** | Async background work fired from GitHub issues while you do something else                | $20/mo          |
| **v0 or Claude Design**        | First-draft UI exploration before anything enters the repo                                | $20/mo          |

You do not need all four. **Minimum viable: Claude Code + Cursor.** Add the others once the repo is big enough that parallelism pays.

### 4.2 Component → agent mapping

| Component                                                            | Primary agent                                                     | How to drive it                                                                                                                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Product spec & module breakdown**                            | Claude Code (plan mode) or Claude chat                            | Do this*before* any code. Output goes in `/docs/specs/*.md`.                                                                                                                     |
| **DB schema, migrations, RLS policies**                        | Claude Code                                                       | Long-context reasoning across the whole model. Review every migration yourself.                                                                                                      |
| **Auth, tenancy, RBAC**                                        | Claude Code — then**you read all of it**                   | Never accept without reading. Never let a second agent refactor it blind.                                                                                                            |
| **Backend services, tRPC routers, business logic**             | Claude Code with subagents                                        | Split by domain: one subagent for leads, one for inventory, one for comms.                                                                                                           |
| **Third-party integrations (Meta, WhatsApp, Exotel, portals)** | Claude Code + the provider's docs pasted in or fetched            | Agents hallucinate integration APIs badly.**Always give it the real docs.**                                                                                                    |
| **Background jobs / Inngest functions**                        | Claude Code                                                       |                                                                                                                                                                                      |
| **Ad spend sync (Meta Marketing API, Google Ads API)**         | Claude Code — with the real docs in`/docs/integrations/` first | Both APIs are versioned, verbose and change often. This is exactly where agents hallucinate confidently from stale training data. The webhook parser is easier — Cursor handles it. |
| **UI exploration & design direction**                          | v0 / Claude Design                                                | Generate 3 variants, pick one, then port into shadcn components in-repo.                                                                                                             |
| **React components, forms, tables, filters**                   | Cursor                                                            | Fastest loop for visual iteration.                                                                                                                                                   |
| **Small edits, renames, copy changes**                         | Cursor tab + inline edit                                          | Don't burn an agent turn on a two-line change.                                                                                                                                       |
| **Mobile app (Expo)**                                          | Cursor for screens, Claude Code for native modules & offline sync | Offline sync is genuinely hard — give it to your best agent.                                                                                                                        |
| **Test writing (unit + Playwright e2e)**                       | Claude Code subagent, run after each feature                      | Non-negotiable. See §5.                                                                                                                                                             |
| **Code review of agent-written code**                          | **A different agent than the one that wrote it**            | This is the highest-leverage trick in the whole plan. Codex or Copilot reviewing Claude Code's PR catches real bugs. Self-review does not.                                           |
| **Dependency bumps, lint sweeps, small tickets**               | Codex / Copilot agent mode, from GitHub issues                    | Fire and forget while you work on something else.                                                                                                                                    |
| **DB inspection, log triage, prod debugging**                  | Claude Code + MCP servers (Postgres MCP, Sentry MCP, GitHub MCP)  | Connecting MCP servers turns your agent from a code writer into an operator.                                                                                                         |
| **AI *features* inside the product**                         | Claude API (Sonnet/Haiku) called from your backend                | See §6 — different from the agents that build the product.                                                                                                                         |

### 4.3 Repo scaffolding for agents

Create these on day one. They are what separates vibe coding that ships from vibe coding that collapses at 20k lines.

```
/CLAUDE.md              ← stack rules, conventions, forbidden patterns
/.cursor/rules/         ← same rules, Cursor format
/docs/specs/            ← one markdown spec per module
/docs/decisions/        ← ADRs: why Prisma, why RLS, why Inngest
/docs/integrations/     ← copy-pasted real API docs for every provider
/packages/              ← db, api, ui, types, mobile, web
```

`CLAUDE.md` should contain, at minimum:

- The stack list and versions
- "Every tenant table has org_id + RLS. Never write a raw query that bypasses it."
- "Never modify files in `/packages/db/migrations` that are already applied."
- "All new endpoints require a Zod input schema and a test."
- "Use existing shadcn components in `/packages/ui` before creating new ones."
- "Do not add dependencies without asking."

---

## 5. Vibe-coding discipline (the part that decides whether this ships)

Independent testing in 2026 found roughly **three-quarters of AI coding agents broke working code during CI workflows.** The agents are extraordinary at writing code and mediocre at not breaking adjacent code. Your entire process should be built around that asymmetry.

**The eight rules:**

1. **Spec before code, always.** One markdown spec per module, written with the agent, agreed by you, committed to the repo. The agent then implements *against the spec*, and you review against the spec rather than against vibes.
2. **One module per branch, small PRs.** A 40-file PR is unreviewable, and unreviewed agent code is where breaches live.
3. **Tests are the contract.** Every feature ships with tests written in the same session. CI blocks merge. This is what makes agent velocity safe rather than terrifying.
4. **Never let an agent write auth, tenancy, billing, or brokerage calculation unsupervised.** Read every line. These four are where bugs cost money or customers.
5. **Cross-agent review.** The author agent never reviews its own PR.
6. **Give the agent real docs, not memory.** For every integration, fetch the current API docs into `/docs/integrations/` and point the agent at the file. Integration hallucination is the #1 time sink.
7. **Migrations are sacred.** Agent proposes, you apply. Never let an agent run a destructive migration against anything but a local DB.
8. **Seed data + a demo tenant, from week 1.** You cannot evaluate a CRM with three fake leads. Generate 5,000 realistic leads, 40 users, 3 projects, 600 units. Every agent-built feature gets tested against that immediately.

**Rule zero:** when you don't understand what the agent wrote, don't merge it. Ask it to explain, then simplify. Complexity you can't explain is complexity you can't debug at 2am when a broker's leads have stopped syncing.

---

## 6. The AI layer *inside* the product

Separate from your build agents. This is what makes it 2026 software instead of 2019 software.

| Feature                                | How                                                                                                                                                                                               | Model                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lead scoring**                 | Score on source, budget fit, response speed, engagement signals. Start with a rules engine, add an LLM layer only once you have outcome data.                                                     | Rules first, Haiku later                                                                                                                                    |
| **Call transcription + summary** | Post-call: transcribe, summarise, extract intent/budget/objections, auto-update lead fields.**This is the killer feature for Indian real estate** — no manager listens to 200 calls a day. | **Sarvam AI or AI4Bharat for Hinglish/Indic** — Whisper and Deepgram degrade badly on code-mixed Hindi-English. Then Claude Haiku for summarisation. |
| **WhatsApp auto-responder**      | Instant first response to new leads (first-response TAT is the#1 conversion lever), qualification questions, handoff to human                                                                     | Claude Haiku, tightly prompted, with a hard human-handoff rule                                                                                              |
| **Next-best-action**             | "3 leads went cold, 2 need follow-up today, this one asked about payment plan twice"                                                                                                              | Claude Sonnet, daily batch                                                                                                                                  |
| **Natural-language search**      | "show me 2BHK enquiries from Magicbricks in Hinjewadi under 1.2 Cr" → structured query                                                                                                           | Sonnet → SQL/tRPC params, with a validation layer                                                                                                          |
| **Auto-drafted follow-ups**      | Context-aware WhatsApp/email drafts the executive edits and sends                                                                                                                                 | Haiku                                                                                                                                                       |

Cost control: use Haiku for anything high-volume and per-lead. Sonnet for anything the customer reads as "insight." Cache aggressively. Meter AI usage per tenant from day one — it's a real COGS line and you'll want to price for it.

---

## 7. Phased roadmap

Solo, agent-assisted, ~5 focused days/week. Adjust for reality.

| Phase                                | Weeks | Deliverable                                                                                                                                                                  | Done when                                                                                              |
| ------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **0 — Foundations**           | 2     | Monorepo, Next.js + Prisma + Postgres, Clerk auth, orgs + RBAC,**RLS multi-tenancy**, CI pipeline, seed data, `CLAUDE.md`                                            | Two tenants exist and provably cannot see each other's data                                            |
| **1 — Lead core**             | 3     | Leads CRUD, contacts, timeline, statuses, assignment rules, follow-ups, tasks, bulk Excel upload,**attribution columns on `leads` (nullable, §3.5.2)**              | You can run a full lead lifecycle by hand in the UI                                                    |
| **2 — Inventory**             | 2     | Projects → towers → units, availability, media, price history                                                                                                              | A sales exec can pick a unit and see live availability                                                 |
| **3 — Lead capture**          | 3     | Website form endpoint,**email-parsing ingestion**, Meta Lead Ads webhook, ad hierarchy tables + UTM/click-ID capture (§3.5), public REST API + webhooks, dedup engine | A Meta ad lead lands in the CRM in under 10 seconds, carrying its ad ID                                |
| **3.5 — Ad spend sync**       | 0.5   | Nightly Meta Marketing API + Google Ads API pull into`ad_daily_stats`, rolling 28-day re-sync                                                                              | You can compute cost per lead and cost per booking per ad                                              |
| **4 — Communications**        | 3     | Click-to-call + recording + auto-log, WhatsApp shared inbox + templates, SMS, email                                                                                          | Every touchpoint appears on the lead timeline without manual entry                                     |
| **5 — Pipeline & post-sales** | 3     | Booking, cost sheet, payment schedule, demand letters, CP module + brokerage                                                                                                 | **Your differentiator. Don't skip it.**                                                          |
| **6 — Reports**               | 2     | 12 fixed reports incl. the ad performance leaderboard (§3.5.5), dashboards, CSV export, target vs achievement                                                               | A sales head can run Monday review from the dashboard alone, and kill a losing ad from the leaderboard |
| **7 — Mobile app**            | 3     | Expo app: leads, follow-ups, click-to-call, geo-tagged site-visit check-in, offline capture                                                                                  | A field exec can work a full day without the web app                                                   |
| **8 — AI layer**              | 2     | Call transcription + summary, lead scoring, WhatsApp auto-first-response                                                                                                     | Demoable in 90 seconds                                                                                 |
| **9 — Commercialise**         | 2     | Razorpay subscriptions, plans/limits, onboarding wizard, docs, security pass, DPDP compliance                                                                                | You can charge someone                                                                                 |

**~25 weeks to a sellable product.** Halve nothing except by cutting scope, not by cutting Phase 0 or testing.

**Get a design partner by end of Phase 1.** One real brokerage, using it free, complaining loudly. Building phases 2–9 without one is how you end up with 40 features nobody wanted.

---

## 8. Compliance — India + UAE

Not optional, and cheap to build in early vs. retrofit.

**India**

- **DPDP Act 2023** — consent for processing, purpose limitation, breach notification, data principal rights (access/correction/erasure). Build a consent field on every lead and an erasure endpoint now, not later.
- **TRAI DLT** — SMS headers and templates must be pre-registered. Unregistered SMS simply won't deliver.
- **Call recording consent** — announce recording on the IVR leg. Make it a tenant setting and default it on.
- **RERA** — if you display project details, agent/project registration numbers must be shown. Model a `rera_number` field on projects.

**UAE**

- **PDPL (Federal Decree-Law 45/2021)** — broadly similar consent/rights regime.
- Consider a separate deployment region if you sell to Dubai developers who ask about data residency. Design for it (region column, no hardcoded region) even if you only run one region.

**Both**

- Audit log everything. In a brokerage dispute, "who saw this lead when" is the evidence.
- Encrypt call recordings at rest. Signed, expiring URLs only.

---

## 9. Running costs, roughly

|                                         | Build phase | ~50 tenants                                  |
| --------------------------------------- | ----------- | -------------------------------------------- |
| AI coding tools                         | $60–200/mo | $60–200/mo                                  |
| Hosting (Vercel + Neon + Inngest + R2)  | $50–100/mo | $200–400/mo                                 |
| Clerk                                   | Free tier   | $100–250/mo                                 |
| Sentry + PostHog + Axiom                | Free tiers  | $80–150/mo                                  |
| Product AI (Claude API + transcription) | $20–50/mo  | Usage-based —**meter and price this** |
| Telephony / WhatsApp / SMS              | —          | Pass-through to customer, mark up 10–20%    |

Vercel + Clerk + Neon at scale is where costs bite. The escape hatch is a Hetzner VPS with Coolify and self-hosted Better Auth — roughly a tenth the cost, several hours a month of your time. Take it when the bill exceeds the value of those hours, not before.

---

## 10. What kills this project (ranked)

1. **Skipping Phase 0.** Retrofitting multi-tenancy into 20k lines of agent-written code is a rewrite, not a refactor.
2. **No tests, so no CI, so every agent session breaks something invisible.** By month three you're afraid of your own codebase.
3. **Believing the portal-API story.** Selling on integrations you don't have.
4. **Building all six modules to 60%** instead of two modules to 100%. Brokers buy working lead management, not a broad half-product.
5. **No design partner.** You build what you imagine instead of what they scream about.
6. **Competing on price alone.** Lead Rat is entrenched and cheap. Win on post-sales depth, Indic-language call intelligence, and support responsiveness — not on ₹200 less per user.

---

## 11. Your first week

1. Buy Claude Code + Cursor. Set up the monorepo skeleton.
2. Write `CLAUDE.md` and `/docs/specs/00-overview.md` — with an agent, then edit it yourself.
3. Start the slow queues in parallel: Meta Business Verification, WhatsApp BSP signup, DLT registration, Exotel KYC. Meta Business Verification also gates the Marketing API you need for ad spend sync (§3.5.3) — one approval, two unlocks.
4. Build Phase 0 end-to-end: auth, orgs, RLS, CI, seed data. Nothing else.
5. Prove tenant isolation with an automated test that *tries* to leak and fails.
6. Line up one brokerage willing to be your design partner.

Nothing in weeks 1–2 should be a feature. That's the discipline that makes weeks 3–25 possibl

# LeadCat CRM (High-Velocity Real Estate Sales Engine)

A lightweight, blazingly fast, real-time CRM built specifically for real estate developers, builders, and agency sales teams. Engineered for zero-latency UI interactions, auto-lead routing, and $0/month infrastructure overhead.

---

## Architecture & Tech Stack

This project uses a high-performance stack designed to eliminate re-render lag and database locks:

* **Frontend:** [React](https://react.dev/) + [Vite](https://vitejs.dev/) + [Tailwind CSS](https://tailwindcss.com/)
* **UI Components:** [Shadcn UI](https://ui.shadcn.com/) (Generated via Lovable)
* **State & Caching:** [TanStack Query v5](https://tanstack.com/query) (Prevents raw `useEffect` re-fetch loops)
* **Backend & Database:** [Supabase](https://supabase.com/) (Serverless Postgres + Row-Level Security)
* **Automated Ingestion:** Supabase Edge Functions (Deno / TypeScript)
* **Developer Agent:** Claude Code CLI (Guided via strict `CLAUDE.md` performance rules)
* **Hosting:** Vercel / Cloudflare Pages ($0 Free Tier)

---

## Core Features

* **Instant Lead Ingestion:** Webhook endpoint (`/ingest-lead`) ready for Meta/Facebook Ads and real estate portals.
* **Round-Robin Assignment:** Automatically cycles incoming leads across active sales agents in real-time.
* **Kanban Pipeline:** High-velocity drag-and-drop lead stages with optimistic UI updates.
* **Property Catalog:** Track projects, tower blocks, and unit statuses (`Available`, `Blocked`, `Sold`).
* **Zero-Lag Architecture:** Server-side pagination, explicit B-tree indexing, and clean WebSocket unmounting.

---

## Quick Start Guide

### 1. Prerequisites

* **Node.js** (v18 or higher)
* **npm** or **pnpm**
* A free **Supabase** account

### 2. Repository Setup

Clone the repository and install dependencies:

```bash
git clone [https://github.com/your-username/LeadCat-crm.git](https://github.com/your-username/LeadCat-crm.git)
cd LeadCat-crm
npm install
```
