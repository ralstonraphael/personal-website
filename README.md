# Personal Website

Source for [Ralston Raphael](https://github.com/ralstonraphael)'s personal site: an off-white, glass-and-mono portfolio with a live, cursor-reactive dot field, a GitHub / live-session activity heatmap, pixel "messy → structured" project displays, and a ⌘K command palette.

No framework and no build step: plain HTML, CSS and ES modules.

## Run locally

ES modules need a server (opening `index.html` from disk won't load the scripts):

```sh
npx serve .            # or: python3 -m http.server 4173
```

## Where things live

| Path | What |
| --- | --- |
| `index.html` | All content: hero, experience, projects, education, contact. Edit copy here. |
| `assets/css/site.css` | Design tokens (top of file), layout, components, dark theme, print résumé styles. |
| `assets/js/main.js` | Wires everything up: nav, reveals, clocks, copy-email, accordion, ⌘K commands. |
| `assets/js/field.js` | Hero heat field: dot grid that warms under the cursor, springs, ripples on click. |
| `assets/js/heatmap.js` | Activity heatmap: GitHub contributions, or a live heatmap of the current visit. |
| `assets/js/pixels.js` | Project-card pixel displays (messy input → structured output on hover). |
| `assets/js/palette.js` | ⌘K / `/` command palette. |
| `assets/js/scramble.js` | Monospace text-decode effect. |
| `assets/fonts/` | Self-hosted Geist, Geist Mono and Geist Pixel (SIL OFL). |

## Notes

- **Résumé button** prints the page with a dedicated print stylesheet, so "Save as PDF" produces a clean one-column résumé.
- **GitHub heatmap** is fetched in the visitor's browser from `github-contributions-api.jogruber.de`. If it can't be reached, the card falls back to the live "this visit" heatmap.
- **Accessibility**: every animation respects `prefers-reduced-motion`; everything is keyboard reachable (`/` or ⌘K opens the menu; `A` `E` `P` `C` jump to sections; `T` toggles theme).
- **Deploying**: it's a static site. GitHub Pages (Settings → Pages → deploy from branch, root), Vercel, Netlify or Cloudflare Pages all work with zero config.
