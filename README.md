# Interview questions by role (application screen)

Short take-home: enter a **generic job title** → get **three** interview questions from an AI API. This repo is structured so you can push to GitHub, deploy to **Vercel** (free tier), and share a **live URL** plus a **Loom** walkthrough.

## What was built (high level)

| Piece | Purpose |
|--------|--------|
| `index.html` | Accessible form; **Customer Success Manager** prefilled as the primary example. |
| `css/styles.css` | Clean, readable UI; loading and error states. |
| `js/app.js` | `fetch` to `/api/generate`; disables inputs while loading; simple error messages. |
| `api/generate.js` | Serverless proxy to **Google Gemini** so your **API key never ships to the browser**. |
| `vercel.json` | Small security headers; optional hardening. |

**Provider / model:** Google **Gemini** (`gemini-2.0-flash` via REST). **Why:** generous free tier, fast enough for short JSON, and `responseMimeType: application/json` makes parsing reliable — good fit for a 30‑minute screen without extra dependencies.

**Prompt strategy:** A fixed **system instruction** encodes rules (no PII, exactly three questions, JSON shape). The **user message** is only `Job title: …` so you stay aligned with the assignment’s privacy note.

## Run locally

1. Install deps: `npm install`
2. Copy `.env.example` → `.env.local` and set `GEMINI_API_KEY` (create a key at [Google AI Studio](https://aistudio.google.com/apikey)).
3. Run: `npx vercel dev`  
   Open the URL it prints (often `http://localhost:3000`).

## Deploy (free hosting)

1. Push this folder to a **new GitHub repository** (private is fine if the recruiter accepts it; many prefer public for easy review).
2. Import the repo in [Vercel](https://vercel.com) → New Project → select the repo.
3. Under **Environment Variables**, add `GEMINI_API_KEY` with your key (Production + Preview).
4. Deploy. Copy the **production URL** for your application email.

**Checklist before you submit:** Open the live site, submit the default title, confirm three questions appear, try a bad network tab once to see error handling.

---

## Loom video (4–7 minutes): suggested flow

The brief weights the video heavily — especially explaining choices to a **non‑technical** founder. Use plain language; show, don’t lecture.

### Minute 0–1 — Intro

- Your name, what you’re excited about in **early‑stage** / **HRTech** / **founding engineer** work (one sentence each is enough).
- One line: “I built a small page that turns a job title into three interview questions using Google’s Gemini API.”

### Minute 1–3 — Demo the app (live)

- Show the page; point out **prefilled Customer Success Manager**.
- Submit; call out the **loading state** (button disabled, spinner).
- Read one question briefly and say why it feels **role‑specific** (signals you care about quality, not only wiring).

### Minute 3–5 — Code walkthrough (share screen)

Open repo in the editor or GitHub; hit these in order:

1. **`index.html`** — form only sends a **title**; no PII in the UI copy or fields.
2. **`js/app.js`** — POST JSON, handles non‑OK responses, clears previous errors.
3. **`api/generate.js`** — **this is the differentiator:** explain you did **not** put the key in the frontend; Vercel holds `GEMINI_API_KEY`. Mention **JSON mode** and the **exact JSON shape** you asked the model for.
4. **Prompt** — scroll to `SYSTEM_INSTRUCTION` in `api/generate.js` and read the **rules** you gave the model (three questions, thoughtful, no personal data).

**Answer explicitly:** “I chose **Google Gemini**, model **`gemini-2.0-flash`**, because …” (speed, free tier, JSON output, low friction for reviewers running it).

### Minute 5–7 — Required reflection questions (answer out loud)

Use short stories where possible.

1. **One thing you’d improve with more time**  
   Good options: rate limiting / abuse caps, analytics on latency, automated tests for the parser, i18n, caching identical titles, A/B prompt evaluation with hiring managers, streaming partial text, or a minimal admin toggle for model version.

2. **Philosophy around building**  
   Example angle: start with the smallest end‑to‑end slice that proves value; make risks visible early (security, parsing, UX); iterate with real users.

3. **How you collaborate**  
   Example: clarify outcomes and constraints first; write short async updates; pair when stuck; document decisions (ADR‑light) for architecture.

4. **When you’re stuck**  
   Example: reproduce minimally, read primary docs, inspect network responses, timebox a spike, ask with **what you tried** and **what you observed**.

Close with: “Here’s the live link and the GitHub repo — happy to go deeper on architecture or product direction.”

---

## Notes for reviewers

- No names, phone numbers, or resumes are used in prompts or code paths — only a generic `jobTitle` string.
- Error responses are intentionally concise for end users; server logs include more detail where safe.
