import { execFile as execFileCallback } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { checkAssetNames, describeAsset, githubMarkdownLink, normalizeCjkEmphasis, pdfNames } from './pdf-common.mjs';

const execFile = promisify(execFileCallback);
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = path.join(root, 'dist');
const pandoc = process.env.PANDOC_PATH || 'pandoc';
const git = async (...args) => (await execFile('git', args, { cwd: root })).stdout.trim();
const sha = process.env.GITHUB_SHA || await git('rev-parse', 'HEAD');
const remote = await git('remote', 'get-url', 'origin');
const repository = process.env.GITHUB_REPOSITORY || remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
if (!/^[a-f\d]{40}$/.test(sha) || !/^[\w.-]+\/[\w.-]+$/.test(repository || '')) {
  throw new Error('Set GITHUB_REPOSITORY to owner/repository and GITHUB_SHA to a full commit SHA');
}
const extensions = (await execFile(pandoc, ['--list-extensions=gfm'])).stdout;
if (!extensions.includes('tex_math_gfm')) throw new Error('Pandoc with tex_math_gfm support is required; use Pandoc 3.8.3');
const tracked = (await execFile('git', ['ls-files', '-z'], { cwd: root })).stdout;
const documents = tracked.split('\0').filter(name => /\.md$/i.test(name)).sort().map(pdfNames);
if (documents.length === 0) throw new Error('No tracked Markdown files found');
checkAssetNames(documents);

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'pdf'), { recursive: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
await mkdir(path.join(output, 'html'), { recursive: true });
const css = await readFile(new URL('./pdf.css', import.meta.url), 'utf8');
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const mimeTypes = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.js': 'text/javascript', '.woff': 'font/woff', '.woff2': 'font/woff2', '.css': 'text/css', '.html': 'text/html; charset=utf-8' };
const mathjaxRoot = path.join(root, 'node_modules', 'mathjax', 'es5');
const pages = new Map();
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pages.has(pathname)) {
      response.writeHead(200, { 'Content-Type': mimeTypes['.html'] });
      response.end(pages.get(pathname));
      return;
    }
    const mathjax = pathname.startsWith('/__pdf_mathjax/');
    const directory = mathjax ? mathjaxRoot : root;
    const relative = mathjax ? pathname.slice('/__pdf_mathjax/'.length) : pathname.slice(1);
    const filename = path.resolve(directory, relative);
    if (!filename.startsWith(`${directory}${path.sep}`) || (!mathjax && /(^|\/)(?:\.git|node_modules)(\/|$)/.test(relative))) {
      response.writeHead(403).end();
      return;
    }
    const data = await readFile(filename);
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filename)] || 'application/octet-stream' });
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  page.setDefaultTimeout(60_000);
  await page.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  for (const document of documents) {
    const { source, pdf, asset } = document;
    console.log(`Converting ${source}`);
    const conversion = execFile(pandoc, ['--from=gfm+tex_math_gfm+tex_math_dollars', '--to=html5', '--mathjax', '--wrap=none'], { maxBuffer: 20 * 1024 * 1024 });
    conversion.child.stdin.end(normalizeCjkEmphasis(await readFile(path.join(root, source), 'utf8')));
    const { stdout: fragment } = await conversion;
    const directory = path.posix.dirname(source);
    const base = `${origin}/${directory === '.' ? '' : `${directory.split('/').map(encodeURIComponent).join('/')}/`}`;
    const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${escapeHtml(source)}</title><base href="${base}"><style>${css}</style>
      <script>window.pdfMathErrors = []; window.MathJax = { startup: { typeset: false }, tex: { packages: { '[-]': ['noundefined'] }, inlineMath: [['\\\\(', '\\\\)']], displayMath: [['\\\\[', '\\\\]']], formatError: (jax, error) => { window.pdfMathErrors.push(error.message); return jax.formatError(error); } } };</script>
      <script defer src="${origin}/__pdf_mathjax/tex-chtml.js"></script></head><body><main>${fragment}</main></body></html>`;
    await writeFile(path.join(output, 'html', asset.replace(/\.pdf$/, '.html')), html);
    const pagePath = `/__pdf_documents/${source}.html`;
    pages.set(pagePath, html);
    await page.goto(`${origin}${pagePath.split('/').map(encodeURIComponent).join('/')}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MathJax?.startup?.promise);
    document.mathCount = await page.evaluate(async () => {
      await window.MathJax.startup.promise;
      const count = document.querySelectorAll('.math').length;
      await window.MathJax.typesetPromise();
      if (window.pdfMathErrors.length) throw new Error(`MathJax error: ${window.pdfMathErrors.join('; ')}`);
      const errors = [...document.querySelectorAll('mjx-merror, [data-mjx-error]')];
      if (errors.length) throw new Error(`MathJax error: ${errors.map(node => node.getAttribute('data-mjx-error') || node.textContent).join('; ')}`);
      if (document.querySelectorAll('mjx-container').length !== count) throw new Error('Not all math expressions were typeset');
      await document.fonts.ready;
      // A live GitHub CI badge is status UI; preserve its label and link in print.
      for (const image of document.images) {
        if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/workflows\/[^/]+\/badge\.svg(?:\?|$)/.test(image.getAttribute('src') || '')) {
          image.replaceWith(document.createTextNode(image.alt));
        }
      }
      await Promise.all([...document.images].map(async image => {
        try { await image.decode(); } catch { throw new Error(`Cannot decode image: ${image.getAttribute('src')}`); }
        if (!image.naturalWidth) throw new Error(`Missing image: ${image.getAttribute('src')}`);
      }));
      // Scale individual long formulas to the available width before printing.
      for (const formula of document.querySelectorAll('.math')) {
        const container = formula.querySelector('mjx-container');
        const math = container?.querySelector('mjx-math');
        if (!math) continue;
        const parent = formula.closest('td, th') || document.querySelector('main');
        const style = getComputedStyle(parent);
        const available = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const width = math.getBoundingClientRect().width;
        if (width > available) container.style.fontSize = `${Math.floor(available / width * 100)}%`;
      }
      return count;
    });
    const links = await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
    const rewritten = links.map(href => githubMarkdownLink(href, source, repository, sha));
    await page.locator('a[href]').evaluateAll((nodes, hrefs) => nodes.forEach((node, index) => node.setAttribute('href', hrefs[index])), rewritten);
    await page.evaluate(() => document.fonts.ready);
    const filename = path.join(output, 'pdf', pdf);
    await mkdir(path.dirname(filename), { recursive: true });
    await page.pdf({ path: filename, format: 'A4', preferCSSPageSize: true, printBackground: true, tagged: true, outline: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
    const data = await readFile(filename);
    if (data.length === 0 || !data.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error(`Invalid PDF: ${pdf}`);
    await copyFile(filename, path.join(output, 'assets', asset));
    await writeFile(path.join(output, 'html', asset.replace(/\.pdf$/, '.html')), await page.content());
    pages.delete(pagePath);
  }
  await execFile('python3', ['-c', `import pathlib, sys, zipfile
root = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as archive:
    for pdf in sorted(root.rglob('*.pdf')):
        archive.write(pdf, pdf.relative_to(root).as_posix())
`, path.join(output, 'pdf'), path.join(output, 'assets', 'antenna-course-pdfs.zip')]);
  const assets = await Promise.all([...documents.map(({ asset }) => asset), 'antenna-course-pdfs.zip'].map(name => describeAsset(path.join(output, 'assets', name))));
  const manifest = { sha, repository, documents, assets };
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built ${documents.length} PDFs (${documents.reduce((sum, document) => sum + document.mathCount, 0)} math expressions) and antenna-course-pdfs.zip`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
