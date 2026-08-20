/**
 * Downloads the bundled CJK fonts used for PDF embedding into public/fonts/.
 * Run once after clone: `npm run fonts`.
 * The app degrades gracefully (latin-only + preflight error) when fonts are absent.
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = path.resolve(import.meta.dirname, '..', 'public', 'fonts');

const FONTS = [
  {
    file: 'NotoSansSC-Regular.otf',
    urls: [
      'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf',
      'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf',
    ],
  },
  {
    file: 'NotoSerifSC-Regular.otf',
    urls: [
      'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf',
      'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf',
    ],
  },
];

async function exists(p) {
  try {
    const s = await stat(p);
    return s.size > 100_000;
  } catch {
    return false;
  }
}

await mkdir(OUT_DIR, { recursive: true });

for (const font of FONTS) {
  const target = path.join(OUT_DIR, font.file);
  if (await exists(target)) {
    console.log(`skip ${font.file} (already present)`);
    continue;
  }
  let saved = false;
  for (const url of font.urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(target, buf);
      console.log(`saved ${font.file} (${(buf.length / 1024 / 1024).toFixed(1)} MB) from ${url}`);
      saved = true;
      break;
    } catch (err) {
      console.warn(`failed ${url}: ${err.message}`);
    }
  }
  if (!saved) {
    console.error(
      `could not download ${font.file}. Place an OTF/TTF with CJK coverage at public/fonts/${font.file} manually.`,
    );
    process.exitCode = 1;
  }
}
