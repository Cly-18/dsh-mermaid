/**
 * Does the plugin's block detector accept the markup DSH 0.2.0-rc.2 actually
 * renders for a ```mermaid fence in a chat message?
 *
 * The predicates under test are loaded from `src/client.js` — the shipped ones,
 * not a paraphrase — through the same module wrapper `build.mjs` uses. Only the
 * mermaid library is left out; the detector never touches it.
 *
 * The markup below is transcribed from the shipped renderer:
 *   dsh-web-frontend/dist/assets/index-*.js  → component `_8` + CodeCard header `$c`
 *   dsh-client-ui-chat/lib/client.js         → markdownLabels() always supplies toolbarLabels
 *   dsh-client-locale/lib/client.js          → "codeBlock.title": "代码块" / "Code block"
 *
 * Run: node devtest/dom-check.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'src', 'client.js'), 'utf8')
const factory = new Function(
  'console',
  `var module = { exports: {} }; var exports = module.exports;\n${source}\nreturn module.exports;`
)
const { readBlockLabel, looksLikeMermaid } = factory(console).__internals

// ---------------------------------------------------------------- fake DOM
// Enough of Element for the detector: attributes, class names, `textContent`,
// `firstElementChild`, `closest` and `querySelector`. `closest`/`querySelector`
// understand the selector forms the detector uses ([attr], [attr="v"], .class,
// tag, and comma-separated alternatives) so no per-fixture stubbing is needed.

function matches(node, selector) {
  return selector.split(',').some((part) => {
    const token = part.trim()
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(token)
    if (attr) {
      return attr[2] === undefined
        ? node.hasAttribute(attr[1])
        : node.getAttribute(attr[1]) === attr[2]
    }
    const cls = /^\.([\w-]+)$/.exec(token)
    if (cls) return String(node.className || '').split(/\s+/).includes(cls[1])
    return node.tagName === token.toLowerCase()
  })
}

function el(tag, { className = '', text = '', children = [], attrs = {} } = {}) {
  const node = {
    tagName: tag,
    className,
    parentElement: null,
    children,
    _attrs: { ...attrs },
    hasAttribute: (name) => name in node._attrs,
    getAttribute: (name) => (name in node._attrs ? node._attrs[name] : null),
    setAttribute: (name, value) => {
      node._attrs[name] = String(value)
    },
    removeAttribute: (name) => {
      delete node._attrs[name]
    },
    closest(selector) {
      let current = node
      while (current) {
        if (matches(current, selector)) return current
        current = current.parentElement
      }
      return null
    },
    querySelector(selector) {
      for (const child of node.children) {
        if (matches(child, selector)) return child
        const hit = child.querySelector(selector)
        if (hit) return hit
      }
      return null
    }
  }
  Object.defineProperty(node, 'textContent', {
    // The real traversal: own text plus every descendant's.
    get: () => text + node.children.map((child) => child.textContent).join('')
  })
  Object.defineProperty(node, 'firstElementChild', {
    get: () => node.children[0] ?? null
  })
  for (const child of children) child.parentElement = node
  return node
}

/**
 * The real chat DOM for one fence:
 *
 * <div class="_block_7gxqk_4 md-code-block">                       ← block
 *   <div class="_bannerWrap_7gxqk_24">                             ← bannerWrap
 *     <div class="_header_1pq26_12" data-code-block-banner="true">  ← CodeCard header
 *       <div class="_heading_1pq26_?">
 *         <span class="_language_1pq26_?">代码块</span>             ← !isKnownLang('mermaid')
 *         [<span class="_title_…">…</span>]                        ← only when the fence has a title
 *       </div>
 *     </div>
 *   </div>
 *   <div class="_content_7gxqk_74" data-code-block-content="true">  ← content
 *     <pre class="_plain_7gxqk_103"><code>flowchart LR…</code></pre>
 *   </div>
 * </div>
 */
function chatDom({ label = '代码块', title = undefined, source = 'flowchart LR\n  A --> B' } = {}) {
  const code = el('code', { text: source })
  const pre = el('pre', { className: '_plain_7gxqk_103', children: [code] })
  const content = el('div', {
    className: '_content_7gxqk_74',
    attrs: { 'data-code-block-content': 'true' },
    children: [pre]
  })
  const heading = el('div', {
    className: '_heading_1pq26_7',
    children: [
      el('span', { className: '_language_1pq26_18', text: label }),
      ...(title === undefined ? [] : [el('span', { className: '_title_1pq26_21', text: title })])
    ]
  })
  const block = el('div', {
    className: '_block_7gxqk_4 md-code-block',
    children: [
      el('div', {
        className: '_bannerWrap_7gxqk_24',
        children: [
          el('div', {
            className: '_header_1pq26_12',
            attrs: { 'data-code-block-banner': 'true' },
            children: [heading]
          })
        ]
      }),
      content
    ]
  })
  return { block, content, pre, code }
}

/**
 * The simple-banner variant (`rn.banner` + `rn.infostring`), only reached when
 * `toolbarLabels` is undefined. The chat markdown renderer always supplies
 * labels, so this fixture exists to prove the older shape still works.
 */
function simpleBannerDom({ label = 'mermaid', source = 'flowchart LR\n  A --> B' } = {}) {
  const code = el('code', { text: source })
  const pre = el('pre', { className: '_plain_7gxqk_103', children: [code] })
  const block = el('div', {
    className: '_block_7gxqk_4 md-code-block',
    children: [
      el('div', {
        className: '_banner_7gxqk_24',
        attrs: { 'data-code-block-banner': 'true' },
        children: [el('div', { className: '_infostring_7gxqk_45', text: label })]
      }),
      el('div', {
        className: '_content_7gxqk_74',
        attrs: { 'data-code-block-content': 'true' },
        children: [pre]
      })
    ]
  })
  return { block, pre, code }
}

/** A fence with no banner at all — the source heuristic must carry it. */
function bareDom({ source = 'flowchart LR\n  A --> B' } = {}) {
  const code = el('code', { text: source })
  const pre = el('pre', { className: '_plain_7gxqk_103', children: [code] })
  el('div', {
    className: '_content_7gxqk_74',
    attrs: { 'data-code-block-content': 'true' },
    children: [pre]
  })
  return { pre, code }
}

/**
 * The rule as it shipped before the fix, kept only to show the regression it
 * caused. Nothing here asserts on it beyond documenting the old behaviour.
 */
const legacyLooksLikeMermaid = (pre, code) => {
  if (!pre || !code) return false
  if (pre.hasAttribute('data-dsh-mermaid')) return false
  const classes = String(code.className || '') + ' ' + String(pre.className || '')
  if (/\bmermaid\b/i.test(classes)) return true
  const label = readBlockLabel(pre)
  if (label !== null && label.trim() !== '') return label.trim().toLowerCase() === 'mermaid'
  return /^(?:flowchart|graph|sequenceDiagram|stateDiagram-v2)\b/.test(code.textContent.trim())
}

// ------------------------------------------------------------------ checks
let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

console.log('regression exhibit: the pre-fix rule on the real chat markup')
{
  const { pre, code } = chatDom()
  check('legacy rule: label "代码块" vetoes a mermaid block', legacyLooksLikeMermaid(pre, code), false)
}

console.log('\nthe shipped rule: real chat markup (CodeCard header + localized generic label)')
for (const label of ['代码块', 'Code block']) {
  const { pre, code } = chatDom({ label })
  check(`label ${JSON.stringify(label)} → readBlockLabel`, readBlockLabel(pre), label)
  check(`label ${JSON.stringify(label)} → detector`, looksLikeMermaid(pre, code), true)
}
{
  const { pre, code } = chatDom({ label: '代码块' })
  check('generic label + mermaid-looking source → rendered', looksLikeMermaid(pre, code), true)
}

console.log('\nthe label must stay a veto when it really names a language')
{
  const { pre, code } = chatDom({ label: 'python', source: 'flowchart LR\n  A --> B' })
  check('label "python" over a mermaid-looking source stays vetoed', looksLikeMermaid(pre, code), false)
}
{
  const { pre, code } = chatDom({ label: 'javascript', source: 'graph TD' })
  check('label "javascript" over a keyword source stays vetoed', looksLikeMermaid(pre, code), false)
}
{
  const { pre, code } = chatDom({ label: 'text', source: 'graph TD' })
  check('label "text" over a keyword source stays vetoed', looksLikeMermaid(pre, code), false)
}
{
  const { pre, code } = chatDom({ label: 'mermaid' })
  check('label "mermaid" → rendered', looksLikeMermaid(pre, code), true)
}

console.log('\nreading the label: the language span only')
{
  const { pre } = chatDom({ label: '代码块', title: 'My diagram' })
  check('a titled block does not splice the title into the label', readBlockLabel(pre), '代码块')
}
{
  const { pre } = chatDom({ label: 'mermaid', title: 'My diagram' })
  check('a titled mermaid block still reads as mermaid', readBlockLabel(pre), 'mermaid')
}

console.log('\nfor reference: the simple-banner variant the plugin was written against')
{
  const { pre, code } = simpleBannerDom({})
  check('simple banner "mermaid" → label', readBlockLabel(pre), 'mermaid')
  check('simple banner "mermaid" → rendered', looksLikeMermaid(pre, code), true)
}
{
  const { pre, code } = simpleBannerDom({ label: 'python', source: 'flowchart LR' })
  check('simple banner "python" → vetoed', looksLikeMermaid(pre, code), false)
}

console.log('\nno banner: the source heuristic carries it')
{
  const { pre, code } = bareDom()
  check('bare block starting with mermaid keyword → rendered', looksLikeMermaid(pre, code), true)
}
{
  const { pre, code } = bareDom({ source: 'const graph = 1' })
  check('bare block that is plain code → skipped', looksLikeMermaid(pre, code), false)
}

console.log('\nskip rules')
{
  const { pre, code } = chatDom()
  check('an unmarked block is eligible', looksLikeMermaid(pre, code), true)
  pre.setAttribute('data-dsh-mermaid', 'pending')
  check('an already-marked block is skipped', looksLikeMermaid(pre, code), false)
}
console.log('\na failed block retires as soon as its text moves (streaming recovery)')
{
  const { pre, code } = chatDom({ source: 'flowchart TD\n  A -->' })
  pre.setAttribute('data-dsh-mermaid', 'failed')
  pre.setAttribute('data-dsh-mermaid-failed-text', 'flowchart TD\n  A -->')
  check('a failed block with unchanged text stays skipped', looksLikeMermaid(pre, code), false)
  check('the mark survives that decision', pre.getAttribute('data-dsh-mermaid'), 'failed')
}
{
  const { pre, code } = chatDom({ source: 'flowchart TD\n  A --> B' })
  pre.setAttribute('data-dsh-mermaid', 'failed')
  pre.setAttribute('data-dsh-mermaid-failed-text', 'flowchart TD\n  A -->')
  check('a failed block whose text grew is retried', looksLikeMermaid(pre, code), true)
  check('its failed mark is cleared', pre.hasAttribute('data-dsh-mermaid'), false)
  check('its failed-text mark is cleared', pre.hasAttribute('data-dsh-mermaid-failed-text'), false)
}
{
  const { pre, code } = chatDom({ source: 'flowchart TD\n  A --> B' })
  pre.setAttribute('data-dsh-mermaid', 'failed')
  check('a failed block with no recorded text is retried', looksLikeMermaid(pre, code), true)
}
{
  const { pre, code } = chatDom({ source: 'flowchart TD\n  A --> B' })
  pre.setAttribute('data-dsh-mermaid', 'pending')
  pre.setAttribute('data-dsh-mermaid-failed-text', 'flowchart TD\n  A --> B')
  check('a pending block is never re-queued by the recovery path', looksLikeMermaid(pre, code), false)
}
{
  const { pre, code } = chatDom({ source: 'const graph = 1' })
  pre.setAttribute('data-dsh-mermaid', 'failed')
  pre.setAttribute('data-dsh-mermaid-failed-text', 'flowchart TD\n  A -->')
  check('a retried block must still look like mermaid', looksLikeMermaid(pre, code), false)
}
{
  const { pre, code } = chatDom({ label: 'python' })
  const inner = pre.children[0]
  inner.className = 'language-mermaid'
  check('a class naming mermaid wins over the label', looksLikeMermaid(pre, code), true)
}
{
  // A block already swapped for our own wrapper: `pre` is no longer inside the
  // host's content node, so `readBlockLabel` has nothing to read either.
  const wrap = el('div', { className: 'dsh-mmd-wrap', attrs: { 'data-dsh-mmd-rendered': '1' } })
  const code = el('code', { text: 'flowchart LR\n  A --> B' })
  const pre = el('pre', { children: [code] })
  wrap.children = [pre]
  pre.parentElement = wrap
  check('a block inside our own wrapper is skipped', looksLikeMermaid(pre, code), false)
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exitCode = failures === 0 ? 0 : 1
