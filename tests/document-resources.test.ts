import { describe, expect, it, vi } from 'vitest';
import { assetFolder, dirname, encodeImagePath, isInside, joinPath, relativePath } from '../apps/desktop/src/document-paths';
import { imageReferences, localImagePath, rewriteImages } from '../apps/desktop/src/markdown-assets';
const { readImage } = vi.hoisted(() => ({ readImage: vi.fn() }));
vi.mock('../apps/desktop/src/bridge', () => ({ readImage }));
import { prepareDocumentCopy } from '../apps/desktop/src/document-resources';

describe('portable document resources', () => {
  it('uses document-relative paths across POSIX and Windows roots', () => {
    expect(dirname('/note.md')).toBe('/');
    expect(dirname('C:\\note.md')).toBe('C:\\');
    expect(joinPath('/', 'Untitled.md')).toBe('/Untitled.md');
    expect(joinPath('C:\\', 'Untitled.md')).toBe('C:\\Untitled.md');
    expect(relativePath('/project/docs/note.md', '/project/assets/a.png')).toBe('../assets/a.png');
    expect(relativePath('C:\\project\\docs\\note.md', 'c:\\project\\assets\\a.png')).toBe('../assets/a.png');
    expect(() => relativePath('C:\\note.md', 'D:\\a.png')).toThrow('another drive');
    expect(assetFolder('/notes/旅行笔记.md')).toBe('旅行笔记.assets');
    expect(isInside('/project-other/a.md', '/project')).toBe(false);
  });
  it('encodes each path segment without losing literal URL characters', () => {
    const original = '../旅行笔记.assets/图 #?%(1).png';
    expect(localImagePath(encodeImagePath(original))).toBe(original);
    expect(localImagePath('image.png?width=2#fragment')).toBe('image.png');
    expect(localImagePath('https://example.com/a.png')).toBeNull();
    expect(localImagePath('file:///tmp/a%20b.png')).toBe('/tmp/a b.png');
    expect(localImagePath('file:///C:/notes/a.png')).toBe('C:/notes/a.png');
  });
  it('finds inline and reference images, excluding code examples', () => {
    const source = '![a](folder/a(b).png "title")\n\n![diagram][pic]\n![pic][]\n![pic]\n\n[pic]: <图 b.png> "Caption"\n\n`![code](bad.png)`\n\n```md\n![example](bad.png)\n```\n';
    expect(imageReferences(source).map(ref => ref.destination)).toEqual(['folder/a(b).png', '图 b.png', '图 b.png', '图 b.png']);
    const rewritten = rewriteImages(source, new Map([['图 b.png', 'copy.assets/b.png']]));
    expect(rewritten).toContain('![diagram](<copy.assets/b.png> "Caption")');
    expect(rewritten).toContain('[pic]: <图 b.png> "Caption"');
    expect(rewritten).toContain('`![code](bad.png)`');
    expect(rewritten).toContain('![a](folder/a(b).png "title")');
  });
  it('copies repeated image references once while preserving unrelated Markdown', async () => {
    readImage.mockResolvedValue({ name: '图.png', bytes: [1, 2, 3], mime: 'image/png' });
    const source = '# 原稿\n\n![a](../assets/图.png)\n![b](../assets/图.png)\n[link](other.md)\n';
    const copy = await prepareDocumentCopy(source, '/project/docs/note.md', '/other/副本.md', ['/project']);
    expect(copy.assets).toHaveLength(1);
    expect(copy.assets[0].relativePath).toMatch(/^副本.assets\/图-[a-f\d-]+.png$/);
    expect(copy.source).toContain('[link](other.md)');
    expect(copy.source.match(/%E5%89%AF%E6%9C%AC.assets/g)).toHaveLength(2);
    expect(readImage).toHaveBeenCalledWith('/project/docs/note.md', '../assets/图.png', ['/project']);
  });
  it('fails the preparation when an image is missing instead of producing a broken copy', async () => {
    readImage.mockRejectedValue(new Error('Image not found'));
    await expect(prepareDocumentCopy('![a](missing.png)', '/notes/a.md', '/copy/b.md', [])).rejects.toThrow('missing.png');
    await expect(prepareDocumentCopy('![a](image.png)', null, '/copy/b.md', [])).rejects.toThrow('Save the document');
  });
});
