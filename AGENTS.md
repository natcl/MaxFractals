# MaxFractals

## Repo structure

```
feedback.maxpat    — Original Max/MSP/Jitter video feedback patch (reference)
feed.json          — 14 presets from the Max patch
web/               — WebGL clone (published to GitHub Pages)
  app.js           — WebGL renderer + MIDI + UI
  index.html       — Main app entry
  style.css        — Dark theme, dial widget, MIDI indicators
  midi-test.html   — MIDI diagnostics page
  midi-test.js     — MIDI tester with live message log
.github/workflows/pages.yml — Deploys web/ on push to master
```

## Running

No build step. Static files only.

```bash
cd web && python3 -m http.server 8000
```

Open `http://localhost:8000`. Camera + WebGL required. MIDI optional.

## WebGL pipeline (app.js)

3 passes per frame at 1280×720:

1. **Mix** — sample camera + feedback texture at direct UV, `mix(cam, fb, feedbackAmount)` → `mixFbo`
2. **Blit** — copy `mixFbo` to screen (display shows the raw crossfade, no transform)
3. **Feedback** — sample `mixFbo` at inverse-transformed UV (rota + zoom around anchor), apply brcosa → ping-pong FBO

This matches the original Max patch: display = xfade output, feedback = rota(brcosa(xfade_output)).

`texture2D` with `LINEAR` + `CLAMP_TO_EDGE` matches `@interp 1 @boundmode 4`.

## MIDI (app.js)

- **Learn**: right-click any control → orange glow → wiggle a knob → binding saved to `localStorage`
- **Device selection**: `onmidimessage` registered on ALL inputs. Prefers "Midi Fighter" by name.
- **Mode detection**: first message per binding determines absolute vs relative; locked for the binding's lifetime
  - `61-67` or `1-20` or `108-127` → **relative** (offset or signed-bit convention)
  - anything else → **absolute** (CC 0-127 maps to full parameter range)
- **Init**: `initMIDI()` must be called from a user gesture (right-click or clicking the MIDI dot). Not auto-called on page load.
- **Theta**: endless rotation. Relative mode never clamps. Absolute mode uses shortest-path wrap around 2π, not direct replacement.
- **Re-learn**: right-clicking a bound control clears the cached mode and re-detects from the next message.
- **LED feedback**: bound controls send CC back to Twister output for encoder ring positions.
- **Diagnostics**: `midi-test.html` — click "Connect MIDI" to see device list, live message log, raw hex.

## Parameters (state object → MIDI controls)

| Control | State prop | Range | Relative sensitivity |
|---------|-----------|-------|-------------------|
| feedback | `state.feedback` | 0–1 | 0.005 |
| theta | `state.theta` | 0–2π | 0.02 rad |
| zoom-x | `state.zoomX` | –3–3 | 0.02 |
| zoom-y | `state.zoomY` | –3–3 | 0.02 |
| anchor-x | `state.anchorX` | 0–1280 | 5 px |
| anchor-y | `state.anchorY` | 0–720 | 5 px |
| brightness | `state.brightness` | –1–1 | 0.01 |
| contrast | `state.contrast` | 0–3 | 0.02 |

## Deployment

Push to `master` → GitHub Actions deploys `web/` to Pages. Repo Settings → Pages → Source must be set to "GitHub Actions" (one-time setup).
