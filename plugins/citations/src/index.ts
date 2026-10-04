const bibliographyMarker = '<!-- markedown:bibliography -->';

export default {
  activate(context: {
    registerCommand(command: { id: string; title: string; run(): void | Promise<void> }): () => void;
    registerPanel(panel: { id: string; title: string; mount(container: HTMLElement): () => void }): () => void;
    readDocument(): Promise<{ source: string } | null>;
    updateDocument(source: string): Promise<void>;
    fetch(url: string): Promise<{ status: number; body: string }>;
  }) {
    context.registerPanel({
      id: 'references',
      title: 'References',
      mount() { return () => {}; },
    });

    context.registerCommand({
      id: 'insert-bibliography-marker',
      title: 'Insert bibliography marker',
      async run() {
        const document = await context.readDocument();
        if (!document) throw new Error('Open a document before inserting a bibliography.');
        if (document.source.includes(bibliographyMarker)) return;
        const source = `${document.source.replace(/\s*$/u, '')}\n\n${bibliographyMarker}\n`;
        await context.updateDocument(source);
      },
    });

    context.registerCommand({
      id: 'check-zotero-connection',
      title: 'Check Zotero connection',
      async run() {
        const response = await context.fetch('http://127.0.0.1:23119/api/users/0/items?limit=1');
        if (response.status < 200 || response.status >= 300) throw new Error(`Zotero returned HTTP ${response.status}.`);
      },
    });
  },
};
