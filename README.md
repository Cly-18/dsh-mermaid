# dsh-mermaid

A [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) web plugin that auto-renders ```mermaid code blocks in the conversation.

**Fully offline** — Mermaid 11 is bundled inside the client bundle. No CDN, no network, no runtime downloads.

## Features

- Auto-render every ` ```mermaid ` code block in the conversation (including inside shadow DOM)
- Colorful theme that follows the app's light/dark mode
- Diagram centered in a figure area with a minimum height
- Toolbar (top-right): 源码/图表 toggle · 放大 · 缩小 · 重置 · zoom % · 导出SVG
- Free drag-panning inside the figure, zoom 25%–400% around the center
- Serialized rendering queue (safe for many diagrams on one page)

## Install

The plugin is a dual-face package: a no-op node half plus a `dsh.client` browser half.

1. **Place the package** where your profile resolves packages from:

   ```bash
   # assume your profile is "web" and DSH home is ~/.dsh
   mkdir -p ~/.dsh/profiles/node_modules/dsh-mermaid
   cp package.json lib/index.js lib/client.js ~/.dsh/profiles/node_modules/dsh-mermaid/
   ```

   (or `npm install dsh-mermaid` / `npm link` if you publish it)

2. **Register the row** in your profile patch, e.g. `~/.dsh/profiles/web/cordis.patch.yml`:

   ```yaml
   - insert:
       - id: dsh-mermaid
         name: 'dsh-mermaid'
   ```

3. **Restart DSH.** Refresh the page — mermaid blocks now render, and they survive
   page refreshes and offline use.

## Build from source

```bash
# 1. put mermaid's browser build at vendor/mermaid.min.js
#    (from the mermaid npm package: dist/mermaid.min.js)
# 2. build the client bundle
node build.mjs
# → regenerates lib/client.js (factory wrapper + inlined mermaid + renderer)
```

The renderer source lives in `src/client.js`; the build concatenates it with the
bundled mermaid IIFE inside the module factory.

## Upgrade mermaid

Replace `vendor/mermaid.min.js` with the `dist/mermaid.min.js` of the version you
want, run `node build.mjs`, and re-copy `lib/client.js` into your profile.

## How it works

- `package.json` declares `dsh.client.platform: "web"` and exports `./client`;
  DSH's client-modules host half scans Loader entries, serves
  `/plugins/dsh-mermaid/client.js`, and injects it into `window.__DSH_BOOT__`.
- The bundle is a `__ModuleLoader__` factory: the mermaid IIFE runs inside the
  factory scope and exposes `globalThis.mermaid`, then the renderer plugin
  (`exports.apply`) observes the DOM, renders each mermaid block, and wires the
  toolbar/zoom/pan/export UI.

## License

MIT. Mermaid is bundled under its own MIT license — see `vendor/LICENSE-mermaid`.
