import type { ReactNode } from "react";

// Minimal, safe Markdown for research reports: headings, bullets, paragraphs, **bold**,
// *italic*, [links](url) and bare URLs. Builds React elements; never injects HTML.
const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+|\*[^*\s][^*]*\*)/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const t = m[0];
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) {
      const inner = t.slice(2, -2);
      const tag = /^\[(Evidence|Assumption)\]$/i.exec(inner);
      out.push(
        tag ? (
          <span key={k} className="tag mr-1 align-middle" style={{ background: tag[1].toLowerCase() === "evidence" ? "#3CC7B5" : "#FFE14D" }}>
            {tag[1].toUpperCase()}
          </span>
        ) : (
          <strong key={k}>{inner}</strong>
        ),
      );
    } else if (t.startsWith("[")) {
      const label = t.slice(1, t.indexOf("]("));
      out.push(
        <a key={k} href={m[2]} target="_blank" rel="noreferrer" className="font-semibold underline decoration-2 underline-offset-2">
          {label}
        </a>,
      );
    } else if (t.startsWith("http")) {
      out.push(
        <a key={k} href={t} target="_blank" rel="noreferrer" className="break-all underline">
          {t}
        </a>,
      );
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (list.length) {
      const items = list;
      blocks.push(
        <ul key={`ul${blocks.length}`} className="my-2 list-disc space-y-1.5 pl-5">
          {items.map((li, i) => (
            <li key={i}>{inline(li, `li${blocks.length}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
    if (para.length) {
      blocks.push(
        <p key={`p${blocks.length}`} className="my-2">
          {inline(para.join(" "), `p${blocks.length}`)}
        </p>,
      );
      para = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push(
        <h3 key={`h${blocks.length}`} className="mb-1 mt-6 border-b-2 border-black pb-1 text-base font-black first:mt-0">
          {inline(h[2], `h${blocks.length}`)}
        </h3>,
      );
    } else if (li) {
      if (para.length) flush();
      list.push(li[1]);
    } else if (!line.trim()) flush();
    else {
      if (list.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return <div className="text-sm leading-relaxed">{blocks}</div>;
}
