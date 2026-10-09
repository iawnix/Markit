export const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path;
export function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (index === 0) return path[0];
  if (index === 2 && path[1] === ':') return path.slice(0, 3);
  return index < 0 ? '' : path.slice(0, index);
}
export function joinPath(directory: string, name: string): string {
  return `${directory.replace(/[\\/]$/, '')}${directory.includes('\\') ? '\\' : '/'}${name}`;
}
export const assetFolder = (path: string) => `${basename(path).replace(/\.[^.]+$/, '') || 'document'}.assets`;
export const isDocument = (path: string) => /\.(md|markdown|mdown|mkd|txt)$/i.test(path);
export const isImage = (path: string) => /\.(png|jpe?g|gif|webp|tiff?|avif)$/i.test(path);
export function relativePath(documentPath: string, target: string): string {
  const from = dirname(documentPath).replace(/\\/g, '/').split('/');
  const to = target.replace(/\\/g, '/').split('/');
  const windows = /^[a-z]:/i.test(documentPath);
  const equal = (a: string, b: string) => windows ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!equal(from[0], to[0])) throw new Error('Images on another drive must be copied into the document folder.');
  let shared = 0;
  while (shared < from.length && shared < to.length && equal(from[shared], to[shared])) shared++;
  return [...from.slice(shared).filter(Boolean).map(() => '..'), ...to.slice(shared)].join('/');
}
export function isInside(path: string, root: string): boolean {
  const normalize = (value: string) => {
    const normalized = value.replace(/\\/g, '/').replace(/\/$/, '');
    return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  return normalize(path) === normalize(root) || normalize(path).startsWith(`${normalize(root)}/`);
}
export const encodeImagePath = (path: string) => path.split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
