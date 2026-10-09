import { readImage, type AssetFile, type ImageData } from './bridge';
import { assetFolder, encodeImagePath } from './document-paths';
import { imageReferences, localImagePath, rewriteImages } from './markdown-assets';

async function collectImages(source: string, documentPath: string | null, roots: string[]) {
  const images = new Map<string, ImageData>();
  let total = 0;
  for (const ref of imageReferences(source)) {
    const path = localImagePath(ref.destination);
    if (!path || images.has(ref.destination)) continue;
    if (!documentPath) throw new Error(`Save the document before resolving local images: ${path}`);
    const image = await readImage(documentPath, path, roots).catch(error => { throw new Error(`${path}: ${String(error)}`); });
    total += image.bytes.length;
    if (images.size >= 100 || total > 256 * 1024 * 1024) throw new Error('Images exceed the 100-file / 256 MiB export limit.');
    images.set(ref.destination, image);
  }
  return images;
}
export async function prepareDocumentCopy(source: string, documentPath: string | null, targetPath: string, roots: string[]) {
  const images = await collectImages(source, documentPath, roots);
  const replacements = new Map<string, string>();
  const assets: AssetFile[] = [];
  for (const [destination, image] of images) {
    const stem = image.name.replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}_-]/gu, '-').slice(0, 60) || 'image';
    const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/tiff': 'tiff', 'image/avif': 'avif' } as Record<string, string>)[image.mime];
    if (!extension) throw new Error(`Unsupported image: ${image.name}`);
    const relativePath = `${assetFolder(targetPath)}/${stem}-${crypto.randomUUID().slice(0, 12)}.${extension}`;
    replacements.set(destination, encodeImagePath(relativePath));
    assets.push({ relativePath, bytes: image.bytes });
  }
  return { source: rewriteImages(source, replacements), assets };
}
export async function embedDocumentImages(source: string, documentPath: string | null, roots: string[]): Promise<string> {
  const images = await collectImages(source, documentPath, roots);
  const replacements = new Map<string, string>();
  for (const [destination, image] of images) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([new Uint8Array(image.bytes)], { type: image.mime }));
    });
    replacements.set(destination, dataUrl);
  }
  return rewriteImages(source, replacements);
}
