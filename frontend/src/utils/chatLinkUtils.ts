const URL_IN_TEXT =
  /https?:\/\/[^\s<>[\](){}'"`,!?.:;]+(?:\([^\s)]*\))?/gi;

export function extractUrls(text: string, max = 3): string[] {
  const matches = String(text || '').match(URL_IN_TEXT) || [];
  const cleaned = matches.map((u) => u.replace(/[)\].,!?;:]+$/, ''));
  return Array.from(new Set(cleaned)).slice(0, max);
}

export type TextPart = { type: 'text'; value: string } | { type: 'link'; value: string; href: string };

export function splitTextWithLinks(text: string): TextPart[] {
  const raw = String(text || '');
  if (!raw) return [];

  const parts: TextPart[] = [];
  let lastIndex = 0;
  const re = new RegExp(URL_IN_TEXT.source, 'gi');
  let match: RegExpExecArray | null;

  while ((match = re.exec(raw)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      parts.push({ type: 'text', value: raw.slice(lastIndex, start) });
    }
    let href = match[0].replace(/[)\].,!?;:]+$/, '');
    parts.push({ type: 'link', value: href, href });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < raw.length) {
    parts.push({ type: 'text', value: raw.slice(lastIndex) });
  }

  return parts.length ? parts : [{ type: 'text', value: raw }];
}

export function initialsFromName(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
