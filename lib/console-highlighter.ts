export interface HighlightToken {
  text: string;
  className: string;
}

interface AnsiStyle {
  fgClass: string;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

const ANSI_FG_MAP: Record<number, string> = {
  30: 'text-zinc-500',
  31: 'text-red-400',
  32: 'text-emerald-400',
  33: 'text-amber-400',
  34: 'text-sky-400',
  35: 'text-violet-400',
  36: 'text-cyan-400',
  37: 'text-zinc-200',
  90: 'text-zinc-500',
  91: 'text-red-300',
  92: 'text-emerald-300',
  93: 'text-amber-300',
  94: 'text-sky-300',
  95: 'text-violet-300',
  96: 'text-cyan-300',
  97: 'text-white',
};

// Strips non-SGR CSI/OSC escape sequences (cursor moves, line clear, window title, etc.)
const NON_SGR_ESCAPE_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-ln-z]/g;
const SGR_RE = /\x1b\[([0-9;]*)m/g;

function buildAnsiClassName(style: AnsiStyle): string {
  const classes: string[] = [];
  if (style.fgClass) classes.push(style.fgClass);
  if (style.bold) classes.push('font-semibold');
  if (style.dim) classes.push('opacity-70');
  if (style.italic) classes.push('italic');
  if (style.underline) classes.push('underline underline-offset-2');
  return classes.join(' ');
}

function splitAnsiSegments(raw: string): Array<{ text: string; style: AnsiStyle }> {
  const cleaned = raw.replace(NON_SGR_ESCAPE_RE, '');
  const segments: Array<{ text: string; style: AnsiStyle }> = [];

  const style: AnsiStyle = {
    fgClass: '',
    bold: false,
    dim: false,
    italic: false,
    underline: false,
  };

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  SGR_RE.lastIndex = 0;

  while ((match = SGR_RE.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: cleaned.slice(lastIndex, match.index),
        style: { ...style },
      });
    }

    const codesRaw = match[1];
    const codes = codesRaw === '' ? [0] : codesRaw.split(';').map((n) => Number(n));
    for (const code of codes) {
      if (!Number.isFinite(code) || code === 0) {
        style.fgClass = '';
        style.bold = false;
        style.dim = false;
        style.italic = false;
        style.underline = false;
      } else if (code === 1) {
        style.bold = true;
      } else if (code === 2) {
        style.dim = true;
      } else if (code === 3) {
        style.italic = true;
      } else if (code === 4) {
        style.underline = true;
      } else if (code === 22) {
        style.bold = false;
        style.dim = false;
      } else if (code === 23) {
        style.italic = false;
      } else if (code === 24) {
        style.underline = false;
      } else if (code === 39) {
        style.fgClass = '';
      } else if (ANSI_FG_MAP[code]) {
        style.fgClass = ANSI_FG_MAP[code];
      }
    }

    lastIndex = SGR_RE.lastIndex;
  }

  if (lastIndex < cleaned.length) {
    segments.push({
      text: cleaned.slice(lastIndex),
      style: { ...style },
    });
  }

  return segments;
}

const SEMANTIC_TOKEN_RE = new RegExp(
  [
    // 1: URLs
    /(https?:\/\/[^\s"'<>]+|wss?:\/\/[^\s"'<>]+)/.source,
    // 2: ISO or bracketed timestamps
    /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\[\d{2}:\d{2}:\d{2}(?:\.\d+)?\])/.source,
    // 3: Critical / Error keywords & runtime exceptions
    /(\[?(?:FATAL|CRITICAL|ERROR|ERR!)\]?|\b(?:Traceback|AssertionError|TypeError|ReferenceError|SyntaxError|ValueError|KeyError|RuntimeError|ImportError|ModuleNotFoundError|PermissionError|ENOENT|EACCES|EADDRINUSE|ECONNREFUSED|ETIMEDOUT|UnhandledPromiseRejection)\b)/.source,
    // 4: Warning keywords
    /(\[?(?:WARN|WARNING)\]?|\bnpm warn\b)/.source,
    // 5: Success / Ready keywords
    /(\[?(?:SUCCESS|READY|LISTENING|STARTED|CONNECTED|DONE|OK)\]?)/.source,
    // 6: Info / Notice keywords
    /(\[?(?:INFO|NOTICE)\]?|\bnpm notice\b)/.source,
    // 7: Debug / Trace keywords
    /(\[?(?:DEBUG|TRACE)\]?)/.source,
    // 8: File path with line(:col)
    /([a-zA-Z0-9_./-]+\.(?:[cm]?[jt]sx?|py|json|ya?ml|env|sh|sql):\d+(?::\d+)?)/.source,
    // 9: Host:Port or :Port
    /(\b(?:localhost|\d{1,3}(?:\.\d{1,3}){3}):\d{2,5}\b|:\d{4,5}\b)/.source,
    // 10: HTTP Methods (Read)
    /(\b(?:GET|HEAD|OPTIONS)\b)/.source,
    // 11: HTTP Methods (Write)
    /(\b(?:POST|PUT|PATCH)\b)/.source,
    // 12: HTTP Methods (Delete)
    /(\bDELETE\b)/.source,
    // 13: Quoted strings
    /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/.source,
    // 14: Env key=value
    /(\b[A-Z_][A-Z0-9_]{1,}=[^\s]+)/.source,
    // 15: CLI flags (--flag or -f)
    /(?:(?<=^|\s)(--?[a-zA-Z0-9][a-zA-Z0-9-]*))/.source,
    // 16: Durations, sizes, percentages
    /(\b\d+(?:\.\d+)?(?:ms|us|ns|s|KiB|MiB|GiB|KB|MB|GB|%)\b)/.source,
    // 17: HTTP status codes (contextual)
    /(?:(?<=^|[\s/(\[])([1-5]\d{2})(?=$|[\s,)\]]))/.source,
    // 18: Literals
    /(\b(?:true|false|null|undefined|None|True|False)\b)/.source,
  ].join('|'),
  'g'
);

function classifySemanticToken(match: RegExpExecArray, defaultClass: string): HighlightToken[] {
  const full = match[0];

  if (match[1]) return [{ text: full, className: 'text-cyan-400' }];
  if (match[2]) return [{ text: full, className: 'text-zinc-500' }];
  if (match[3]) return [{ text: full, className: 'text-red-400 font-medium' }];
  if (match[4]) return [{ text: full, className: 'text-amber-400 font-medium' }];
  if (match[5]) return [{ text: full, className: 'text-emerald-400 font-medium' }];
  if (match[6]) return [{ text: full, className: 'text-sky-400' }];
  if (match[7]) return [{ text: full, className: 'text-violet-400' }];
  if (match[8]) return [{ text: full, className: 'text-amber-300' }];
  if (match[9]) return [{ text: full, className: 'text-cyan-300' }];
  if (match[10]) return [{ text: full, className: 'text-sky-400 font-medium' }];
  if (match[11]) return [{ text: full, className: 'text-emerald-400 font-medium' }];
  if (match[12]) return [{ text: full, className: 'text-red-400 font-medium' }];
  if (match[13]) return [{ text: full, className: 'text-teal-300/90' }];
  if (match[14]) {
    const eqIdx = full.indexOf('=');
    return [
      { text: full.slice(0, eqIdx), className: 'text-sky-300' },
      { text: '=', className: 'text-zinc-500' },
      { text: full.slice(eqIdx + 1), className: 'text-teal-300' },
    ];
  }
  if (match[15]) return [{ text: full, className: 'text-violet-300' }];
  if (match[16]) return [{ text: full, className: 'text-amber-300/90' }];
  if (match[17]) {
    const code = Number(full);
    const cls =
      code < 300
        ? 'text-emerald-400'
        : code < 400
        ? 'text-amber-400'
        : 'text-red-400';
    return [{ text: full, className: cls }];
  }
  if (match[18]) return [{ text: full, className: 'text-violet-300' }];

  return [{ text: full, className: defaultClass }];
}

function tokenizePlainText(
  text: string,
  defaultClass: string,
  extraClasses: string
): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  SEMANTIC_TOKEN_RE.lastIndex = 0;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SEMANTIC_TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        text: text.slice(lastIndex, match.index),
        className: [defaultClass, extraClasses].filter(Boolean).join(' '),
      });
    }

    const classified = classifySemanticToken(match, defaultClass);
    for (const item of classified) {
      tokens.push({
        text: item.text,
        className: [item.className, extraClasses].filter(Boolean).join(' '),
      });
    }

    lastIndex = SEMANTIC_TOKEN_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({
      text: text.slice(lastIndex),
      className: [defaultClass, extraClasses].filter(Boolean).join(' '),
    });
  }

  return tokens;
}

export function tokenizeConsoleLine(
  text: string,
  defaultClass = ''
): HighlightToken[] {
  if (!text) return [];

  const segments = splitAnsiSegments(text);
  const result: HighlightToken[] = [];

  for (const seg of segments) {
    if (!seg.text) continue;
    const ansiClass = buildAnsiClassName(seg.style);

    if (seg.style.fgClass) {
      result.push({
        text: seg.text,
        className: ansiClass,
      });
    } else {
      const semantic = tokenizePlainText(seg.text, defaultClass, ansiClass);
      result.push(...semantic);
    }
  }

  return result;
}
