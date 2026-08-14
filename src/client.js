// dsh-mermaid renderer (concatenated into lib/client.js inside the module factory).
// The mermaid library is inlined above this file and exposes globalThis.mermaid.
function apply(ctx) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  const mermaid = globalThis.mermaid
  if (!mermaid || typeof mermaid.render !== 'function') {
    console.error('[dsh-mermaid] mermaid library missing; not rendering')
    return
  }

  let disposed = false
  let counter = 0
  let schedule = null
  let queue = Promise.resolve()
  const replacements = []
  const observers = []
  const timer = ctx.get('timer')

  const later = (fn, ms) => {
    if (timer && typeof timer.timeout === 'function') { try { return timer.timeout(fn, ms) } catch (e) {} }
    return setTimeout(fn, ms)
  }

  const nativeDebounce = (fn, ms) => {
    let handle = null
    const wrapped = () => {
      if (handle !== null) clearTimeout(handle)
      handle = setTimeout(() => { handle = null; fn() }, ms)
    }
    wrapped.dispose = () => { if (handle !== null) clearTimeout(handle) }
    return wrapped
  }

  const insideRendered = (code) => {
    let p = code.parentElement
    while (p) {
      if (p.hasAttribute && p.hasAttribute('data-dsh-mmd-rendered')) return true
      if (p.classList && (p.classList.contains('dsh-mmd-wrap') || p.classList.contains('dsh-mermaid-wrap'))) return true
      p = p.parentElement
    }
    return false
  }

  const looksLikeMermaid = (code) => {
    if (!code || code.nodeType !== 1) return false
    if (insideRendered(code)) return false
    const codeCls = typeof code.className === 'string' ? code.className : ''
    const pre = code.parentElement
    const preCls = (pre && typeof pre.className === 'string') ? pre.className : ''
    const cls = codeCls + ' ' + preCls
    if (/mermaid/i.test(cls)) return true
    if (/language-[\w-]+/i.test(cls)) return false
    const text = (code.textContent || '').trim()
    return /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|mindmap|timeline|quadrantChart|requirementDiagram|gitGraph|C4Context|zenuml|sankey-beta|block-beta|packet-beta|architecture-beta)\b/i.test(text)
  }

  const applyTransform = (state) => {
    state.svgEl.style.transform = 'translate(' + state.panX + 'px,' + state.panY + 'px) scale(' + state.scale + ')'
    state.zoomLabel.textContent = Math.round(state.scale * 100) + '%'
  }

  const enableDrag = (state) => {
    const fig = state.figure
    fig.style.cursor = 'grab'
    fig.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      state.dragging = true
      state.lastX = e.clientX
      state.lastY = e.clientY
      fig.style.cursor = 'grabbing'
      const onMove = (ev) => {
        if (!state.dragging) return
        state.panX += ev.clientX - state.lastX
        state.panY += ev.clientY - state.lastY
        state.lastX = ev.clientX
        state.lastY = ev.clientY
        applyTransform(state)
      }
      const onUp = () => {
        state.dragging = false
        fig.style.cursor = 'grab'
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
      const a = document.createElement('a')
      a.href = url
      a.download = 'mermaid-diagram.svg'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      later(() => { try { URL.revokeObjectURL(url) } catch (e) {} }, 1000)
    } catch (e) {
      console.error('[dsh-mermaid] export failed:', e && e.message ? e.message : String(e))
    }
  }

  const icons = {
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    zoomIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    zoomOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
  }

  const createToolbar = (state) => {
    const bar = document.createElement('div')
    bar.className = 'dsh-mmd-toolbar'

    const mkBtn = (svg, fn, label) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'dsh-mmd-btn'
      b.innerHTML = svg
      b.title = label
      b.setAttribute('aria-label', label)
      b.addEventListener('click', () => fn(b))
      return b
    }

    const toggleBtn = mkBtn(icons.code, (b) => {
      state.showSource = !state.showSource
      b.innerHTML = state.showSource ? icons.chart : icons.code
      b.title = state.showSource ? '查看图表' : '查看源码'
      b.setAttribute('aria-label', state.showSource ? '查看图表' : '查看源码')
      state.figure.style.display = state.showSource ? 'none' : ''
      state.srcEl.hidden = !state.showSource
    }, '查看源码')

    const zin = mkBtn(icons.zoomIn, () => { state.scale = Math.min(4, state.scale * 1.25); applyTransform(state) }, '放大')
    const zout = mkBtn(icons.zoomOut, () => { state.scale = Math.max(0.25, state.scale / 1.25); applyTransform(state) }, '缩小')
    const zreset = mkBtn(icons.reset, () => { state.scale = 1; state.panX = 0; state.panY = 0; applyTransform(state) }, '重置')
    const exportBtn = mkBtn(icons.download, () => exportSvg(state), '导出SVG')

    const zoomLabel = document.createElement('span')
    zoomLabel.className = 'dsh-mmd-zoom'
    zoomLabel.textContent = '100%'
    state.zoomLabel = zoomLabel

    bar.appendChild(toggleBtn)
    bar.appendChild(zin)
    bar.appendChild(zout)
    bar.appendChild(zreset)
    bar.appendChild(zoomLabel)
    bar.appendChild(exportBtn)
    return bar
  }

  const parseable = (text) => {
    try { mermaid.parse(text); return true } catch (e) { return false }
  }

  const cleanedVariants = (raw) => {
    const lines = raw.split('\n')
    const candidates = [
      lines.map((l) => l.replace(/^\s*\d+\s*/, '')).join('\n'),
      lines.map((l) => l.replace(/\s*\d+$/, '')).join('\n'),
    ]
    const seen = new Set([raw])
    const out = []
    for (const v of candidates) {
      if (v === raw || seen.has(v)) continue
      seen.add(v)
      out.push(v)
    }
    return out
  }

  const resolveText = (raw) => {
    if (parseable(raw)) return raw
    for (const v of cleanedVariants(raw)) {
      if (parseable(v)) return v
    }
    return null
  }

  const renderBlock = (code) => {
    const pre = code.parentElement
    if (!pre) return Promise.resolve()
    const raw = (code.textContent || '').trim()
    if (!raw) { code.setAttribute('data-dsh-mermaid', 'failed'); return Promise.resolve() }
    const text = resolveText(raw)
    if (text === null) {
      code.setAttribute('data-dsh-mermaid', 'failed')
      console.error('[dsh-mermaid] no parseable variant for code text:', JSON.stringify(raw))
      return Promise.resolve()
    }
    const id = 'dshmmd' + (++counter)
    return mermaid.render(id, text).then((out) => {
      if (disposed) return
      const svg = out && typeof out.svg === 'string' ? out.svg : ''
      if (!svg) { code.setAttribute('data-dsh-mermaid', 'failed'); return }
      if (!pre.isConnected) { code.setAttribute('data-dsh-mermaid', 'failed'); return }

      const wrap = document.createElement('div')
      wrap.className = 'dsh-mmd-wrap'
      wrap.setAttribute('data-dsh-mmd-rendered', '1')

      const figure = document.createElement('div')
      figure.className = 'dsh-mmd-figure'

      const svgEl = document.createElement('div')
      svgEl.className = 'dsh-mmd-svg'
      svgEl.innerHTML = svg

      figure.appendChild(svgEl)

      const srcEl = document.createElement('pre')
      srcEl.className = 'dsh-mmd-src'
      srcEl.hidden = true
      const codeEl = document.createElement('code')
      codeEl.setAttribute('data-dsh-mermaid', 'generated')
      codeEl.textContent = text
      srcEl.appendChild(codeEl)

      const state = { showSource: false, scale: 1, panX: 0, panY: 0, dragging: false, lastX: 0, lastY: 0, figure: figure, srcEl: srcEl, svgEl: svgEl, svg: svg, zoomLabel: null }
      const toolbar = createToolbar(state)
      enableDrag(state)

      wrap.appendChild(toolbar)
      wrap.appendChild(figure)
      wrap.appendChild(srcEl)

      const parent = pre.parentNode
      if (parent) {
        parent.replaceChild(wrap, pre)
        replacements.push({ parent: parent, pre: pre, wrap: wrap })
      }
    }).catch((err) => {
      if (disposed) return
      code.setAttribute('data-dsh-mermaid', 'failed')
      console.error('[dsh-mermaid] render failed:', err && err.message ? err.message : String(err), '| text:', JSON.stringify(text))
    })
  }

  const collectRoots = () => {
    const roots = []
    const seen = new Set()
    const push = (r) => { if (r && !seen.has(r)) { seen.add(r); roots.push(r) } }
    push(document)
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i]
      let all = []
      try { all = root.querySelectorAll('*') } catch (e) {}
      for (let j = 0; j < all.length; j++) {
        if (all[j].shadowRoot) push(all[j].shadowRoot)
      }
    }
    return roots
  }

  const findCodes = () => {
    const roots = collectRoots()
    const codes = []
    for (let i = 0; i < roots.length; i++) {
      let found = []
      try { found = roots[i].querySelectorAll('code') } catch (e) {}
      for (let j = 0; j < found.length; j++) codes.push(found[j])
    }
    return codes
  }

  const renderAll = () => {
    if (disposed) return
    const codes = findCodes()
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (!looksLikeMermaid(c)) continue
      if (c.hasAttribute('data-dsh-mermaid')) continue
      c.setAttribute('data-dsh-mermaid', 'pending')
      queue = queue.then(() => renderBlock(c))
    }
  }

  const resetStaleMarks = () => {
    const codes = findCodes()
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      const mark = c.getAttribute('data-dsh-mermaid')
      if (mark === 'pending' || mark === 'failed') {
        if (!insideRendered(c)) c.removeAttribute('data-dsh-mermaid')
      }
    }
  }

  if (timer && typeof timer.debounce === 'function') schedule = timer.debounce(renderAll, 200)
  else schedule = nativeDebounce(renderAll, 200)

  const observed = new Set()
  const attachObservers = () => {
    const roots = collectRoots()
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i]
      if (observed.has(root)) continue
      observed.add(root)
      if (typeof MutationObserver !== 'undefined') {
        try {
          const ob = new MutationObserver(() => { if (schedule) schedule() })
          ob.observe(root, { childList: true, subtree: true })
          observers.push(ob)
        } catch (e) {}
      }
    }
  }

  let dark = false
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) dark = true
    const html = document.documentElement
    if (html) {
      const t = html.getAttribute('data-theme') || html.getAttribute('data-color-mode')
      if (t) dark = /dark/i.test(t)
      else if (html.classList && html.classList.contains('dark')) dark = true
    }
  } catch (e) {}

  const lightVars = {
    primaryColor: '#dbeafe', primaryBorderColor: '#3b82f6', primaryTextColor: '#1e3a8a',
    secondaryColor: '#fef3c7', tertiaryColor: '#d1fae5',
    lineColor: '#8b5cf6', textColor: '#1f2937', mainBkg: '#ffffff',
    nodeBorder: '#6366f1', clusterBkg: '#f1f5f9', clusterBorder: '#94a3b8',
    titleColor: '#0f172a', edgeLabelBackground: '#ffffff'
  }
  const darkVars = {
    primaryColor: '#1e3a5f', primaryBorderColor: '#60a5fa', primaryTextColor: '#dbeafe',
    secondaryColor: '#7c5c1e', tertiaryColor: '#1e4035',
    lineColor: '#a78bfa', textColor: '#e5e7eb', mainBkg: '#0f172a',
    nodeBorder: '#818cf8', clusterBkg: '#1e293b', clusterBorder: '#475569',
    titleColor: '#f8fafc', edgeLabelBackground: '#0f172a'
  }

  try {
    mermaid.initialize({ startOnLoad: false, useMaxWidth: false, theme: 'base', themeVariables: dark ? darkVars : lightVars })
  } catch (e) {}

  const styleEl = document.createElement('style')
  styleEl.textContent =
    '.dsh-mmd-wrap{margin:8px 0;border:1px solid rgba(128,128,128,.25);border-radius:8px;overflow:hidden;background:rgba(127,127,127,.05)}' +
    '.dsh-mmd-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid rgba(128,128,128,.2)}' +
    '.dsh-mmd-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;font-size:12px;line-height:1;padding:5px;border:1px solid rgba(128,128,128,.35);border-radius:6px;background:transparent;cursor:pointer;color:inherit}' +
    '.dsh-mmd-btn svg{width:14px;height:14px;display:block}' +
    '.dsh-mmd-btn:hover{background:rgba(127,127,127,.15)}' +
    '.dsh-mmd-zoom{font-size:12px;opacity:.75;min-width:42px;text-align:center}' +
    '.dsh-mmd-figure{display:flex;align-items:center;justify-content:center;min-height:300px;overflow:hidden;max-width:100%;padding:12px;cursor:grab;user-select:none}' +
    '.dsh-mmd-svg{transform-origin:center center;transition:transform .05s linear}' +
    '.dsh-mmd-svg svg{max-width:none;display:block}' +
    '.dsh-mmd-src{margin:0;padding:12px;overflow:auto;font-size:12px;background:rgba(0,0,0,.04)}' +
    '.dsh-mmd-src code{white-space:pre}'
  document.head.appendChild(styleEl)

  attachObservers()
  resetStaleMarks()
  renderAll()

  ctx.effect(() => {
    return () => {
      disposed = true
      for (let i = 0; i < observers.length; i++) { try { observers[i].disconnect() } catch (e) {} }
      if (schedule && typeof schedule.dispose === 'function') { try { schedule.dispose() } catch (e) {} }
      if (styleEl.parentNode) { try { styleEl.parentNode.removeChild(styleEl) } catch (e) {} }
      for (let i = replacements.length - 1; i >= 0; i--) {
        const r = replacements[i]
        try {
          if (r.wrap && r.wrap.isConnected && r.parent && r.parent.isConnected) r.parent.replaceChild(r.pre, r.wrap)
        } catch (e) {}
      }
      replacements.length = 0
    }
  })
}

exports.apply = apply
