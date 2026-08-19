const TIMESTAMP = String.raw`(?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3}`;
const TIMING_LINE = new RegExp(
  String.raw`^\s*(${TIMESTAMP})\s*-->\s*(${TIMESTAMP})(.*)$`,
);

function normalizeTimingLine(line: string): string | null {
  const match = TIMING_LINE.exec(line);
  if (!match) return null;
  return `${match[1].replace(',', '.')} --> ${match[2].replace(',', '.')}${match[3]}`;
}

function normalizeWebVtt(input: string): string {
  const lines = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const body = lines.slice(1).map((line) => normalizeTimingLine(line) ?? line);
  return `WEBVTT\n${body.join('\n')}`.replace(/\n*$/, '\n');
}

/** Convert SRT or normalize existing WebVTT into UTF-8 WebVTT text. */
export function convertSubtitleToWebVtt(input: string): string {
  const normalized = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT(?:[ \t].*)?(?:\n|$)/i.test(normalized)) {
    return normalizeWebVtt(normalized);
  }

  const lines = normalized.split('\n');
  const cues: string[] = [];
  let index = 0;

  while (index < lines.length) {
    while (index < lines.length && lines[index].trim() === '') index += 1;
    if (index >= lines.length) break;

    const blockStart = index;
    let timingIndex = index;
    if (!normalizeTimingLine(lines[timingIndex])) timingIndex += 1;
    const timing = timingIndex < lines.length
      ? normalizeTimingLine(lines[timingIndex])
      : null;

    if (!timing) {
      index = blockStart + 1;
      continue;
    }

    index = timingIndex + 1;
    const text: string[] = [];
    while (index < lines.length && lines[index].trim() !== '') {
      text.push(lines[index]);
      index += 1;
    }

    if (text.length === 0) continue;

    const identifier = lines[blockStart].trim();
    const keepIdentifier = timingIndex > blockStart && !/^\d+$/.test(identifier);
    cues.push(`${keepIdentifier ? `${identifier}\n` : ''}${timing}\n${text.join('\n')}`);
  }

  return `WEBVTT\n\n${cues.join('\n\n')}${cues.length > 0 ? '\n' : ''}`;
}

export const convertSubtitle = convertSubtitleToWebVtt;
