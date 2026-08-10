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
* **Hosting:** Vercel / Cloudflare Pages ($0 Free Tier) lets see

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
