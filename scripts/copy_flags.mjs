// Copies the 4:3 SVG flag of every country in public/data/countries.json from flag-icons (MIT) into
// public/flags/<ISO2>.svg, with the package license next to them.
// Usage: node scripts/copy_flags.mjs  (after npm install and npm run data)
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'

const src = 'node_modules/flag-icons'
const out = 'public/flags'
const countries = JSON.parse(readFileSync('public/data/countries.json', 'utf8'))

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const missing = []
let copied = 0
for (const c of Object.values(countries)) {
  if (!c.iso2) continue
  const file = `${src}/flags/4x3/${c.iso2.toLowerCase()}.svg`
  if (existsSync(file)) {
    copyFileSync(file, `${out}/${c.iso2}.svg`)
    copied++
  } else missing.push(`${c.id} (${c.iso2})`)
}
copyFileSync(`${src}/LICENSE`, `${out}/LICENSE`)
console.log(`flags: ${copied} copied${missing.length ? `, missing: ${missing.join(', ')}` : ''}`)
