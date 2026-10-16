/**
 * dsh-mermaid checks that do not need a browser.
 *
 * Four groups:
 *   - manifest: the package still declares the new bundle + client contract
 *   - build artifact: client.js is the module-loader form the loader wants
 *   - sandbox rules: no bare timer globals, no fetch, no require
 *   - renderer logic: the decisions inside src/client.js, loaded through the
 *     same wrapper build.mjs uses (minus the vendored mermaid)
 *
 * Anything that needs a DOM lives in devtest/dom-check.mjs instead.
 *
 * Run: node devtest/run.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const rendererSource = readFileSync(join(root, 'src', 'client.js'), 'utf8')

let failures = 0
function check(label, fn) {
  try {
    fn()
    console.log(`  ok   ${label}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL ${label}`)
    console.log(`       ${error.message}`)
  }
}

/** Same, for the decisions that became async once `mermaid.parse` did. */
async function checkAsync(label, fn) {
  try {
    await fn()
    console.log(`  ok   ${label}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL ${label}`)
    console.log(`       ${error.message}`)
  }
}

// ---------------------------------------------------------------- 1. manifest
console.log('manifest')
check('declares a bundle patch', () => {
  const patch = manifest.dsh?.bundle?.patch
  assert.equal(typeof patch, 'string')
  assert.ok(existsSync(join(root, patch)), `${patch} does not exist`)
})
check('patch inserts exactly the package name', () => {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /- insert:\n\s+- id: dsh-mermaid\n\s+name: 'dsh-mermaid'/)
})
check('declares a web client half', () => {
  assert.equal(manifest.dsh?.client?.platform, 'web')
})
check('exports ./client', () => {
  assert.equal(manifest.exports?.['./client'], './client.js')
  assert.ok(existsSync(join(root, manifest.exports['./client'])))
})
check('exports the host half at the package root', () => {
  assert.equal(manifest.exports?.['.'], './index.js')
  assert.ok(existsSync(join(root, 'index.js')))
})
check('ships no dependency on any @deepseek-ai package', () => {
  const names = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {})
  ]
  assert.deepEqual(names, [])
})
check('the listed files cover every runtime artifact', () => {
  assert.deepEqual(manifest.files, [
    'index.js',
    'client.js',
    'cordis.patch.yml',
    'icon.svg',
    'locale/*.json'
  ])
})
check('icon and locale metadata parse', () => {
  assert.ok(existsSync(join(root, manifest.icon)))
  for (const language of ['en', 'zh']) {
    const meta = JSON.parse(readFileSync(join(root, 'locale', `${language}.json`), 'utf8'))
    assert.equal(typeof meta.meta.title, 'string')
    assert.equal(typeof meta.meta.description, 'string')
  }
})

// ------------------------------------------------------- 2. build artifact
console.log('\nbuild artifact')
const built = readFileSync(join(root, 'client.js'), 'utf8')
check('registers a module-loader factory', () => {
  assert.match(built, /^window\.__ModuleLoader__\.load\(\{/m)
})
check('the factory id equals the package name', () => {
  assert.match(built, new RegExp(`id: ${JSON.stringify(manifest.name)},`))
})
check('the factory returns the module exports', () => {
  assert.match(built, /return module\.exports;/)
  assert.match(built, /exports\.apply = apply/)
})
check('the shipped artifact carries no test-only surface', () => {
  assert.ok(!built.includes('__internals'), 'the @test-only block was not stripped')
})
check('the artifact parses', () => {
  new Function(built)
})

// ------------------------------------------------- 3. sandbox-safe source
console.log('\nclient sandbox rules')
const BARE_TIMERS = /(^|[^.\w$])(setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/
check('never calls a bare timer global (the sandbox shadows those)', () => {
  const offender = BARE_TIMERS.exec(rendererSource)
  assert.equal(offender, null, `found ${offender && offender[2]}( at offset ${offender && offender.index}`)
})
check('uses the qualified window timers instead', () => {
  assert.match(rendererSource, /window\.setTimeout/)
  assert.match(rendererSource, /window\.clearTimeout/)
})
check('never calls fetch', () => {
  assert.equal(/(^|[^.\w$])fetch\s*\(/.test(rendererSource), false)
})
check('never calls require', () => {
  assert.equal(/(^|[^.\w$])require\s*\(/.test(rendererSource), false)
})

// ------------------------------------------------------ 4. renderer logic
const factory = new Function(
  'console',
  `var module = { exports: {} }; var exports = module.exports;\n${rendererSource}\nreturn module.exports;`
)
const mod = factory(console)
const {
  isMermaidLabel,
  isMermaidSource,
  cleanedVariants,
  resolveSource,
  decideDark,
  lumaOf
} = mod.__internals

console.log('\nsource recognition')
check('exports apply', () => assert.equal(typeof mod.apply, 'function'))
check('accepts flowchart', () => assert.equal(isMermaidSource('flowchart LR\n  A --> B'), true))
check('accepts graph', () => assert.equal(isMermaidSource('graph TD'), true))
check('accepts sequenceDiagram', () => assert.equal(isMermaidSource('sequenceDiagram\n  A->>B: hi'), true))
check('accepts stateDiagram-v2', () => assert.equal(isMermaidSource('stateDiagram-v2'), true))
check('accepts a mermaid directive line', () => assert.equal(isMermaidSource('%%{init: {}}%%\nflowchart LR'), true))
check('rejects javascript', () => assert.equal(isMermaidSource('const graph = 1'), false))
check('rejects a comment that starts with a keyword', () =>
  assert.equal(isMermaidSource('// graph TD'), false)
)
check('does not confuse graphql with graph', () => assert.equal(isMermaidSource('graphql query'), false))
check('does not confuse a sentence with a keyword', () =>
  assert.equal(isMermaidSource('graphing the data'), false)
)
check('rejects empty input', () => assert.equal(isMermaidSource(''), false))

console.log('\nbanner label')
check('exact mermaid', () => assert.equal(isMermaidLabel('mermaid'), true))
check('case and padding', () => assert.equal(isMermaidLabel('  Mermaid '), true))
check('a rich info string', () => assert.equal(isMermaidLabel('mermaid title=Hi'), true))
check('another language', () => assert.equal(isMermaidLabel('javascript'), false))
check('absent label', () => assert.equal(isMermaidLabel(null), false))

console.log('\ntext recovery')
check('strips a leading line-number gutter', () => {
  assert.deepEqual(cleanedVariants('1 flowchart LR\n2 A --> B'), ['flowchart LR\nA --> B'])
})
check('strips a trailing line-number gutter', () => {
  assert.deepEqual(cleanedVariants('flowchart LR 1\nA --> B 2'), ['flowchart LR\nA --> B'])
})
check('offers no variant when nothing changes', () => {
  assert.deepEqual(cleanedVariants('flowchart LR'), [])
})
// `resolveSource` follows mermaid's own `parse`, which is async in 11.x. These
// await it; a sync caller would compare a Promise and silently pass everything.
await checkAsync('is async', async () => {
  assert.ok(resolveSource('flowchart LR', async () => true) instanceof Promise)
})
await checkAsync('keeps the first candidate that parses', async () => {
  const parse = async (text) => text === 'flowchart LR'
  assert.equal(await resolveSource('1 flowchart LR', parse), 'flowchart LR')
})
await checkAsync('waits for an async parse before trying the next candidate', async () => {
  const seen = []
  const parse = async (text) => {
    seen.push(text)
    return text === 'flowchart LR'
  }
  assert.equal(await resolveSource('1 flowchart LR', parse), 'flowchart LR')
  assert.deepEqual(seen, ['1 flowchart LR', 'flowchart LR'])
})
await checkAsync('returns null when nothing parses', async () => {
  assert.equal(await resolveSource('1 nope', async () => false), null)
})
await checkAsync('returns the input verbatim when it already parses', async () => {
  const raw = 'graph TD\n  A --> B'
  assert.equal(await resolveSource(raw, async (text) => text === raw), raw)
})

console.log('\ntheme resolution')
check('an explicit colorScheme wins', () =>
  assert.equal(decideDark({ colorScheme: 'light', darkThemeAttribute: true }), false)
)
check('the host dark attribute is authoritative when no scheme is set', () =>
  assert.equal(decideDark({ colorScheme: null, darkThemeAttribute: true, tokenLuma: 250 }), true)
)
check('a dark token background decides when nothing else is set', () =>
  assert.equal(decideDark({ colorScheme: null, darkThemeAttribute: false, tokenLuma: 21 }), true)
)
check('a light token background decides', () =>
  assert.equal(decideDark({ colorScheme: null, darkThemeAttribute: false, tokenLuma: 250 }), false)
)
check('an html theme attribute is the next fallback', () =>
  assert.equal(decideDark({ colorScheme: null, darkThemeAttribute: false, tokenLuma: null, themeAttribute: 'dark' }), true)
)
check('system preference is the last resort', () =>
  assert.equal(
    decideDark({
      colorScheme: null,
      darkThemeAttribute: false,
      tokenLuma: null,
      themeAttribute: null,
      prefersDark: true
    }),
    true
  )
)
check('defaults to light when nothing is known', () => assert.equal(decideDark({}), false))
check('parses rgb() luminance', () => assert.equal(Math.round(lumaOf('rgb(21, 21, 23)')), 21))
check('parses rgba() with spaces', () => assert.equal(Math.round(lumaOf('rgba(255, 255, 255, 0.9)')), 255))
check('rejects a value it cannot parse', () => assert.equal(lumaOf('var(--x)'), null))

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exitCode = failures === 0 ? 0 : 1
