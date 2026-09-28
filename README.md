# DB Signature Graphics Drafter

Turns a photo of a landmark into an editable vector draft in the DB Signature Graphics style. The rules come from `Signature Graphics.pdf` and `Konstruktion.pdf`.

## How it works

The DB style isn't free illustration. Every graphic is made of **vertical 2 dp bars on a 4 dp pitch**, split into horizontal **rows** that can shift sideways by 2 dp. So the tool splits the job in two:

1. **Plan**: decide what the building looks like as areas (silhouette, towers, domes, openings) and where the rows break.
2. **Draw**: a deterministic renderer fills those areas with bars and enforces every rule: 2 dp stroke, 2 dp horizontal gap, bars at least 4 dp long, vertical gaps of 1 dp or 4 dp or more, a 1 dp gap between rows, 2 dp row offset, 3 dp safe area, widths of 4n+2.

Claude (vision) makes the plan: a JSON list of shapes in dp plus the row breaks. The renderer draws it and the validator checks every bar. The export is SVG, where 1 unit = 1 dp = 1 px in Figma.

### Adjustments (no new Claude call)

These reshape the plan before the renderer runs, and they never loosen the construction rules:

- **Openings & detail:** opening size (50–160 %), window density (50–200 %), and a simplify slider that removes the smallest openings first.
- **Rows:** fewer or more rows (merge the thinnest / split the tallest), row offset on/off, a 1 dp or 4 dp gap between rows, and an optional plinth row.
- **Parts & symmetry:** switch off any part Claude drew (hover to highlight it in the web tool), and mirror the left or right half.

**Revise with Claude** sends the plan *as adjusted* (`bakeScene()`), so Claude builds on what the designer tuned. **Write adjustments into plan** does the same locally, without asking Claude.

The no-AI trace engine is still in the core as `trace()` but is no longer shown in the UI.

## Files

```
core/dbsig-core.js     shared engine: rules, renderer, validator, adjustments (fromScene mods, bakeScene), AI prompt, SVG export, trace()
web/page.src.html      page source → build.py → web/signature-graphics-drafter.html (claude.ai artifact)
                                            and server/public/index.html (team server)
server/server.js       team server: password login + Anthropic API proxy (company key)
render.yaml            one-click Render deployment
figma/                 Figma plugin: manifest.json, code.js, ui.src.html → build.py → ui.html
data/examples_dp.json  the 21 DB reference landmarks, pulled from the backlight PDFs as exact dp bars
test/                  node test harness (validator + trace previews), Playwright UI checks
build.py               inlines the core (and sample data) into the web page and the plugin UI
```

Change a rule once in `RULES` in `core/dbsig-core.js`, run `python3 build.py`, and both front ends update.

## Team server (for colleagues without Claude)

`server/server.js` is a small, dependency-free Node server. It shows the drafter behind a **team password** and sends draft requests to the Anthropic API with the **company API key**. Colleagues need only the link and the password. Every draft is billed to the company's Claude Console (API) account; nobody's Claude seat is used.

How it works:

- The page is identical to the claude.ai version (same core, sliders, parts, export). `build.py` writes it to `server/public/index.html` in "server" mode.
- The browser sends the cropped photo, the measured silhouette and the notes to `/api/draft`. The server builds the prompt itself, so the endpoint can't be used as a general Claude proxy.
- The API key stays on the server and never reaches the browser.
- Limits: 30 drafts per hour per person and 300 per day for the whole team (change with env vars). Each draft logs its token count, which you can view in Render's logs.

### Deploy on Render (about 10 minutes)

1. Put this folder in a **private** GitHub repo.
2. In Render, go to New → Blueprint and pick the repo. `render.yaml` sets everything up: Frankfurt region, the health check, and the start command.
3. When asked, enter `ANTHROPIC_API_KEY` (a company key from console.anthropic.com → API keys) and a `TEAM_PASSWORD`.
4. Share the `…onrender.com` URL and the password with the team. You can add a custom domain in Render if you like.

The `starter` plan is always on. `free` also works but sleeps after 15 minutes idle, so the first load takes about 30 seconds.

### Run it anywhere else

The server runs on any machine with Node 20+:

```
ANTHROPIC_API_KEY=sk-ant-… TEAM_PASSWORD=… SESSION_SECRET=$(openssl rand -hex 32) node server/server.js
```

It listens on `PORT` (default 3000). Put it behind HTTPS.

### Settings (env vars)

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | company key (required) |
| `TEAM_PASSWORD` | – | shared password (required) |
| `SESSION_SECRET` | random at start | signs login cookies; set it so sign-ins survive restarts |
| `MODEL` | `claude-sonnet-5` | "Balanced" model |
| `MODEL_COMPLEX` | `claude-opus-5-5` | "Most capable" model |
| `DRAFTS_PER_HOUR` | 30 | per person (IP) |
| `DRAFTS_PER_DAY` | 300 | whole team |

To change the password, update `TEAM_PASSWORD` in Render and redeploy. Existing sign-ins stay valid until `SESSION_SECRET` changes.

## Figma plugin: install for development

1. In Figma desktop, go to Plugins → Development → Import plugin from manifest… and pick `figma/manifest.json`.
2. Open it and add an Anthropic API key under Claude API settings. The key is stored only in Figma's client storage on that machine. The model field defaults to `claude-sonnet-5`; change it to any model your key can use.
3. Select an image layer and press Use selected image, or upload a photo. Crop, draft, fine-tune under Adjust, then Place on canvas.

## Plan format

The coordinates are in dp, with the origin at the bottom left and y pointing up. Shapes are applied in order: `add` fills an area and `cut` removes one.

Shape types: `rect`, `poly`, `gable`, `spire`, `dome`, `ellipse`, `arch`, and `windows` (a grid of openings).

Bands are written as `{from, to, shift}`, with `shift` set to 0 or 2. The prompt is in `buildPrompt()`. Designers can also edit the JSON directly in both front ends.

## What the reference set taught us

- The DB graphics are exact vector rectangles on a 1 dp grid, and they reconstruct losslessly.
- The validator passes most of them. A few use bars of 2–3 dp or touching bars, which the guideline allows as exceptions. The generator never produces those.
- Typical sizes are about 90 dp tall for buildings, 140–190 dp for towers, and up to about 180 dp wide for bridges and long façades.

## Next steps

- Build an evaluation set from the 21 photo/graphic pairs in the backlight sheets and score the drafts against the real graphics.
- Give Claude the trace mask as extra context (hybrid).
- Add a skyline composer that combines 3 landmarks at the same scale on a shared baseline.
- Before rollout, confirm the grey tones and Cold Black hex with the DB colour spec.
