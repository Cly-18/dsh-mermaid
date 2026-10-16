// Print windows around each occurrence of a needle in a file.
// Usage: node devtest/find.mjs <file> <needle> [before] [after] [max]
import fs from 'node:fs'

const [file, needle, before = '260', after = '320', max = '4'] = process.argv.slice(2)
const text = fs.readFileSync(file, 'utf8')
const b = Number(before)
const a = Number(after)
let index = -1
let n = 0
while ((index = text.indexOf(needle, index + 1)) !== -1 && n < Number(max)) {
  n += 1
  console.log(`--- ${file} :: "${needle}" #${n} at ${index} ---`)
  console.log(JSON.stringify(text.slice(Math.max(0, index - b), index + a)))
  console.log()
}
if (n === 0) console.log(`no occurrence of ${JSON.stringify(needle)} in ${file}`)
