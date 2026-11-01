# Notes for AI agents working on this repo

Chrome (Manifest V3) extension that sends a portrait, costume and pose into Gemini or ChatGPT. Read `README.md` for what it does. This file covers what you need to change and ship it safely.

## Releasing: a release needs a version tag

**A release is only created when a `v*` tag is pushed.** Pushing to `main` alone builds nothing and publishes nothing.

1. Commit and push your changes to `main`.
2. Pick the next version (`v3.0.1` → `v3.0.2` for fixes, `v3.1.0` for features) and tag the commit you want to ship:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
3. The workflow `.github/workflows/release.yml` runs on the tag. It builds with `RELEASE=1` (minified) and attaches `pose-studio-extension-vX.Y.Z.zip` to a new GitHub release.
4. Check it finished: `gh run list --limit 3`, then `gh release view vX.Y.Z`. Report any failure to the user instead of retrying blindly.

Rules:
- **Do not edit the version in `extension/manifest.json` or `package.json` for a release.** The workflow rewrites the manifest version from the tag.
- Tags must start with `v` and use `MAJOR.MINOR.PATCH`. Never reuse or move an existing tag. Make a new one.
- Only tag and push when the user asks for a release. Tags and releases are public.
- To test the build without releasing, run the workflow manually from the Actions tab (**workflow_dispatch**). It uploads a build artifact and makes no release.
- If Actions is disabled (forks start with it off): `gh api -X PUT repos/OWNER/REPO/actions/permissions -F enabled=true -f allowed_actions=all`.

## Build and test

```bash
pnpm install
pnpm build          # typecheck (tsc) + bundle → extension-dist/
```

- `RELEASE=1 pnpm build` gives the minified release build. The default build is unminified with an inline sourcemap, so errors name real lines.
- Load `extension-dist/` in `chrome://extensions` (Developer mode → Load unpacked). After a rebuild, click reload on the extension and refresh the Gemini or ChatGPT tab.
- You can't click the toolbar icon from automation. To test the UI without Chrome loading the extension, serve a copy of `content.js` and `data/` from a throwaway folder, stub `window.chrome` (`runtime.getURL`, `sendMessage`, `onMessage.addListener`), and replace `location.hostname` with `'gemini.google.com'` before `eval`. Check the console for errors, then drive the shadow DOM (`#pose-studio-host`).
- Nothing here has been tested end to end on live Gemini or ChatGPT without a logged-in user. Say so rather than claiming it works.

## Code map

| File | Role |
|---|---|
| `extension/src/background.ts` | Toolbar click, IndexedDB for saved images, cross-origin image fetch |
| `extension/src/content.ts` | The overlay UI (Shadow DOM) and the send flow |
| `extension/src/site.ts` | Per-site automation: selectors, attach images, fill text, pick the image tool, send, capture results |
| `extension/src/prompt.ts` | Style presets and prompt builders |
| `extension/src/styles.ts` | Overlay CSS |
| `scripts/build-extension.mjs` | Build: bundles, copies `data/*-en.json` and `thumbs/`, generates icons |

## Pitfalls we already hit

- **Startup order in `content.ts`:** the `init(site)` call must stay at the **bottom** of the file. Calling it earlier crashes with `esc is not a function` because the `const` helpers aren't defined yet, and the toolbar then shows "N/A".
- **Message replies:** the content script's `onMessage` listener must call `sendResponse`. Without it the background worker thinks the page is missing, re-injects, toggles twice and shows "N/A".
- **CSS names inside the overlay:** don't reuse a class name for both the root's state and a child element (this once shrank the overlay to phone width). The root state class is `is-busy`, the loading screen is `.busyscreen`.
- **Site selectors break:** Gemini and ChatGPT change their markup. The selectors and button-text matches are at the top of `site.ts`. Fix them there.
- **Adult content:** Gemini and ChatGPT refuse it. Items in the Sexy, Lingerie and Intertwined series are marked 18+ and the UI warns. Do not add anything meant to evade a site's content rules.
- **Don't publish the original full-size images:** `img/` is git-ignored. The extension only bundles thumbnails and fetches full images from the original galleries when sending.

## Housekeeping

- Never run broad process kills (for example every `python.exe`). Stop a test server by its port.
- Keep the credit and disclaimer sections in `README.md`. This repo is based on `anhao/ai-pose-gallery-zh` and is an educational test project.
