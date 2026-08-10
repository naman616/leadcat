Building a high-performance CRM prototype on a $0 budget is completely achievable today. You don't need paid software or expensive cloud hosting to test a fully functional LeadRat clone.Here is the ultimate $0/month tech stack designed for maximum speed and zero monthly overhead, along with the step-by-step execution roadmap for your Lovable + Claude Code setup.The $0 Tech Stack (2026 Prototype Edition)LayerRecommended ToolFree Tier LimitsWhy It’s Perfect for YouFrontend UILovable (Vite + React + Shadcn UI)Free exportsGives you a clean, pre-built real estate CRM UI in minutes.Data FetchingTanStack Query (React Query)Open Source ($0)Prevents screen freezing and UI lag via client-side caching.Database & AuthSupabase500 MB Postgres, 50k MAUsFull PostgreSQL DB with instant APIs and built-in Auth.Frontend HostingVercel or Cloudflare PagesUnlimited builds, fast CDNDeploy your React frontend globally for $0.Ingestion EngineSupabase Edge Functions500,000 invocations/moHandles incoming webhooks (Meta/Google Ads) with zero cold start.WhatsApp/SMSDirect Meta Cloud API1,000 free conversations/moDirect integration with Meta (no third-party vendor charges).Cost Total: $0.00 / month to build, test, and run with real beta users.Step-by-Step Execution Plan[ Step 1: Infra Setup ] ---> [ Step 2: DB Schema ] ---> [ Step 3: Fast UI Wiring ] ---> [ Step 4: Ingestion ] ---> [ Step 5: Deploy ]
   (Supabase + Vercel)          (Claude + SQL)            (Lovable + React Query)         (Edge Functions)         (Vercel Hosting)
Step 1: Provision Free InfrastructureSupabase Account: Create a project on the Supabase free tier. Note down your SUPABASE_URL and SUPABASE_ANON_KEY.Repository: Sync your Lovable project to GitHub.Local Setup: Clone the repo locally, install dependencies, and open Claude Code in your terminal:Bashnpm install @supabase/supabase-js @tanstack/react-query
claude
Step 2: DB Schema & Performance Guardrails (Claude Code)To prevent the lag you faced in your previous app, we must set strict rules in a CLAUDE.md file before generating the database migration.  Paste this in Claude Code:Prompt A: Initialize Guardrails & DB SchemaPlaintext1. Create a CLAUDE.md file in the root directory. Add rules:
   - NEVER use raw `useEffect` for data fetching; use `@tanstack/react-query`.
   - ALL database queries returning lists must use `.range()` pagination.
   - SQL migrations MUST include B-tree indexes for foreign keys and status fields.

2. Generate a Supabase migration file `supabase/migrations/001_leadrat.sql`:
   - `profiles`: id (UUID, references auth.users), full_name, role ('admin'|'agent'), is_active (boolean).
   - `projects`: id, name, location, total_units.
   - `property_units`: id, project_id, unit_number, price, status ('available'|'blocked'|'sold').
   - `leads`: id, full_name, phone, source, status ('new'|'qualified'|'site_visit'|'closed'), assigned_agent_id (FK), created_at.
   - `lead_activities`: id, lead_id (FK), agent_id (FK), note, created_at.
   - Add indexes: `CREATE INDEX idx_leads_agent ON leads(assigned_agent_id);`, `CREATE INDEX idx_leads_status ON leads(status);`.
   - Add simple RLS policies allowing authenticated users to read/write records.
Step 3: Connect Frontend Components (Optimized Data Hooks)Lovable provides static/mock components. Claude Code will hook them up to Supabase using cached queries so the screen loads in under 100ms.Paste this in Claude Code:Prompt B: Wire React Query and Supabase ClientPlaintext1. Create `@/lib/supabase.ts` to initialize `@supabase/supabase-js`.
2. Update `src/main.tsx` to wrap the app with `QueryClientProvider` from `@tanstack/react-query`.
3. Create a custom hook `src/hooks/useLeads.ts` containing:
   - `useGetLeads(page = 1, status)`: Uses Supabase `.range((page - 1) * 20, page * 20 - 1)` with `staleTime: 1000 * 60 * 3` for zero-lag caching.
   - `useUpdateLeadStatus()`: Optimistically updates local UI state, then syncs with Supabase.
4. Refactor Lovable's Kanban or Table component to use `useGetLeads` and `useUpdateLeadStatus`.
Step 4: Build the $0 Ingestion & Round-Robin Routing EngineLeadRat's superpower is instantly assigning leads as soon as they drop in from ads.Paste this in Claude Code:Prompt C: Build Ingestion Edge FunctionPlaintextCreate a Supabase Edge Function in `supabase/functions/ingest-lead/index.ts`:
1. Handle HTTP POST requests with JSON body: `{ "name": "John", "phone": "1234567890", "source": "Meta Ads" }`.
2. Query `profiles` where `role = 'agent'` and `is_active = true`.
3. Assign the lead to an agent using simple round-robin or least-recently-assigned logic.
4. Insert the new row into `leads` and log an initial activity note in `lead_activities`.
5. Return `{ "success": true, "assigned_to": agent_id }`.
Step 5: Deploy & Maintain Free TierFrontend Hosting ($0): Connect your GitHub repo to Vercel. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in environment settings.Prevent Supabase Auto-Pause: Supabase free projects pause after 7 days of total inactivity. Set up a free GitHub Action or Cron-job.org ping every 3 days to hit your API, keeping the database hot and active 24/7.  Which part of the prototype would you like to build first—setting up the fast Supabase database schema, or connecting your existing Lovable frontend components?