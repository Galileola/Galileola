import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
} from "docx";
import type { Block, ExportDocument } from "./model";

type DocChild = Paragraph | Table;

const FONT = "Arial";
const GREY = "6B7280";
const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB" };

/** "Page {page} of {total}" → text runs with live page number fields. */
function pageNumberRuns(label: string): TextRun {
  const children: (string | (typeof PageNumber)[keyof typeof PageNumber])[] = [];
  for (const part of label.split(/(\{page\}|\{total\})/)) {
    if (part === "{page}") children.push(PageNumber.CURRENT);
    else if (part === "{total}") children.push(PageNumber.TOTAL_PAGES);
    else if (part) children.push(part);
  }
  return new TextRun({ children, size: 16, color: GREY, font: FONT });
}

function textRuns(text: string, options: { bold?: boolean; size?: number; color?: string } = {}): TextRun[] {
  return text.split("\n").map(
    (line, i) => new TextRun({ text: line, break: i > 0 ? 1 : undefined, font: FONT, ...options }),
  );
}

function table(block: Extract<Block, { type: "table" }>): DocChild[] {
  const size = block.wide ? 14 : 18;
  const labelWidth = block.columnWidths?.[0] ?? (block.wide ? 16 : block.columns.length >= 5 ? 10 : 36);
  const widthOf = (i: number) => block.columnWidths?.[i + 1] ?? (100 - labelWidth) / block.columns.length;
  const cell = (text: string, opts: { bold?: boolean; right?: boolean; width: number; header?: boolean }) =>
    new TableCell({
      width: { size: opts.width, type: WidthType.PERCENTAGE },
      borders: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
      shading: opts.header ? { fill: "F1F5F9" } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: [
        new Paragraph({
          alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: textRuns(text, { bold: opts.bold || opts.header, size }),
        }),
      ],
    });

  const header = new TableRow({
    tableHeader: true,
    children: [
      cell(block.labelHeader ?? "", { width: labelWidth, header: true }),
      ...block.columns.map((c, i) => cell(c, { width: widthOf(i), right: i < block.columns.length - 1 || !block.columnWidths, header: true })),
    ],
  });
  const rows = block.rows.map(
    (row) =>
      new TableRow({
        cantSplit: true,
        children: [
          cell(row.label, { width: labelWidth, bold: row.bold }),
          ...row.values.map((v, i) => cell(v, { width: widthOf(i), right: i < row.values.length - 1 || !block.columnWidths, bold: row.bold })),
        ],
      }),
  );
  const out: DocChild[] = [];
  if (block.title) {
    out.push(new Paragraph({ spacing: { before: 240, after: 80 }, children: textRuns(block.title, { bold: true, size: 22 }) }));
  }
  out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] }));
  return out;
}

function blockToDocx(block: Block): DocChild[] {
  switch (block.type) {
    case "heading":
      return [
        new Paragraph({
          heading: block.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
          children: textRuns(block.text, { bold: true, size: block.level === 1 ? 30 : 24, color: "1E3A8A" }),
        }),
      ];
    case "paragraph":
      return [new Paragraph({ spacing: { after: 120 }, children: textRuns(block.text, { size: 21 }) })];
    case "note":
      return [new Paragraph({ spacing: { after: 120 }, children: textRuns(block.text, { size: 18, color: GREY }) })];
    case "bullets":
      return block.items.map(
        (item) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: textRuns(item, { size: 21 }) }),
      );
    case "table":
      return table(block);
    case "pageBreak":
      return [new Paragraph({ children: [new PageBreak()] })];
  }
}

/** Builds the Word file. Wide tables get a landscape section of their own. */
export async function toDocx(doc: ExportDocument): Promise<Buffer> {
  const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [pageNumberRuns(doc.pageLabel)] })] });
  const portrait = { page: { size: { orientation: PageOrientation.PORTRAIT } } };
  const landscape = { page: { size: { orientation: PageOrientation.LANDSCAPE } } };

  const titlePage: DocChild[] = [
    new Paragraph({ spacing: { before: 2400, after: 240 }, children: textRuns(doc.title, { bold: true, size: 52, color: "0F172A" }) }),
    new Paragraph({ spacing: { after: 480 }, children: textRuns(doc.subtitle, { size: 30, color: "1E3A8A" }) }),
    ...doc.meta.map((line) => new Paragraph({ spacing: { after: 80 }, children: textRuns(line, { size: 22 }) })),
    new Paragraph({ spacing: { before: 1200 }, children: textRuns(doc.disclaimer, { size: 18, color: GREY }) }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const sections: ISectionOptions[] = [];
  let current: DocChild[] = titlePage;
  const closePortrait = () => {
    if (current.length) sections.push({ properties: portrait, footers: { default: footer }, children: current });
    current = [];
  };
  for (const block of doc.blocks) {
    if (block.type === "table" && block.wide) {
      closePortrait();
      sections.push({ properties: landscape, footers: { default: footer }, children: blockToDocx(block) });
    } else if (block.type === "pageBreak" && current.length === 0) {
      // A new section already starts on a new page.
    } else {
      current.push(...blockToDocx(block));
    }
  }
  closePortrait();

  const file = new Document({
    creator: "Plaani Äri",
    title: doc.title,
    styles: { default: { document: { run: { font: FONT } } } },
    sections,
  });
  return Packer.toBuffer(file);
}
