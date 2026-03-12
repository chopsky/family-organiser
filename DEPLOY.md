# Deployment Guide

## Overview

| Part | Service | Notes |
|------|---------|-------|
| Backend (Node/Express) | Railway | Free tier available |
| Frontend (React/Vite) | Vercel | Free tier, global CDN |
| Database | Supabase | Already set up |
| Telegram bot | Webhook | Registered automatically on start |

---

## Step 1 — Deploy the backend to Railway

1. Push your code to GitHub.
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Select the `family-organiser` repo (the **root**, not the `web/` folder).
4. Railway auto-detects the `railway.json` and runs `node src/server.js`.
5. In **Variables**, add every key from `.env.example`:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`
   - `TELEGRAM_TOKEN`
   - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
   - `JWT_SECRET` (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
6. After the first deploy succeeds, note your Railway URL (e.g. `https://family-organiser.railway.app`).
7. Add `WEBHOOK_URL=https://family-organiser.railway.app` to Railway variables.
8. **Redeploy** — the server will call `bot.telegram.setWebhook(...)` automatically on startup.

---

## Step 2 — Deploy the frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your GitHub repo.
2. Set **Root Directory** to `web`.
3. Framework preset: **Vite** (auto-detected).
4. Add one environment variable:
   - `VITE_API_URL` = `https://family-organiser.railway.app`  *(your Railway URL, no trailing slash)*
5. Deploy.
6. Note your Vercel URL (e.g. `https://family-organiser.vercel.app`).

---

## Step 3 — Restrict CORS (optional but recommended)

Back in Railway, add:
```
WEB_URL=https://family-organiser.vercel.app
```
Then redeploy. This locks the backend to only accept requests from your Vercel app.

---

## Local development

```bash
# 1. Copy environment file
cp .env.example .env
# Fill in real values

# 2. Run the backend (port 3000)
npm run dev

# 3. Run the frontend (port 5173, proxies /api → 3000)
npm run dev:web
```

The Vite proxy in `web/vite.config.js` forwards all `/api` calls to `localhost:3000` in dev,
so no CORS issues and no need to set `VITE_API_URL` locally.

---

## Environment variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_ANON_KEY` | ✅ | Supabase publishable (anon) key |
| `SUPABASE_SERVICE_KEY` | ✅ | Supabase secret (service role) key |
| `TELEGRAM_TOKEN` | ✅ | Bot token from @BotFather |
| `ANTHROPIC_API_KEY` | ✅ | Claude API key |
| `OPENAI_API_KEY` | ✅ | OpenAI key for Whisper transcription |
| `JWT_SECRET` | ✅ | Random 32-byte hex string |
| `WEBHOOK_URL` | Production only | Railway backend URL (enables webhook mode) |
| `WEB_URL` | Production only | Vercel frontend URL (enables CORS restriction) |
| `PORT` | ❌ | Defaults to 3000 (Railway sets this automatically) |
| `DAILY_REMINDER_HOUR` | ❌ | e.g. `08:00` (default) |
| `WEEKLY_DIGEST_DAY` | ❌ | 0=Sunday (default) |

---

## Telegram bot commands (add via @BotFather)

Use BotFather's `/setcommands` to give users a command menu:

```
start - Welcome and setup
create - Create a new household
join - Join an existing household
list - Show shopping list
shopping - Show shopping list
tasks - Show today's tasks
mytasks - Show tasks assigned to me
done - Mark a task complete
settings - Household settings
help - Show help
```
