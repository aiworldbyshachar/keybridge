// Puts the real KeyBridge window into the scenes: in compositions/*.html, everything between
// <!-- ui:NAME --> and <!-- /ui --> is replaced with assets/ui/NAME.html (from tools/grab-ui.cjs),
// wrapped in its .kb box with the state's text direction and language.
//   node tools/inject-ui.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'compositions');
const ui = path.join(here, '..', 'assets', 'ui');

let count = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
  const full = path.join(dir, file);
  const before = fs.readFileSync(full, 'utf8');
  const after = before.replace(/<!-- ui:([a-z0-9-]+) -->[\s\S]*?<!-- \/ui -->/g, (_, name) => {
    const text = fs.readFileSync(path.join(ui, `${name}.html`), 'utf8');
    const [, meta, markup] = /^<!-- (\{.*?\}) -->\n([\s\S]*)$/.exec(text);
    const { dir: textDir, lang } = JSON.parse(meta);
    count++;
    return `<!-- ui:${name} --><div class="kb" dir="${textDir}" lang="${lang}">${markup.trim()}</div><!-- /ui -->`;
  });
  if (after !== before) fs.writeFileSync(full, after);
}
console.log(`inject-ui: ${count} window(s) placed`);
