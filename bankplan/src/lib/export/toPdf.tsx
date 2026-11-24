import path from "node:path";
import { Document, Font, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Block, ExportDocument } from "./model";

// Noto Sans covers Estonian and Cyrillic letters (the built-in PDF fonts do not).
const fontDir = path.join(process.cwd(), "src/assets/fonts");
Font.register({
  family: "NotoSans",
  fonts: [
    { src: path.join(fontDir, "NotoSans-Regular.ttf") },
    { src: path.join(fontDir, "NotoSans-Bold.ttf"), fontWeight: "bold" },
  ],
});
// No automatic hyphenation: it breaks Estonian and Russian words badly.
Font.registerHyphenationCallback((word) => [word]);

// Line spacing is set on each text style, not on the page: on the page it hides the page numbers.
const s = StyleSheet.create({
  page: { fontFamily: "NotoSans", fontSize: 10, paddingTop: 48, paddingBottom: 56, paddingHorizontal: 48, color: "#0f172a" },
  footer: { position: "absolute", bottom: 24, left: 0, right: 0, textAlign: "center", fontSize: 8, color: "#6b7280" },
  title: { fontSize: 26, fontWeight: "bold", marginTop: 160, marginBottom: 12 },
  subtitle: { fontSize: 15, color: "#1e3a8a", marginBottom: 28 },
  meta: { fontSize: 11, marginBottom: 4, lineHeight: 1.4 },
  disclaimerTitle: { fontSize: 9, color: "#6b7280", marginTop: 80, lineHeight: 1.4 },
  h1: { fontSize: 15, fontWeight: "bold", color: "#1e3a8a", marginTop: 14, marginBottom: 6 },
  h2: { fontSize: 12, fontWeight: "bold", color: "#1e3a8a", marginTop: 10, marginBottom: 4 },
  paragraph: { marginBottom: 6, lineHeight: 1.4 },
  note: { fontSize: 9, color: "#6b7280", marginBottom: 6, lineHeight: 1.4 },
  bulletRow: { flexDirection: "row", marginBottom: 3 },
  bulletDot: { width: 12 },
  bulletText: { flex: 1 },
  tableTitle: { fontWeight: "bold", fontSize: 11, marginTop: 10, marginBottom: 4 },
  table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#d1d5db", marginBottom: 8 },
  row: { flexDirection: "row" },
  cell: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#d1d5db", paddingVertical: 2, paddingHorizontal: 4 },
  cellText: { lineHeight: 1.3 },
  header: { backgroundColor: "#f1f5f9", fontWeight: "bold" },
});

function TableBlock({ block }: { block: Extract<Block, { type: "table" }> }) {
  const fontSize = block.wide ? 6.5 : block.columns.length >= 5 ? 8 : 9;
  const labelWidth = block.columnWidths?.[0] ?? (block.wide ? 16 : block.columns.length >= 5 ? 10 : 36);
  const widthOf = (i: number) => block.columnWidths?.[i + 1] ?? (100 - labelWidth) / block.columns.length;
  // Short tables stay on one page; long ones (the loan schedule) may continue on the next.
  const keepTogether = block.rows.length <= 25;
  // Numbers are right-aligned. In a table with set widths the last column is text (e.g. "Source").
  const alignRight = (i: number) => !(block.columnWidths && i === block.columns.length - 1);
  // The border sits on the View, so all cells in a row stretch to the same height.
  const cell = (key: number, text: string, width: number, right: boolean, bold?: boolean) => (
    <View key={key} style={[s.cell, { width: `${width}%` }]}>
      <Text style={[s.cellText, { textAlign: right ? "right" : "left", fontSize }, bold ? { fontWeight: "bold" } : {}]}>{text}</Text>
    </View>
  );
  return (
    <View wrap={!keepTogether}>
      {block.title ? <Text style={s.tableTitle}>{block.title}</Text> : null}
      <View style={s.table}>
        <View style={[s.row, s.header]} fixed>
          {cell(-1, block.labelHeader ?? "", labelWidth, false, true)}
          {block.columns.map((column, i) => cell(i, column, widthOf(i), alignRight(i), true))}
        </View>
        {block.rows.map((row, r) => (
          <View key={r} style={s.row} wrap={false}>
            {cell(-1, row.label, labelWidth, false, row.bold)}
            {row.values.map((value, i) => cell(i, value, widthOf(i), alignRight(i), row.bold))}
          </View>
        ))}
      </View>
    </View>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "heading":
      return <Text style={block.level === 1 ? s.h1 : s.h2} minPresenceAhead={40}>{block.text}</Text>;
    case "paragraph":
      return <Text style={s.paragraph}>{block.text}</Text>;
    case "note":
      return <Text style={s.note}>{block.text}</Text>;
    case "bullets":
      return (
        <View style={{ marginBottom: 6 }}>
          {block.items.map((item, i) => (
            <View key={i} style={s.bulletRow} wrap={false}>
              <Text style={s.bulletDot}>•</Text>
              <Text style={s.bulletText}>{item}</Text>
            </View>
          ))}
        </View>
      );
    case "table":
      return <TableBlock block={block} />;
    case "pageBreak":
      return <View break />;
  }
}

/** Splits the blocks into pages: wide tables get a landscape page of their own. */
function groupPages(blocks: Block[]) {
  const pages: { landscape: boolean; blocks: Block[] }[] = [];
  let current: Block[] = [];
  const close = () => {
    while (current.length && current[current.length - 1].type === "pageBreak") current.pop();
    if (current.length) pages.push({ landscape: false, blocks: current });
    current = [];
  };
  for (const block of blocks) {
    if (block.type === "table" && block.wide) {
      close();
      pages.push({ landscape: true, blocks: [block] });
    } else if (block.type === "pageBreak") {
      if (current.length) close();
    } else {
      current.push(block);
    }
  }
  close();
  return pages;
}

function PlanPdf({ doc }: { doc: ExportDocument }) {
  const footer = (
    <Text
      style={s.footer}
      fixed
      render={({ pageNumber, totalPages }) =>
        doc.pageLabel.replace("{page}", String(pageNumber)).replace("{total}", String(totalPages))
      }
    />
  );
  return (
    <Document title={doc.title} language={doc.locale}>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>{doc.title}</Text>
        <Text style={s.subtitle}>{doc.subtitle}</Text>
        {doc.meta.map((line, i) => (
          <Text key={i} style={s.meta}>{line}</Text>
        ))}
        <Text style={s.disclaimerTitle}>{doc.disclaimer}</Text>
        {footer}
      </Page>
      {groupPages(doc.blocks).map((page, i) => (
        <Page key={i} size="A4" orientation={page.landscape ? "landscape" : "portrait"} style={s.page}>
          {page.blocks.map((block, j) => (
            <BlockView key={j} block={block} />
          ))}
          {footer}
        </Page>
      ))}
    </Document>
  );
}

export async function toPdf(doc: ExportDocument): Promise<Buffer> {
  return renderToBuffer(<PlanPdf doc={doc} />);
}
