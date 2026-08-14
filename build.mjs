// Build lib/client.js from vendor/mermaid.min.js + src/client.js.
// Run with: node build.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const mermaidPath = join(root, 'vendor', 'mermaid.min.js')
const srcPath = join(root, 'src', 'client.js')
const outPath = join(root, 'lib', 'client.js')

if (!existsSync(mermaidPath)) {
  console.error('vendor/mermaid.min.js not found. Download mermaid dist first.')
  process.exit(1)
}

const mermaid = readFileSync(mermaidPath, 'utf8')
const renderer = readFileSync(srcPath, 'utf8')

const bundle = [
  'window.__ModuleLoader__.load({',
  '\tid: "dsh-mermaid",',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  mermaid,
  renderer,
  '\t\treturn module.exports;',
  '\t}',
  '});',
  ''
].join('\n')

writeFileSync(outPath, bundle)
console.log('built lib/client.js:', bundle.length, 'chars')
