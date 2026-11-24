/**
 * One description of the exported plan. The Word and the PDF files are both
 * drawn from it, so they always contain the same content.
 */

export type TableRow = { label: string; values: string[]; bold?: boolean };

export type Block =
  | { type: "heading"; level: 1 | 2; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  /** Small grey text, e.g. "this section is not written yet". */
  | { type: "note"; text: string }
  /** `wide` tables (many columns) get a landscape page of their own. */
  | {
      type: "table";
      title?: string;
      labelHeader?: string;
      columns: string[];
      rows: TableRow[];
      wide?: boolean;
      /** Width in % of the label column and then each value column. */
      columnWidths?: number[];
    }
  | { type: "pageBreak" };

export type ExportDocument = {
  locale: string;
  title: string;
  subtitle: string;
  /** Lines on the title page, e.g. "Business form: OÜ". */
  meta: string[];
  disclaimer: string;
  /** "Page {page} of {total}" with the placeholders left in. */
  pageLabel: string;
  blocks: Block[];
};

/**
 * Turns a section text into blocks: paragraphs are separated by blank lines,
 * and lines starting with "- " or "• " become a bulleted list.
 */
export function textToBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const isBullet = (line: string) => /^[-•*]\s+/.test(line);
    let paragraph: string[] = [];
    let bullets: string[] = [];
    const flush = () => {
      if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      if (bullets.length) blocks.push({ type: "bullets", items: bullets });
      paragraph = [];
      bullets = [];
    };
    for (const line of lines) {
      if (isBullet(line)) {
        if (paragraph.length) flush();
        bullets.push(line.replace(/^[-•*]\s+/, ""));
      } else {
        if (bullets.length) flush();
        paragraph.push(line);
      }
    }
    flush();
  }
  return blocks;
}
