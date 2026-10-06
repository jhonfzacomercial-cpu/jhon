// Junta o build da versão hospedada num único arquivo HTML (sem <html>/<head>/<body>,
// que o claude.ai acrescenta ao publicar).
import fs from 'node:fs';
import path from 'node:path';

const dir = 'dist-artifact';
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const ler = (href) => fs.readFileSync(path.join(dir, href.replace(/^\.\//, '')), 'utf8');
const logo = `data:image/png;base64,${fs.readFileSync('public/logo-fza-mask.png').toString('base64')}`;
const css0 = [...html.matchAll(/<link rel="stylesheet"[^>]*href="(\.\/assets\/[^"]+\.css)"[^>]*>/g)].map((m) => ler(m[1])).join('\n');
const css = css0.replace(/url\((\.{0,2}\/)?logo-fza-mask\.png\)/g, `url(${logo})`);
const js = [...html.matchAll(/<script type="module"[^>]*src="(\.\/assets\/[^"]+\.js)"[^>]*><\/script>/g)].map((m) => ler(m[1])).join('\n');
const fontes = html.match(/<link rel="preconnect"[\s\S]*?display=swap">/)?.[0] || '';

const saida = `<title>FZA Gestão</title>
${fontes}
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js.replace(/<\/script/gi, '<\\/script')}
</script>
`;
fs.writeFileSync(path.join(dir, 'fza-gestao.html'), saida);
console.log(`fza-gestao.html: ${(saida.length / 1024 / 1024).toFixed(2)} MB`);
