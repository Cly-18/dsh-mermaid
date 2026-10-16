// dsh-mermaid renderer. Concatenated into client.js inside the module factory;
// the mermaid library is inlined above this file and exposes globalThis.mermaid.
//
// Everything above `apply` is pure and takes its inputs as arguments, so the
// decisions that matter (source recognition, text cleanup, dark-theme
// resolution) are unit-testable without a DOM. `apply` owns all DOM work.
//
// Two rules this file follows deliberately, both enforced by the dynamic client
// sandbox in 0.2.0-rc.2:
//   1. Never reference the bare identifiers setTimeout / setInterval /
//      clearTimeout / clearInterval, and never call fetch. The sandbox shadows
//      exactly those names with throwing redirects. Qualified `window.setTimeout`
//      reaches the real browser implementation, which is what this file uses.
//   2. Never touch another plugin's markup to work out where to place our own
//      UI. Only the host's documented `data-code-block-*` hooks are read, and
//      they carry meaning rather than layout.

// ---------------------------------------------------------------------------
// Pure: source recognition
// ---------------------------------------------------------------------------

/** Diagram kinds mermaid accepts as a document's first keyword. */
const MERMAID_KEYWORDS = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'classDiagram-v2',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'pie',
  'journey',
  'mindmap',
  'timeline',
  'quadrantChart',
  'requirementDiagram',
  'gitGraph',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
  'zenuml',
  'sankey-beta',
  'block-beta',
  'packet-beta',
  'architecture-beta',
  'xychart-beta',
  'radar-beta',
  'treemap'
]

/** First-line keyword test, plus mermaid's own directives. */
const MERMAID_HEAD = new RegExp(
  '^(?:%%\\{|%%[^%]|' + MERMAID_KEYWORDS.map((k) => k.replace(/-/g, '\\-')).join('|') + ')\\b'
)

/** The one fence tag that means "this block is a mermaid document". */
const MERMAID_TAG = 'mermaid'

/**
 * A bare language tag, the only kind of banner label that says anything about a
 * fence's language. The host prints a localized generic label ("代码块" /
 * "Code block") for every tag its highlighter does not know — mermaid included
 * — so that label must never be read as "this block is not mermaid".
 */
const LANGUAGE_TAG = /^[A-Za-z][\w+#.-]*$/

/**
 * Whether a code block's banner names mermaid. Only a bare language tag is
 * consulted (see `LANGUAGE_TAG`): the host's localized generic fallback is not
 * a statement about the fence, so it is never treated as a veto.
 *
 * @param label - raw banner text, or anything else.
 * @returns whether the label names mermaid.
 */
function isMermaidLabel(label) {
  if (typeof label !== 'string') return false
  const head = label.trim().toLowerCase().split(/[\s:]/)[0]
  return head === MERMAID_TAG
}

/**
 * Whether a code block's source looks like a mermaid document by its first
 * keyword. Used only when the host offers no language label.
 *
 * @param text - the block's source text.
 * @returns whether the first line opens a mermaid diagram.
 */
function isMermaidSource(text) {
  if (typeof text !== 'string') return false
  return MERMAID_HEAD.test(text.trim())
}

// ---------------------------------------------------------------------------
// Pure: text recovery
// ---------------------------------------------------------------------------

/**
 * Candidate readings of a block that carried line-number artifacts. Some hosts
 * copy text out of a numbered view, leaving a gutter prefix or suffix on every
 * line, which mermaid then rejects. Both plausible strip patterns are offered
 * and the caller keeps whichever parses.
 *
 * @param raw - the block's text as read from the DOM.
 * @returns the distinct cleaned variants, in preference order.
 */
function cleanedVariants(raw) {
  const lines = String(raw).split('\n')
  const candidates = [
    lines.map((line) => line.replace(/^\s*\d+\s*/, '')).join('\n'),
    lines.map((line) => line.replace(/\s*\d+$/, '')).join('\n')
  ]
  const seen = new Set([raw])
  const out = []
  for (const candidate of candidates) {
    if (candidate === raw || seen.has(candidate)) continue
    seen.add(candidate)
    out.push(candidate)
  }
  return out
}

/**
 * The first reading of a block that `parse` accepts, or `null` when none does.
 * `parse` is injected so this stays independent of mermaid, and it may be async
 * — mermaid's own `parse` is.
 *
 * @param raw - the block's text as read from the DOM.
 * @param parse - predicate returning whether a candidate is a valid document.
 * @returns a parseable document, or `null`.
 */
async function resolveSource(raw, parse) {
  if (await parse(raw)) return raw
  for (const variant of cleanedVariants(raw)) if (await parse(variant)) return variant
  return null
}

// ---------------------------------------------------------------------------
// Pure: theme resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective colour scheme from the signals the host exposes, in
 * order of authority.
 *
 * `3` is the token probe rather than an attribute because the host writes its
 * palette as CSS variables and flips them, so the variable's luma follows the
 * live theme even when no attribute is set.
 *
 * @param signals - the observed signals; any may be absent.
 * @returns whether the page is currently dark.
 */
function decideDark(signals) {
  const { colorScheme, darkThemeAttribute, tokenLuma, themeAttribute, prefersDark } = signals
  if (colorScheme === 'dark') return true
  if (colorScheme === 'light') return false
  if (darkThemeAttribute === true) return true
  if (typeof tokenLuma === 'number' && Number.isFinite(tokenLuma)) return tokenLuma < 128
  if (typeof themeAttribute === 'string' && themeAttribute.length > 0) {
    return /dark/i.test(themeAttribute)
  }
  return prefersDark === true
}

/**
 * Relative luminance of a CSS colour, or `null` when it does not parse. Only
 * rgb()/rgba() is understood, which is what a computed custom property yields.
 *
 * @param cssColor - computed colour text.
 * @returns luminance in 0..255, or `null`.
 */
function lumaOf(cssColor) {
  if (typeof cssColor !== 'string') return null
  const match = /rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/.exec(cssColor)
  if (!match) return null
  return 0.2126 * parseFloat(match[1]) + 0.7152 * parseFloat(match[2]) + 0.0722 * parseFloat(match[3])
}

// ---------------------------------------------------------------------------
// Host DOM hooks
// ---------------------------------------------------------------------------

/**
 * Attributes the Host puts on every rendered code block. They are semantic
 * hooks, not styling: the banner marks the block's header row and the content
 * node wraps the code body itself. Both survive the host's CSS-module class
 * hashes, which is why this plugin reads them and never a class name.
 */
const CONTENT_SELECTOR = '[data-code-block-content]'
const BANNER_SELECTOR = '[data-code-block-banner]'
const RENDERED_ATTR = 'data-dsh-mmd-rendered'
const MARK_ATTR = 'data-dsh-mermaid'
/**
 * The source text a `failed` mark was written against. Kept beside the mark so a
 * later pass can tell "this block is still broken" from "this block has been
 * rewritten since", which is what lets a streamed block recover on its own.
 */
const FAILED_TEXT_ATTR = 'data-dsh-mermaid-failed-text'

/**
 * The block's source text exactly as it would reach mermaid. Shared by the
 * analysis in `renderBlock` and the comparison in `looksLikeMermaid` so the two
 * can never disagree about what "the same text" means.
 *
 * @param code - the block's `<code>` node.
 * @returns the trimmed source text.
 */
const blockText = (code) => (code.textContent || '').trim()

/** Host theme tokens. `bg-base` is the page background each scheme flips. */
const TOKEN_BG_BASE = '--dsw-alias-bg-base'

/** How long the DOM must stay quiet before a pass runs. */
const SETTLE_MS = 250

// ---------------------------------------------------------------------------
// DOM: block recognition
// ---------------------------------------------------------------------------
//
// These three read the host's DOM but own nothing else, so they live at module
// scope: devtest can then exercise the shipped predicates instead of a copy.

const insideRendered = (node) => {
  try {
    return node.closest('[' + RENDERED_ATTR + '], .dsh-mmd-wrap') !== null
  } catch (error) {
    return false
  }
}

/**
 * Record that this block's current text did not render, and against which text.
 * The companion attribute is what makes the mark retireable: a later pass
 * compares the block's text with it, so only a block that is genuinely unchanged
 * stays skipped.
 *
 * @param pre - the block's `<pre>`.
 * @param code - the block's `<code>` node.
 */
const markFailed = (pre, code) => {
  pre.setAttribute(MARK_ATTR, 'failed')
  pre.setAttribute(FAILED_TEXT_ATTR, blockText(code))
}

/**
 * The language the host printed in a code block's banner, or `null` when there
 * is no banner to read.
 *
 * The host renders two banner variants. The simple one is the info string
 * itself; the richer CodeCard header — the one the chat markdown renderer
 * always produces — nests the language one level deeper, as
 * `heading > span.language`, next to an optional `span.title`. Reading the
 * whole heading would splice the user's own title into the label, so descend to
 * the leaf that holds the language.
 *
 * @param pre - the `<pre>` carrying the code body.
 * @returns the banner's language text, or `null`.
 */
const readBlockLabel = (pre) => {
  let node = null
  try {
    node = pre.closest(CONTENT_SELECTOR)
  } catch (error) {}
  const block = node ? node.parentElement : null
  if (!block) return null
  const banner = block.querySelector(BANNER_SELECTOR)
  if (!banner) return null
  const first = banner.firstElementChild
  const language = first && first.firstElementChild ? first.firstElementChild : first
  return language ? language.textContent : null
}

/**
 * Whether a `<pre>`/`<code>` pair is a mermaid document this plugin should
 * render. Three signals, in order:
 *
 *   1. a class naming mermaid is a direct statement by the host;
 *   2. a *bare language tag* in the banner is authoritative in both directions;
 *   3. otherwise the source's first keyword is the only thing left to go on.
 *
 * Step 2 is deliberately narrow. The host labels every fence its highlighter
 * does not recognise with a localized generic string ("代码块" / "Code block"),
 * which carries no information about the fence at all — treating it as a veto
 * would silently disable this plugin for every mermaid block in the chat.
 */
const looksLikeMermaid = (pre, code) => {
  if (!pre || !code) return false
  if (pre.hasAttribute(MARK_ATTR)) {
    // A `failed` mark only says "these bytes did not render". While the answer
    // streams in, a block is judged on a half-written document and every
    // rejection would otherwise be permanent — the reader would have to reload
    // the page to see a diagram whose text has long since been completed. The
    // mark therefore retires as soon as the text it was written against moves.
    if (pre.getAttribute(MARK_ATTR) !== 'failed') return false
    if (pre.getAttribute(FAILED_TEXT_ATTR) === blockText(code)) return false
    pre.removeAttribute(MARK_ATTR)
    pre.removeAttribute(FAILED_TEXT_ATTR)
  }
  if (insideRendered(pre)) return false
  const classes = String(code.className || '') + ' ' + String(pre.className || '')
  if (/\bmermaid\b/i.test(classes)) return true
  const label = readBlockLabel(pre)
  if (label !== null && LANGUAGE_TAG.test(label.trim())) return isMermaidLabel(label)
  return isMermaidSource(code.textContent || '')
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * @param ctx - the plugin context handed to `apply`.
 */
function apply(ctx) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  const mermaid = globalThis.mermaid
  if (!mermaid || typeof mermaid.render !== 'function') {
    console.error('[dsh-mermaid] mermaid library missing; not rendering')
    return
  }

  let disposed = false
  let counter = 0
  let queue = Promise.resolve()
  const replacements = []
  const observers = []
  const states = []

  // -- scheduling ----------------------------------------------------------
  // The client sandbox shadows the bare timer identifiers with throwing
  // redirects, so timers always go through the qualified `window.*` forms.
  // `queueMicrotask` is the fallback for an environment without them.
  const scheduleLater = (fn, ms) => {
    if (typeof window.setTimeout === 'function') {
      const id = window.setTimeout(fn, ms)
      return () => {
        try {
          window.clearTimeout(id)
        } catch (error) {}
      }
    }
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(fn)
      return () => {}
    }
    fn()
    return () => {}
  }

  const debounce = (fn, ms) => {
    let cancel = null
    const wrapped = () => {
      if (cancel) cancel()
      cancel = scheduleLater(() => {
        cancel = null
        fn()
      }, ms)
    }
    wrapped.dispose = () => {
      if (cancel) {
        cancel()
        cancel = null
      }
    }
    return wrapped
  }

  // -- DOM traversal -------------------------------------------------------
  const collectRoots = () => {
    const roots = []
    const seen = new Set()
    const push = (root) => {
      if (root && !seen.has(root)) {
        seen.add(root)
        roots.push(root)
      }
    }
    push(document)
    for (let i = 0; i < roots.length; i++) {
      let all = []
      try {
        all = roots[i].querySelectorAll('*')
      } catch (error) {}
      for (let j = 0; j < all.length; j++) if (all[j].shadowRoot) push(all[j].shadowRoot)
    }
    return roots
  }

  const collect = (selector) => {
    const found = []
    for (const root of collectRoots()) {
      let hits = []
      try {
        hits = root.querySelectorAll(selector)
      } catch (error) {}
      for (let i = 0; i < hits.length; i++) found.push(hits[i])
    }
    return found
  }

  /**
   * The `<pre>` elements that carry a fenced-code body. Prefers the host's
   * content hook; falls back to every `<pre>` so a host without it still works.
   */
  const findCodePre = () => {
    const anchored = collect(CONTENT_SELECTOR + ' pre')
    return anchored.length > 0 ? anchored : collect('pre')
  }

  // -- transform -----------------------------------------------------------
  const applyTransform = (state) => {
    state.svgEl.style.transform =
      'translate(' + state.panX + 'px,' + state.panY + 'px) scale(' + state.scale + ')'
    state.zoomLabel.textContent = Math.round(state.scale * 100) + '%'
  }

  const enableDrag = (state) => {
    const figure = state.figure
    figure.style.cursor = 'grab'
    figure.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      state.dragging = true
      state.lastX = event.clientX
      state.lastY = event.clientY
      figure.style.cursor = 'grabbing'
      const onMove = (moved) => {
        if (!state.dragging) return
        state.panX += moved.clientX - state.lastX
        state.panY += moved.clientY - state.lastY
        state.lastX = moved.clientX
        state.lastY = moved.clientY
        applyTransform(state)
      }
      const onUp = () => {
        state.dragging = false
        figure.style.cursor = 'grab'
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    })
  }

  const exportSvg = (state) => {
    try {
      const blob = new Blob([state.svg], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'mermaid-diagram.svg'
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      scheduleLater(() => {
        try {
          URL.revokeObjectURL(url)
        } catch (error) {}
      }, 1000)
    } catch (error) {
      console.error('[dsh-mermaid] export failed:', error && error.message ? error.message : String(error))
    }
  }

  const ICONS = {
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    chart:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    zoomIn:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    zoomOut:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    reset:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
    download:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    maximize:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
    minimize:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>'
  }

  // -- fullscreen: native API first, in-page overlay as the fallback --------
  let bodyLocked = false
  let savedOverflow = ''

  const syncFullscreenButton = (state) => {
    const button = state.fsBtn
    if (!button) return
    const on = state.fullscreen
    button.innerHTML = on ? ICONS.minimize : ICONS.maximize
    const label = on ? '退出全屏' : '全屏显示'
    button.title = label
    button.setAttribute('aria-label', label)
  }

  const setBodyLock = () => {
    let active = false
    for (let i = 0; i < states.length; i++)
      if (states[i].fullscreen) {
        active = true
        break
      }
    if (active && !bodyLocked) {
      savedOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      bodyLocked = true
    } else if (!active && bodyLocked) {
      document.body.style.overflow = savedOverflow
      bodyLocked = false
    }
  }

  const cssFullscreenOn = (state) => {
    state.wrap.classList.add('dsh-mmd-fs')
    state.fullscreen = true
    syncFullscreenButton(state)
    setBodyLock()
  }

  const toggleFullscreen = (state) => {
    const wrap = state.wrap
    if (state.fullscreen) {
      if (document.fullscreenElement) {
        try {
          document.exitFullscreen()
        } catch (error) {}
      }
      wrap.classList.remove('dsh-mmd-fs')
      state.fullscreen = false
      syncFullscreenButton(state)
      setBodyLock()
      return
    }
    if (document.fullscreenEnabled && typeof wrap.requestFullscreen === 'function') {
      let request = null
      try {
        request = wrap.requestFullscreen()
      } catch (error) {}
      if (request && typeof request.then === 'function') {
        request
          .then(() => {
            state.fullscreen = true
            syncFullscreenButton(state)
          })
          .catch(() => cssFullscreenOn(state))
      } else {
        state.fullscreen = true
        syncFullscreenButton(state)
      }
    } else {
      cssFullscreenOn(state)
    }
  }

  const onFullscreenChange = () => {
    for (let i = 0; i < states.length; i++) {
      const state = states[i]
      if (document.fullscreenElement === state.wrap) {
        if (!state.fullscreen) {
          state.fullscreen = true
          syncFullscreenButton(state)
        }
      } else if (state.fullscreen && !state.wrap.classList.contains('dsh-mmd-fs')) {
        state.fullscreen = false
        syncFullscreenButton(state)
      }
    }
    setBodyLock()
  }

  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return
    let closed = false
    for (let i = 0; i < states.length; i++) {
      const state = states[i]
      if (state.fullscreen && state.wrap.classList.contains('dsh-mmd-fs')) {
        state.wrap.classList.remove('dsh-mmd-fs')
        state.fullscreen = false
        syncFullscreenButton(state)
        closed = true
      }
    }
    if (closed) setBodyLock()
  }

  const createToolbar = (state) => {
    const bar = document.createElement('div')
    bar.className = 'dsh-mmd-toolbar'

    const button = (svg, onClick, label) => {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = 'dsh-mmd-btn'
      element.innerHTML = svg
      element.title = label
      element.setAttribute('aria-label', label)
      element.addEventListener('click', () => onClick(element))
      return element
    }

    const toggle = button(
      ICONS.code,
      (element) => {
        state.showSource = !state.showSource
        element.innerHTML = state.showSource ? ICONS.chart : ICONS.code
        element.title = state.showSource ? '查看图表' : '查看源码'
        element.setAttribute('aria-label', state.showSource ? '查看图表' : '查看源码')
        state.figure.style.display = state.showSource ? 'none' : ''
        state.srcEl.hidden = !state.showSource
      },
      '查看源码'
    )

    const zoomIn = button(
      ICONS.zoomIn,
      () => {
        state.scale = Math.min(4, state.scale * 1.25)
        applyTransform(state)
      },
      '放大'
    )
    const zoomOut = button(
      ICONS.zoomOut,
      () => {
        state.scale = Math.max(0.25, state.scale / 1.25)
        applyTransform(state)
      },
      '缩小'
    )
    const reset = button(
      ICONS.reset,
      () => {
        state.scale = 1
        state.panX = 0
        state.panY = 0
        applyTransform(state)
      },
      '重置'
    )
    const exportButton = button(ICONS.download, () => exportSvg(state), '导出SVG')
    const fullscreenButton = button(ICONS.maximize, () => toggleFullscreen(state), '全屏显示')
    state.fsBtn = fullscreenButton

    const zoomLabel = document.createElement('span')
    zoomLabel.className = 'dsh-mmd-zoom'
    zoomLabel.textContent = '100%'
    state.zoomLabel = zoomLabel

    bar.appendChild(toggle)
    bar.appendChild(zoomIn)
    bar.appendChild(zoomOut)
    bar.appendChild(reset)
    bar.appendChild(zoomLabel)
    bar.appendChild(exportButton)
    bar.appendChild(fullscreenButton)
    return bar
  }

  // -- render --------------------------------------------------------------
  /**
   * mermaid's own account of a failure. It rejects with a string, an Error, or a
   * hashed object depending on the stage, and the plugin's log is only useful if
   * the real reason survives — a generic message once cost a long hunt for a
   * cause that was never in the document.
   *
   * @param error - whatever mermaid rejected with.
   * @returns a printable message.
   */
  const reason = (error) => {
    if (typeof error === 'string') return error
    if (error && typeof error === 'object') {
      if (typeof error.str === 'string') return error.str
      if (typeof error.message === 'string') return error.message
    }
    return String(error)
  }

  const parseable = async (text) => {
    try {
      // `mermaid.parse` is async in 11.x and resolves `false` (rather than
      // rejecting) under `suppressErrors`, which is what makes it usable as a
      // cheap "would this candidate even parse?" test.
      return (await mermaid.parse(text, { suppressErrors: true })) !== false
    } catch (error) {
      return false
    }
  }

  const renderBlock = async (pre) => {
    const code = pre.querySelector('code')
    if (!code) return
    const raw = blockText(code)
    if (!raw) {
      markFailed(pre, code)
      return
    }

    const id = 'dshmmd' + ++counter
    // Render the block exactly as the host holds it. This is the whole
    // judgement: a parse probe evaluated first would decide the block's fate on
    // a predicate that is stricter than rendering itself, and every rejection
    // would be reported as "the document does not parse" even when the document
    // was never the problem.
    let text = raw
    let out = null
    let failure = null
    try {
      out = await mermaid.render(id, text)
    } catch (error) {
      failure = error
    }

    if (out === null || typeof (out && out.svg) !== 'string' || !out.svg) {
      // Second chance: the host can hand us text carrying line-number artifacts
      // (a copy out of a numbered view), which mermaid rejects. Only then is a
      // candidate known to be damaged, so only then do we go looking.
      const cleaned = await resolveSource(raw, parseable)
      if (disposed) return
      if (cleaned !== null && cleaned !== raw) {
        try {
          out = await mermaid.render('dshmmd' + ++counter, cleaned)
          failure = null
        } catch (error) {
          failure = error
        }
        if (out && typeof out.svg === 'string' && out.svg) text = cleaned
      }
    }
    if (disposed) return

    const svg = out && typeof out.svg === 'string' ? out.svg : ''
    if (!svg) {
      markFailed(pre, code)
      console.error(
        '[dsh-mermaid] render failed — mermaid said:',
        reason(failure),
        '| text:',
        JSON.stringify(raw)
      )
      return
    }
    const parent = pre.parentNode
    if (!pre.isConnected || !parent) {
      markFailed(pre, code)
      return
    }
    pre.removeAttribute(FAILED_TEXT_ATTR)

    const wrap = document.createElement('div')
    wrap.className = 'dsh-mmd-wrap'
    wrap.setAttribute(RENDERED_ATTR, '1')

    const figure = document.createElement('div')
    figure.className = 'dsh-mmd-figure'

    const svgEl = document.createElement('div')
    svgEl.className = 'dsh-mmd-svg'
    svgEl.innerHTML = svg
    figure.appendChild(svgEl)

    const srcEl = document.createElement('pre')
    srcEl.className = 'dsh-mmd-src'
    srcEl.hidden = true
    const sourceCode = document.createElement('code')
    sourceCode.textContent = text
    srcEl.appendChild(sourceCode)

    const state = {
      showSource: false,
      scale: 1,
      panX: 0,
      panY: 0,
      dragging: false,
      lastX: 0,
      lastY: 0,
      figure,
      srcEl,
      svgEl,
      svg,
      zoomLabel: null,
      wrap,
      fsBtn: null,
      fullscreen: false
    }

    const toolbar = createToolbar(state)
    states.push(state)
    enableDrag(state)

    wrap.appendChild(toolbar)
    wrap.appendChild(figure)
    wrap.appendChild(srcEl)

    // Swap the code body itself, inside the host's own content node. The
    // block's banner and frame stay exactly as the host rendered them, so
    // this replaces nothing the host's layout depends on.
    try {
      parent.replaceChild(wrap, pre)
    } catch (error) {
      markFailed(pre, code)
      return
    }
    replacements.push({ parent, pre, wrap })
  }

  const renderAll = () => {
    if (disposed) return
    const pres = findCodePre()
    for (let i = 0; i < pres.length; i++) {
      const pre = pres[i]
      const code = pre.querySelector('code')
      if (!looksLikeMermaid(pre, code)) continue
      pre.setAttribute(MARK_ATTR, 'pending')
      queue = queue.then(() => renderBlock(pre))
      queue = queue.catch(() => {})
    }
  }

  /**
   * Drop marks left over from a previous plugin activation, so a reload retries
   * blocks that failed before rather than skipping them forever. The companion
   * text attribute goes with the mark: a stale one would make the next pass
   * believe a brand-new block had already been rejected.
   */
  const resetStaleMarks = () => {
    const pres = findCodePre()
    for (let i = 0; i < pres.length; i++) {
      const pre = pres[i]
      const mark = pre.getAttribute(MARK_ATTR)
      if ((mark === 'pending' || mark === 'failed') && !insideRendered(pre)) {
        pre.removeAttribute(MARK_ATTR)
        pre.removeAttribute(FAILED_TEXT_ATTR)
      }
    }
  }

  const schedule = debounce(renderAll, SETTLE_MS)

  // -- observers -----------------------------------------------------------
  const observed = new Set()
  const attachObservers = () => {
    for (const root of collectRoots()) {
      if (observed.has(root)) continue
      observed.add(root)
      if (typeof MutationObserver === 'undefined') continue
      try {
        const observer = new MutationObserver(() => {
          if (schedule) schedule()
        })
        // `characterData` matters as much as `childList` here: a block that is
        // still streaming can grow by rewriting the text node it already has,
        // which raises no childList mutation at all. Without it a half-written
        // block would keep its `failed` mark until something else touched the
        // subtree.
        try {
          observer.observe(root, { childList: true, subtree: true, characterData: true })
        } catch (error) {
          observer.observe(root, { childList: true, subtree: true })
        }
        observers.push(observer)
      } catch (error) {}
    }
  }

  // -- theme ---------------------------------------------------------------
  const LIGHT_VARS = {
    primaryColor: '#dbeafe',
    primaryBorderColor: '#3b82f6',
    primaryTextColor: '#1e3a8a',
    secondaryColor: '#fef3c7',
    tertiaryColor: '#d1fae5',
    lineColor: '#8b5cf6',
    textColor: '#1f2937',
    mainBkg: '#ffffff',
    nodeBorder: '#6366f1',
    clusterBkg: '#f1f5f9',
    clusterBorder: '#94a3b8',
    titleColor: '#0f172a',
    edgeLabelBackground: '#ffffff'
  }
  const DARK_VARS = {
    primaryColor: '#1e3a5f',
    primaryBorderColor: '#60a5fa',
    primaryTextColor: '#dbeafe',
    secondaryColor: '#7c5c1e',
    tertiaryColor: '#1e4035',
    lineColor: '#a78bfa',
    textColor: '#e5e7eb',
    mainBkg: '#0f172a',
    nodeBorder: '#818cf8',
    clusterBkg: '#1e293b',
    clusterBorder: '#475569',
    titleColor: '#f8fafc',
    edgeLabelBackground: '#0f172a'
  }

  /**
   * Read the live theme signals off the page. Each probe is independently
   * guarded: a missing API in one of them must not stop the others.
   */
  const readThemeSignals = () => {
    const signals = {
      colorScheme: null,
      darkThemeAttribute: false,
      tokenLuma: null,
      themeAttribute: null,
      prefersDark: false
    }
    try {
      const root = document.documentElement
      if (root && root.style) {
        const scheme = root.style.colorScheme
        if (scheme === 'dark' || scheme === 'light') signals.colorScheme = scheme
        const attribute = root.getAttribute('data-theme') || root.getAttribute('data-color-mode')
        if (attribute) signals.themeAttribute = attribute
        else if (root.classList && root.classList.contains('dark')) signals.themeAttribute = 'dark'
      }
      if (document.body && document.body.hasAttribute('data-ds-dark-theme')) {
        signals.darkThemeAttribute = true
      }
      signals.tokenLuma = lumaOf(
        getComputedStyle(document.body).getPropertyValue(TOKEN_BG_BASE)
      )
      if (window.matchMedia) {
        signals.prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      }
    } catch (error) {}
    return signals
  }

  const detectDark = () => decideDark(readThemeSignals())

  let dark = detectDark()

  const configureMermaid = () => {
    try {
      mermaid.initialize({
        startOnLoad: false,
        useMaxWidth: false,
        theme: 'base',
        // Without this, a document mermaid cannot render makes it paint its own
        // error diagram into the page before rejecting. The host's code block is
        // still on screen at that point, and a block that is merely mid-stream
        // gets retried — so the error drawing would be a stray node rather than a
        // message. Rejecting quietly keeps the source visible and the retry clean.
        suppressErrorRendering: true,
        themeVariables: dark ? DARK_VARS : LIGHT_VARS
      })
    } catch (error) {}
  }

  /**
   * Put every rendered block back the way the host left it, then let a fresh
   * pass re-render under the new palette. Cheap, and it keeps the swap order
   * well defined when the reader is mid-scroll.
   */
  const restoreRendered = () => {
    if (document.fullscreenElement) {
      try {
        document.exitFullscreen()
      } catch (error) {}
    }
    for (let i = 0; i < states.length; i++) {
      try {
        states[i].wrap.classList.remove('dsh-mmd-fs')
      } catch (error) {}
    }
    states.length = 0
    setBodyLock()
    for (let i = replacements.length - 1; i >= 0; i--) {
      const entry = replacements[i]
      try {
        if (entry.wrap && entry.wrap.isConnected && entry.parent && entry.parent.isConnected) {
          entry.parent.replaceChild(entry.pre, entry.wrap)
          entry.pre.removeAttribute(MARK_ATTR)
          entry.pre.removeAttribute(FAILED_TEXT_ATTR)
        }
      } catch (error) {}
    }
    replacements.length = 0
  }

  /**
   * @param knownDark - the exact scheme from the host's own theme event, or
   *   `undefined` to read the signals off the page.
   */
  const applyTheme = (knownDark) => {
    const next = typeof knownDark === 'boolean' ? knownDark : detectDark()
    if (next === dark) return
    dark = next
    queue = queue.then(() => {
      if (disposed) return
      configureMermaid()
      restoreRendered()
      schedule()
    })
  }

  configureMermaid()

  // -- styles --------------------------------------------------------------
  const styleEl = document.createElement('style')
  styleEl.textContent =
    '.dsh-mmd-wrap{margin:0;border-radius:var(--dsw-radius-lg,8px)}' +
    // The toolbar stays in normal flow at the top of the figure: pinning it
    // would mean knowing how tall the host's sticky banner is, and reading the
    // host's markup to place our own UI is exactly what breaks on upgrade.
    '.dsh-mmd-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2))}' +
    '.dsh-mmd-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;font-size:12px;line-height:1;padding:5px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:var(--dsw-radius-sm,6px);background:transparent;cursor:pointer;color:var(--dsw-alias-label-primary,inherit)}' +
    '.dsh-mmd-btn svg{width:14px;height:14px;display:block}' +
    '.dsh-mmd-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.15))}' +
    '.dsh-mmd-zoom{font-size:12px;color:var(--dsw-alias-label-dimmed,currentColor);opacity:.9;min-width:42px;text-align:center}' +
    '.dsh-mmd-figure{display:flex;align-items:center;justify-content:center;min-height:300px;overflow:hidden;max-width:100%;padding:12px;cursor:grab;user-select:none}' +
    '.dsh-mmd-svg{transform-origin:center center;transition:transform .05s linear}' +
    '.dsh-mmd-svg svg{max-width:none;display:block}' +
    '.dsh-mmd-src{margin:0;padding:12px;overflow:auto;font-size:12px;background:var(--dsw-alias-markdown-code-block,rgba(0,0,0,.04));border-radius:0 0 var(--dsw-radius-lg,8px) var(--dsw-radius-lg,8px)}' +
    '.dsh-mmd-src code{white-space:pre}' +
    '.dsh-mmd-wrap:fullscreen,.dsh-mmd-wrap.dsh-mmd-fs{background:var(--dsw-alias-bg-base,#fff);display:flex;flex-direction:column;overflow:auto;border:none;border-radius:0;margin:0}' +
    '.dsh-mmd-wrap.dsh-mmd-fs{position:fixed;inset:0;z-index:2147483000}' +
    '.dsh-mmd-wrap:fullscreen .dsh-mmd-figure,.dsh-mmd-wrap.dsh-mmd-fs .dsh-mmd-figure{flex:1 1 auto;min-height:0}' +
    '.dsh-mmd-wrap:fullscreen .dsh-mmd-src,.dsh-mmd-wrap.dsh-mmd-fs .dsh-mmd-src{flex:1 1 auto;border-radius:0}'
  document.head.appendChild(styleEl)

  attachObservers()
  resetStaleMarks()
  renderAll()

  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('keydown', onKeyDown)

  // The host's own theme event is the exact signal; the DOM probes below cover
  // the paths that do not raise it.
  let offTheme = null
  if (ctx && typeof ctx.on === 'function') {
    try {
      offTheme = ctx.on('theme/change', (snapshot) => {
        const scheme = snapshot && snapshot.active ? snapshot.active.colorScheme : null
        if (scheme === 'dark' || scheme === 'light') applyTheme(scheme === 'dark')
        else applyTheme()
      })
    } catch (error) {}
  }

  let themeObserver = null
  try {
    if (typeof MutationObserver !== 'undefined') {
      themeObserver = new MutationObserver(() => applyTheme())
      themeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['style', 'data-ds-dark-theme', 'class']
      })
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style', 'class', 'data-theme', 'data-color-mode']
      })
    }
  } catch (error) {}

  let query = null
  let queryHandler = null
  try {
    if (window.matchMedia) {
      query = window.matchMedia('(prefers-color-scheme: dark)')
      queryHandler = () => applyTheme()
      if (typeof query.addEventListener === 'function') query.addEventListener('change', queryHandler)
      else if (typeof query.addListener === 'function') query.addListener(queryHandler)
    }
  } catch (error) {}

  const teardown = () => {
    disposed = true
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    document.removeEventListener('keydown', onKeyDown)
    if (offTheme) {
      try {
        offTheme()
      } catch (error) {}
    }
    if (themeObserver) {
      try {
        themeObserver.disconnect()
      } catch (error) {}
    }
    if (query && queryHandler) {
      try {
        if (typeof query.removeEventListener === 'function') query.removeEventListener('change', queryHandler)
        else if (typeof query.removeListener === 'function') query.removeListener(queryHandler)
      } catch (error) {}
    }
    for (let i = 0; i < states.length; i++) {
      try {
        states[i].wrap.classList.remove('dsh-mmd-fs')
      } catch (error) {}
    }
    states.length = 0
    if (bodyLocked) {
      try {
        document.body.style.overflow = savedOverflow
      } catch (error) {}
      bodyLocked = false
    }
    for (let i = 0; i < observers.length; i++) {
      try {
        observers[i].disconnect()
      } catch (error) {}
    }
    if (schedule && typeof schedule.dispose === 'function') {
      try {
        schedule.dispose()
      } catch (error) {}
    }
    if (styleEl.parentNode) {
      try {
        styleEl.parentNode.removeChild(styleEl)
      } catch (error) {}
    }
    for (let i = replacements.length - 1; i >= 0; i--) {
      const entry = replacements[i]
      try {
        if (entry.wrap && entry.wrap.isConnected && entry.parent && entry.parent.isConnected) {
          entry.parent.replaceChild(entry.pre, entry.wrap)
          entry.pre.removeAttribute(MARK_ATTR)
          entry.pre.removeAttribute(FAILED_TEXT_ATTR)
        }
      } catch (error) {}
    }
    replacements.length = 0
  }

  if (ctx && typeof ctx.effect === 'function') ctx.effect(() => teardown)
}

exports.apply = apply

// @test-only:start
// Exposed so devtest can exercise the decisions without a DOM. The build strips
// this block, so it never ships.
exports.__internals = {
  MERMAID_KEYWORDS,
  LANGUAGE_TAG,
  isMermaidLabel,
  isMermaidSource,
  cleanedVariants,
  resolveSource,
  decideDark,
  lumaOf,
  insideRendered,
  readBlockLabel,
  looksLikeMermaid
}
// @test-only:end
