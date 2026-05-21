<p align="center">
  <img src="public/logo_linki.png" alt="Linki" width="56" />
</p>

<h1 align="center">Linki</h1>
<p align="center">Open-source AI SDR for B2B outreach. LinkedIn sequences, cold email, and an AI agent that writes every message for you. Self-hosted, no per-seat pricing.</p>

<p align="center">
  <a href="https://opsily.com/hosting/linki?utm_source=github&utm_medium=readme&utm_campaign=linki">
    <img src="public/deploy-with-opsily.svg" alt="Deploy with Opsily" height="36" />
  </a>
</p>

---

<p align="center">
  <strong>▶ Full demo &nbsp;|&nbsp;</strong>
  <a href="https://youtu.be/xFvpawlVup4">https://youtu.be/xFvpawlVup4</a>
</p>
<p align="center">
  <a href="https://youtu.be/xFvpawlVup4">
    <img src="https://img.youtube.com/vi/xFvpawlVup4/maxresdefault.jpg" alt="Click to watch the full demo on YouTube" width="720" />
  </a>
</p>

---

## What is Linki

Linki is an open-source AI SDR built for B2B founders and sales teams who want full control over their outreach. You build multichannel campaigns (LinkedIn sequences, cold email, or both) and an AI agent powered by any model on OpenRouter writes every message for each lead individually. Everything runs on your own server. Your data never leaves your machine.

No SaaS middleman. No per-seat pricing. No black box.

---

## Features

### 🤖 AI Agent at the Core

- **OpenRouter integration**: connect any model (Claude, GPT-4o, Mistral, and more) with a single API key
- **3-layer prompt hierarchy**: global agent context (your business, USP, offer) → campaign-level instructions → per-step prompts. Each layer narrows focus so the AI writes with full context
- **Step-level AI writing**: delegate message writing or email drafting to the agent on any campaign step; it personalizes each message using the lead's profile, company, title, and enrichment data
- **Preview & test before launch**: test the agent output on any individual lead before starting a campaign; send a test email to yourself directly from the step builder
- **Agent cost tracking**: every AI generation is logged with model, token count, and cost so you always know what you're spending

### 📬 Multichannel Campaigns

- **LinkedIn + email in one campaign**: run LinkedIn actions (visit, connect, message) and email actions in parallel within a single campaign sequence
- **Flexible step builder**: chain visit → connect → delay → message → cold email in any order, with configurable delays between steps
- **Per-lead state tracking**: see exactly where every lead is across both channels, with a live pipeline view broken down by step and status
- **A/B template pools**: assign multiple message templates to a step and rotate them automatically

### 📥 Unified Inbox

- **Aggregated reply feed**: all email replies from active campaigns surface in one inbox regardless of which email account received them
- **Reply filtering**: only shows contacts who actually replied; noise-free by design
- **Inline reply composer**: read the full email thread and reply without leaving Linki
- **LinkedIn reply detection**: runner passively monitors LinkedIn conversations and flags contacts who replied

### 🔍 Data & Enrichment

- **Sales Navigator import**: paste a list URL and Linki pulls in all leads with name, title, company, location, seniority, and LinkedIn URL
- **Apollo.io enrichment**: connect your Apollo API key and enrich any list with verified email addresses, company data, and seniority in one click
- **Company model**: enriched company records (description, headcount, industry, location) linked from contacts; never duplicated across leads
- **Contact detail pages**: full profile view with outreach history, enrichment status, and all campaign activity per contact

### ⚡ Reliability & Safety

- **63% improvement in connection reliability**: rewritten LinkedIn automation with smarter DOM targeting, clipboard-based message delivery, and graceful handling of LinkedIn's UI variants
- **Human-like import behavior**: lead list imports use randomized delays and pacing patterns to avoid triggering LinkedIn's bot detection
- **Email account ramp-up**: gradually increase sending volume on new email accounts to build sender reputation safely
- **Multiple email accounts**: connect as many SMTP/IMAP accounts as you need; campaigns can be assigned to specific senders
- **Multiple LinkedIn accounts**: manage and switch between accounts with per-account daily limits
- **Daily limits & auto-reschedule**: set max connections and messages per day; when a limit is hit the runner reschedules work for the next day automatically instead of stopping the campaign

### 📊 Analytics

- **Campaign pipeline view**: funnel breakdown by step with prospect counts per stage; click any step to drill into the exact contacts at that point
- **Stats bar**: live counts for total prospects, in progress, completed, failed/skipped, connections sent, accepted, and messages sent
- **Acceptance rate**: tracks connection request → acceptance ratio per campaign
- **Dashboard overview**: cross-campaign summary of active runs, total contacts, recent activity
- **AI cost dashboard**: aggregate spend across all agent sessions with per-model breakdown

---

## Hosting options

### One-click on Opsily (recommended)

[Opsily](https://opsily.com) is the easiest way to run Linki. Create a server, deploy Linki from the app store, and you get a live URL in under a minute: no terminal required.

[![Deploy with Opsily](public/deploy-with-opsily.svg)](https://opsily.com/hosting/linki)

### Self-host with Docker

**1. Create your environment file**

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```env
# Public URL of the app (e.g. https://linki.yourdomain.com or http://localhost:3456)
NEXTAUTH_URL=http://localhost:3456

# Random secret: generate with: openssl rand -base64 32
NEXTAUTH_SECRET=your_random_secret_here

# Password to log in to the Linki UI
AUTH_PASSWORD=your_password_here
```

**2. Start the container**

```bash
docker compose up -d
```

Linki is now running at `http://localhost:3456`. The SQLite database is persisted in `./data/linki.db` on your host machine.

### Self-host manually (Node.js)

Requires Node.js 22+.

```bash
npm install
npm run build
npm start
```

---

## Setup

### 1. Add a LinkedIn account

Go to **Settings → LinkedIn** and add your account. Set conservative daily limits to start (recommended: 20 connections/day, 30 messages/day).

### 2. Authenticate LinkedIn

Click **Authenticate** on your account and follow the on-screen steps to connect your LinkedIn session via browser cookies.

### 3. Add email accounts (optional)

Go to **Settings → Email** and add your SMTP/IMAP accounts. You can add as many as you need. Enable ramp-up on new accounts to build sender reputation gradually.

### 4. Configure the AI agent

Go to **Agent → Config** and enter your [OpenRouter](https://openrouter.ai) API key. Write your global agent context: describe your business, your offer, and your target persona. This becomes the foundation every AI-generated message is built on.

### 5. Connect Apollo (optional)

Go to **Settings → Integrations** and add your Apollo API key. Once connected, open any lead list and click **Enrich** to pull in verified emails and company data.

### 6. Import a lead list

Go to **Lists → New list** and paste a LinkedIn Sales Navigator list URL. Linki imports all leads with human-like pacing to avoid detection.

> **Note:** A LinkedIn Sales Navigator subscription is required to import leads.

### 7. Build and launch a campaign

Go to **Workflows → New workflow**. Add your steps: LinkedIn actions, email steps, delays: and enable AI writing on any message step. Preview the agent output on a sample lead, then create a run and launch.

---

## License

Linki is source-available under the [Linki Sustainable Use License](LICENSE).

**You can:** use it personally, use it for your business, self-host it on your own VPS or laptop, modify it, contribute to it.
