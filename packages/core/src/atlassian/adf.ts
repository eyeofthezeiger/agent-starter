/** Minimal Atlassian Document Format: one paragraph per line, plus an optional link line. */
export interface AdfDoc {
  type: "doc";
  version: 1;
  content: unknown[];
}

export function textToAdf(text: string, link?: { href: string; label: string }): AdfDoc {
  const paragraphs = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] }));
  if (link) {
    paragraphs.push({
      type: "paragraph",
      content: [{ type: "text", text: link.label, marks: [{ type: "link", attrs: { href: link.href } }] } as never],
    });
  }
  return { type: "doc", version: 1, content: paragraphs };
}
