# Wardrobe — Spec (v1 prototype)

Personal wardrobe manager with AI virtual try-on. Single user, runs on localhost, data stays on disk.
Image generation runs in the user's own logged-in browser (Chrome profile `research`) through OpenCLI.

## Decisions (from design interview, 2026-11-15)

| Area | Decision |
|---|---|
| Platform | Local web app: Vite + React + TS + Tailwind + Framer Motion; Express backend (web :5180, api :5181) |
| Users | One user, no login |
| Storage | `data/` folder: `db.json` + image files |
| Engine | OpenCLI, **always `--profile research`** (never the default profile). Engines swappable behind one interface |
| v1 engines | Gemini (default; user has Google AI Plus) and ChatGPT web. Qwen, Copilot, Meta AI later (need custom adapters) |
| Try-on | Outfit slots: top, bottom, dress (fills top+bottom), outerwear, shoes, accessories (many). Explicit **Try on** button |
| Render rules | Always render from the original body photo. New chat per render. Concurrency 1; running job finishes, only the newest pending job is kept |
| Cache | Key = photo id + sorted item ids + engine + prompt version. Re-trying a cached outfit is instant. Regenerate keeps every attempt |
| Cutouts | On upload, a hosted provider (Gemini by default) turns the photo into a product shot on white. No local models |
| Provenance | Every generated image stores `provider` + `model`; UI shows a small provider chip |
| Drift | Accepted; Regenerate is the fix |
| Deletes | Deleting an item or replacing the body photo deletes renders that used it |
| Design | Inspiration strictly from shipped apps: avatar-first try-on (Doji, Doppl, Alta) + closet grid with category chips (Alta, Acloset). See `docs/moodboard.jpg` |
| Motion | Shared-element card → slot, shimmer while rendering, mask-wipe reveal, staggered grids. ≤400 ms except reveal. Honors `prefers-reduced-motion` |
| Out of scope | Weather, calendar, shopping, social, multi-photo, background compositing |

## Screens

1. **Try-on (home)** — Doji layout adapted to desktop:
   left: closet panel (category chips + 3-col grid of cutouts) · centre: full-height render of you with a provider chip and render-status overlay · right: action rail (Try on, Regenerate, Save, Compare) · bottom: docked pieces of the current outfit.
2. **Looks** — Doppl "Your Looks" grid of saved/generated looks; open one to restore its outfit.
3. **Closet** — full grid, add items (drag & drop upload, pick category), delete.
4. **Settings / Me** — body photo, engine choice, engine health (OpenCLI profile connected?).

First run: empty state asks for the body photo first.

## Backend API

- `GET /api/state` – photo, items, looks, renders, settings
- `POST /api/photo` (multipart) – set body photo (deletes old renders)
- `POST /api/items` (multipart: file, category, name) → item; queues cutout job
- `DELETE /api/items/:id`, `POST /api/items/:id/cutout` (redo)
- `POST /api/renders` {itemIds, engine, force?} → cached render or queued job
- `POST /api/looks` {name, itemIds, renderId}, `DELETE /api/looks/:id`
- `GET /api/events` – SSE: job stage updates (`queued|uploading|generating|saving|done|error`)
- `GET /api/health` – OpenCLI daemon/profile status
- `PUT /api/settings` {engine}

## Engine contract

`engine.tryOn({personPath, garments:[{path, category, description}], prompt}) → {file, provider, model}`
`engine.cutout({path, category}) → {file, provider, model}`

Implemented by spawning `opencli --profile research <site> <cmd> ...` with an args array (no shell), 240 s timeout, kill on timeout, one retry for transient errors only. Typed errors: `not_logged_in`, `profile_disconnected`, `no_image` (refusal/text-only), `timeout`, `upload_failed`, `unknown`.

Gemini: custom local adapter `~/.opencli/clis/gemini/tryon.js` (copy kept in `adapters/`) that attaches images via a synthetic paste into the composer, then reuses OpenCLI's Gemini image wait/export helpers.
ChatGPT: built-in `opencli chatgpt image --image a,b,c`.

## Prompting

Images are numbered in the prompt (Image 1 = person; Image 2.. = garments with category + short description). Keep face, hair, skin tone, body shape, pose, background, lighting, framing, aspect ratio. Replace only listed garments; empty slots keep what the person already wears. Output one photorealistic image. Prompt versions are stored so cache invalidates when prompts change.
