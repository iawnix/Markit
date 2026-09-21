import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown';
import { addListNodes } from 'prosemirror-schema-list';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { Schema } from 'prosemirror-model';

/**
 * Markdown remains the durable document format. This schema is the semantic
 * projection used by the live editor; unknown Markdown is kept in the source
 * editor until a dedicated lossless node is added for that syntax.
 */
export const markitSchema = new Schema({
  nodes: addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block'),
  marks: basicSchema.spec.marks,
});

export const markdownParser = new MarkdownParser(
  markitSchema,
  defaultMarkdownParser.tokenizer,
  defaultMarkdownParser.tokens,
);

export const markdownSerializer = new MarkdownSerializer(
  defaultMarkdownSerializer.nodes,
  defaultMarkdownSerializer.marks,
);

export interface MarkdownProjection {
  source: string;
  document: ProseMirrorNode;
}

export function parseMarkdown(source: string): MarkdownProjection {
  return { source, document: markdownParser.parse(source) };
}

export function serializeMarkdown(document: ProseMirrorNode): string {
  return markdownSerializer.serialize(document);
}

export function isLosslessCandidate(source: string): boolean {
  return !/^\s*(---|\.\.\.)\s*$/m.test(source)
    && !/^```(?:mermaid|math|html)\b/m.test(source)
    && !/^<!--/m.test(source);
}
