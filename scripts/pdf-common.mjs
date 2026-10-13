import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function pdfNames(source) {
  const pdf = source.replace(/\.md$/i, '.pdf');
  const stem = pdf.slice(0, -4).replaceAll('/', '__');
  const safe = stem.replace(/[^A-Za-z\d_.-]+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '') || 'document';
  // GitHub rewrites Unicode/special filenames. Labels and ZIP entries keep Chinese.
  const suffix = safe === stem ? '' : `-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`;
  return { source, pdf, asset: `${safe}${suffix}.pdf` };
}

export function checkAssetNames(documents) {
  const names = new Set(['antenna-course-pdfs.zip']);
  for (const { asset } of documents) {
    if (names.has(asset)) throw new Error(`Release attachment name collision: ${asset}`);
    names.add(asset);
  }
}

export function normalizeCjkEmphasis(markdown) {
  // CommonMark cannot close bold after punctuation immediately before a CJK word.
  // Add the separating space in the printable copy, preserving code and math.
  let fence = null;
  return markdown.split('\n').map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return line;
    }
    if (fence) return line;
    return line.split(/(`+[^`]*`+)/).map((part, index) => index % 2 ? part : part.replace(/\*\*([^*\n]*[，。；：！？、）》」』】])\*\*(?=[\p{L}\p{N}])/gu, '**$1** ')).join('');
  }).join('\n');
}

export function githubMarkdownLink(href, source, repository, sha) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return href;
  const suffixIndex = href.search(/[?#]/);
  const pathname = suffixIndex < 0 ? href : href.slice(0, suffixIndex);
  const suffix = suffixIndex < 0 ? '' : href.slice(suffixIndex);
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return href; }
  if (!/\.md$/i.test(decoded)) return href;
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(source), decoded));
  if (relative.startsWith('../') || path.posix.isAbsolute(relative)) return href;
  return `https://github.com/${repository}/blob/${sha}/${relative.split('/').map(encodeURIComponent).join('/')}${suffix}`;
}

export function validateManifest(manifest, sha, repository) {
  if (manifest.sha !== sha || manifest.repository !== repository) {
    throw new Error('PDF manifest does not match the requested commit and repository');
  }
  if (!Array.isArray(manifest.documents) || manifest.documents.length === 0) {
    throw new Error('PDF manifest contains no documents');
  }
  checkAssetNames(manifest.documents);
  const expected = new Set(manifest.documents.map(({ asset }) => asset));
  expected.add('antenna-course-pdfs.zip');
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== expected.size) {
    throw new Error('PDF manifest contains an incomplete asset list');
  }
  for (const asset of manifest.assets) {
    if (!expected.delete(asset.name) || path.basename(asset.name) !== asset.name ||
        asset.size <= 0 || !/^[a-f\d]{64}$/.test(asset.sha256)) {
      throw new Error(`Invalid PDF manifest asset: ${asset.name}`);
    }
  }
  return manifest;
}

export function verifyRemoteAssets(manifest, remote) {
  if (remote.length !== manifest.assets.length) throw new Error('Release asset count does not match the PDF manifest');
  for (const expected of manifest.assets) {
    const actual = remote.find(({ name }) => name === expected.name);
    if (!actual || actual.state !== 'uploaded' || actual.size !== expected.size ||
        actual.digest !== `sha256:${expected.sha256}`) {
      throw new Error(`Incomplete or mismatched Release attachment: ${expected.name}`);
    }
  }
}

export function publishedManifest(body, current) {
  const encoded = body?.match(/<!-- pdf-manifest:([A-Za-z\d+/=]+) -->/)?.[1];
  if (!encoded) throw new Error('Published Release is missing its PDF manifest');
  const original = validateManifest(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')), current.sha, current.repository);
  const names = manifest => manifest.assets.map(({ name }) => name).sort();
  if (JSON.stringify(names(original)) !== JSON.stringify(names(current))) {
    throw new Error('Published Release has a different document list');
  }
  return original;
}

export async function describeAsset(filename) {
  const data = await readFile(filename);
  return { name: path.basename(filename), size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}
