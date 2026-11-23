# Project guide

This repository holds two separate products. Keep them separate.

1. **`index.html` (repo root)** — 「釣行まえチェック」checklist web app that existed before the game.
   Do not modify it unless the user asks. It stores data in localStorage key `fishing-checklist-v1`.
2. **`game/`** — 漁師ゲーム（作業名）browser prototype. Spec and history:
   - `FISHING_GAME_HANDOVER.md` — the planning handover (source of user decisions; read first)
   - `docs/STATUS.md` (where we are / next), `docs/DECISIONS.md` (choices + reasons), `docs/VALIDATION.md` (what was verified)

## Fixed policy (user decisions — do not drift)

- Search and spot selection are manual; the repetitive fishing work (drop, tana, lure, hook-set, retrieve) is automatic from the start.
- Repeating a method raises its level → faster handling → more fish in the same time. Equipment adds capacity.
- Choose fishing from peers' info, own logs, today's sea conditions and the sounder (M1, implemented).
- Candidates and labels are built only from what the player has heard/logged + the forecast — never from the live fish state.
- Realism of the fishing is the star; money and boat choice stay simple. One boat, upgraded / replaced (new or used).
- Do not add manual fishing minigames, QTE, breakdowns/maintenance, or complex management.

## Commands (run inside `game/`)

- `npm start` → http://localhost:8080/ (zero-dependency static server; `python3 -m http.server 8080` also works)
- `npm test` (node:test, core logic) · `npm run e2e` (headless Chromium playthrough) · `npm run lint`
- `?dev=1` shows fish schools on the chart (labelled 開発表示) and exposes `window.__ryoshi` for tests. Never use dev info in normal play.

## Architecture rules

- `game/src/core/` is pure simulation (no DOM). `game/src/ui/` only reads it and calls voyage commands.
- Fixed step 0.1 game s; results depend only on elapsed game time, never on frame rate, view or panel state.
- All randomness comes from `world.rng` or hash noise. UI must never consume the sim RNG.
- Catch ≤ min(candidates from school density at the hooks, handling capacity, school remaining, hold space). Fish are reserved from the school when hooked.
- Settlement / purchase are pure functions returning a whole new profile. Save keys use the `ryoshi-game:` prefix; never delete user saves (quarantine unreadable data). Bump `SAVE_SCHEMA` and add a migration when the format changes.
- Tunable numbers live in `game/src/core/data.js` and are provisional (仮設定).
- The sea continues across days as a pure function of (seed, day) (`season.js`); peer reports (`reports.js`) are computed from that world at their observation time. Keep observation time and acquisition time separate.

Before finishing a session: run lint + tests (+ e2e when UI changed) and update the three docs.
