# Personal Website

Source for [Ralston Raphael](https://github.com/ralstonraphael)'s personal site: off-white paper, glass, monospace, and a thermal spectrum (ice → blue → violet → red → orange → yellow) used for anything that shows heat: a live pixel heat-map behind the hero, a GitHub / "this visit" attention heatmap, pixel "messy → structured" project displays, and a ⌘K command palette.

No framework and no build step: plain HTML, CSS and ES modules.

## Run locally

ES modules need a server (opening `index.html` from disk won't load the scripts):

```sh
npx serve .            # or: python3 -m http.server 4173
```

## Where things live

| Path | What |
| --- | --- |
| `index.html` | All content: hero, track record, about, experience, projects, education, contact. Edit copy here. |
| `assets/css/site.css` | Design tokens (top of file: `--th-1…9` is the thermal spectrum), layout, components, logo map, dark theme, print résumé. |
| `assets/js/main.js` | Wires everything up: nav, reveals, clocks, copy-email, accordion, logo jumps, motion switch, ⌘K commands. |
| `assets/js/field.js` | Thermal field: drifting heat plumes + cursor heat on a pixel grid; springs and click ripples. |
| `assets/js/heatmap.js` | Activity heatmap: GitHub contributions, or an attention map of the current visit (rows = sections). |
| `assets/js/pixels.js` | Project-card pixel displays (grey input → thermal output on hover). |
| `assets/js/palette.js` | ⌘K / `/` command palette. |
| `assets/js/scramble.js` | Monospace text-decode effect. |
| `assets/logos/` | Company and school logos, rendered as monochrome masks that heat up on hover. |
| `assets/fonts/` | Self-hosted Geist, Geist Mono and Geist Pixel (SIL OFL). |

## Notes

- **Résumé button** prints the page with a dedicated print stylesheet, so "Save as PDF" produces a clean résumé (⌘P works too).
- **GitHub heatmap** is fetched in the visitor's browser from `github-contributions-api.jogruber.de`. If it can't be reached, the card switches to the live "this visit" attention map.
- **Accessibility**: `prefers-reduced-motion` is respected, and the footer's `motion: on/off` switch pauses every ambient animation. Everything is keyboard reachable: `/` or ⌘K opens the menu; `A` `E` `P` `C` jump to sections and `T` toggles theme (single-key shortcuts can be turned off from the menu).
- **Social preview**: `og:image` needs an absolute URL once the site has a domain (see the comment in `index.html`).
- **Deploying**: it's a static site. GitHub Pages (Settings → Pages → deploy from branch, root), Vercel, Netlify or Cloudflare Pages all work with zero config.
