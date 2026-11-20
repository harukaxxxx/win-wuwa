import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {buildAssets} from 'who-is-next/build-assets';

const theme = JSON.parse(await readFile(new URL('../theme/theme.json', import.meta.url), 'utf8'));
await buildAssets({
  outputDir: fileURLToPath(new URL('../.generated/public/', import.meta.url)),
  name: theme.name,
  eyebrow: theme.eyebrow,
  stylesheet: new URL('../theme/theme.css', import.meta.url)
});
