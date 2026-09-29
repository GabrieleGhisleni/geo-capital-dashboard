// Copies the woff2 subsets used for map labels (Manrope)
// into public/fonts/map and writes src/mapFonts.json: MapLibre `font-faces` entries per font stack.
// Usage: node scripts/copy_map_fonts.mjs  (after npm install)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const out = 'public/fonts/map'
const stacks = {
  'Manrope Medium': ['manrope', 500],
  'Manrope Bold': ['manrope', 700],
}

mkdirSync(out, { recursive: true })
const faces = {}
for (const [name, [family, weight]] of Object.entries(stacks)) {
  const src = `node_modules/@fontsource/${family}`
  const css = readFileSync(`${src}/${weight}.css`, 'utf8')
  faces[name] = [...css.matchAll(/url\(\.\/files\/([^)]+\.woff2)\)[^;]*;\s*unicode-range: ([^;]+);/g)].map(([, file, ranges]) => {
    copyFileSync(`${src}/files/${file}`, `${out}/${file}`)
    return { file, 'unicode-range': ranges.split(',').map((r) => r.trim()) }
  })
}
writeFileSync('src/mapFonts.json', JSON.stringify(faces, null, 2) + '\n')
console.log(Object.fromEntries(Object.entries(faces).map(([k, v]) => [k, v.length])))
