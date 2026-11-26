import type { CSSProperties } from 'react';

export interface HighlightToken {
  text: string;
  className: string;
  style?: CSSProperties;
}

interface AnsiStyle {
  fgClass: string;
  fgColor: string;
  bgClass: string;
  bgColor: string;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strikethrough: boolean;
}

const ANSI_FG_MAP: Record<number, string> = {
  30: 'text-zinc-500',
  31: 'text-red-500',
  32: 'text-emerald-400',
  33: 'text-yellow-400',
  34: 'text-blue-500',
  35: 'text-fuchsia-400',
  36: 'text-cyan-400',
  37: 'text-zinc-200',
  90: 'text-zinc-500',
  91: 'text-red-400',
  92: 'text-green-400',
  93: 'text-yellow-300',
  94: 'text-blue-400',
  95: 'text-fuchsia-300',
  96: 'text-cyan-300',
  97: 'text-white',
};

const ANSI_BG_MAP: Record<number, string> = {
  40: 'bg-zinc-900',
  41: 'bg-red-500/25',
  42: 'bg-emerald-500/25',
  43: 'bg-yellow-500/25',
  44: 'bg-blue-500/25',
  45: 'bg-fuchsia-500/25',
  46: 'bg-cyan-500/25',
  47: 'bg-zinc-200/20',
  100: 'bg-zinc-700/50',
  101: 'bg-red-500/35',
  102: 'bg-emerald-500/35',
  103: 'bg-yellow-500/35',
  104: 'bg-blue-500/35',
  105: 'bg-fuchsia-500/35',
  106: 'bg-cyan-500/35',
  107: 'bg-white/25',
};

const XTERM_16_HEX = [
  '#52525b',
  '#ef4444',
  '#22c55e',
  '#eab308',
  '#3b82f6',
  '#d946ef',
  '#06b6d4',
  '#e4e4e7',
  '#71717a',
  '#f87171',
  '#4ade80',
  '#fde047',
  '#60a5fa',
  '#f0abfc',
  '#67e8f9',
  '#ffffff',
];

function xterm256ToHex(index: number): string {
  const n = Math.max(0, Math.min(255, Math.floor(index)));
  if (n < 16) return XTERM_16_HEX[n];
  if (n < 232) {
    const idx = n - 16;
    const rIdx = Math.floor(idx / 36);
    const gIdx = Math.floor((idx % 36) / 6);
    const bIdx = idx % 6;
    const toVal = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${toVal(rIdx)}, ${toVal(gIdx)}, ${toVal(bIdx)})`;
  }
  const gray = 8 + (n - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

const NON_SGR_ESCAPE_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-ln-z]/g;
const TRAILING_INCOMPLETE_ESCAPE_RE = /\x1b(?:\[[0-9;:?]*|\][^\x07\x1b]*)?$/;
const SGR_RE = /\x1b\[([0-9;:]*)m/g;

function normalizeCarriageReturns(raw: string): string {
  if (!raw.includes('\r')) return raw;
  const parts = raw.split('\r');
  let buffer = '';
  for (const part of parts) {
    if (!part) continue;
    if (part.length >= buffer.length) {
      buffer = part;
    } else {
      buffer = part + buffer.slice(part.length);
    }
  }
  return buffer;
}

function buildAnsiClassName(style: AnsiStyle, fallbackClass = ''): string {
  const classes: string[] = [];
  if (style.inverse) {
    classes.push('bg-zinc-200 text-zinc-950 px-0.5 rounded-[2px]');
  } else {
    if (style.fgClass && !style.fgColor) {
      classes.push(style.fgClass);
    } else if (!style.fgColor) {
      if (style.bold) {
        classes.push('text-zinc-100');
      } else if (fallbackClass) {
        classes.push(fallbackClass);
      }
    }
    if (style.bgClass && !style.bgColor) classes.push(style.bgClass);
  }
  if (style.bold) classes.push('font-semibold');
  if (style.dim) classes.push('opacity-70');
  if (style.italic) classes.push('italic');
  if (style.underline) classes.push('underline underline-offset-2');
  if (style.strikethrough) classes.push('line-through');
  return classes.join(' ');
}

function buildAnsiInlineStyle(style: AnsiStyle): CSSProperties | undefined {
  if (style.inverse) return undefined;
  const css: CSSProperties = {};
  if (style.fgColor) css.color = style.fgColor;
  if (style.bgColor) css.backgroundColor = style.bgColor;
  return Object.keys(css).length > 0 ? css : undefined;
}

function splitAnsiSegments(raw: string): {
  segments: Array<{ text: string; style: AnsiStyle }>;
  hasAnsi: boolean;
} {
  const normalized = normalizeCarriageReturns(raw);
  const cleaned = normalized
    .replace(NON_SGR_ESCAPE_RE, '')
    .replace(TRAILING_INCOMPLETE_ESCAPE_RE, '');
  const segments: Array<{ text: string; style: AnsiStyle }> = [];

  const style: AnsiStyle = {
    fgClass: '',
    fgColor: '',
    bgClass: '',
    bgColor: '',
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    strikethrough: false,
  };

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let hasAnsi = false;
  SGR_RE.lastIndex = 0;

  while ((match = SGR_RE.exec(cleaned)) !== null) {
    hasAnsi = true;
    if (match.index > lastIndex) {
      segments.push({
        text: cleaned.slice(lastIndex, match.index),
        style: { ...style },
      });
    }

    const codesRaw = match[1];
    const codes =
      codesRaw === ''
        ? [0]
        : codesRaw
            .replace(/::/g, ':0:')
            .split(/[;:]/)
            .map((n) => (n === '' ? 0 : Number(n)));

    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i];
      if (!Number.isFinite(code) || code === 0) {
        style.fgClass = '';
        style.fgColor = '';
        style.bgClass = '';
        style.bgColor = '';
        style.bold = false;
        style.dim = false;
        style.italic = false;
        style.underline = false;
        style.inverse = false;
        style.strikethrough = false;
      } else if (code === 1) {
        style.bold = true;
      } else if (code === 2) {
        style.dim = true;
      } else if (code === 3) {
        style.italic = true;
      } else if (code === 4) {
        style.underline = true;
      } else if (code === 7) {
        style.inverse = true;
      } else if (code === 9) {
        style.strikethrough = true;
      } else if (code === 22) {
        style.bold = false;
        style.dim = false;
      } else if (code === 23) {
        style.italic = false;
      } else if (code === 24) {
        style.underline = false;
      } else if (code === 27) {
        style.inverse = false;
      } else if (code === 29) {
        style.strikethrough = false;
      } else if (code === 39) {
        style.fgClass = '';
        style.fgColor = '';
      } else if (code === 49) {
        style.bgClass = '';
        style.bgColor = '';
      } else if (code === 38 || code === 48) {
        const isFg = code === 38;
        const mode = codes[i + 1];
        if (mode === 5 && codes[i + 2] !== undefined) {
          const hex = xterm256ToHex(codes[i + 2]);
          if (isFg) {
            style.fgClass = '';
            style.fgColor = hex;
          } else {
            style.bgClass = '';
            style.bgColor = hex;
          }
          i += 2;
        } else if (mode === 2 && codes[i + 4] !== undefined) {
          const r = Math.max(0, Math.min(255, Math.floor(codes[i + 2])));
          const g = Math.max(0, Math.min(255, Math.floor(codes[i + 3])));
          const b = Math.max(0, Math.min(255, Math.floor(codes[i + 4])));
          const rgb = `rgb(${r}, ${g}, ${b})`;
          if (isFg) {
            style.fgClass = '';
            style.fgColor = rgb;
          } else {
            style.bgClass = '';
            style.bgColor = rgb;
          }
          i += 4;
        }
      } else if (ANSI_FG_MAP[code]) {
        style.fgColor = '';
        style.fgClass = ANSI_FG_MAP[code];
      } else if (ANSI_BG_MAP[code]) {
        style.bgColor = '';
        style.bgClass = ANSI_BG_MAP[code];
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

  return { segments, hasAnsi };
}

const URL_RE = /(https?:\/\/[^\s"'<>)\]]+|wss?:\/\/[^\s"'<>)\]]+)/g;

function linkifyAnsiSegment(
  text: string,
  baseClass: string,
  inlineStyle?: CSSProperties
): HighlightToken[] {
  URL_RE.lastIndex = 0;
  const tokens: HighlightToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        text: text.slice(lastIndex, match.index),
        className: baseClass,
        ...(inlineStyle ? { style: inlineStyle } : {}),
      });
    }
    tokens.push({
      text: match[0],
      className: 'text-cyan-400 underline decoration-cyan-400/35 underline-offset-2',
      ...(inlineStyle ? { style: inlineStyle } : {}),
    });
    lastIndex = URL_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({
      text: text.slice(lastIndex),
      className: baseClass,
      ...(inlineStyle ? { style: inlineStyle } : {}),
    });
  }

  return tokens;
}

const SEMANTIC_TOKEN_RE = new RegExp(
  [
    /((?:^|\s)npm\s+(?:error|ERR!)(?:\s+(?:code|syscall|errno|path|dest|status|\d{3}))?)/.source,
    /((?:^|\s)npm\s+(?:warn|WARN)(?:\s+[a-zA-Z0-9_.-]+)?)/.source,
    /((?:^|\s)npm\s+notice(?:\s+[a-zA-Z0-9_.-]+)?)/.source,
    /((?:^|\s)npm\s+http\s+(?:fetch|cache))/.source,
    /((?:^|\s)npm\s+(?:info|verb|silly))/.source,
    /(https?:\/\/[^\s"'<>)\]]+|wss?:\/\/[^\s"'<>)\]]+)/.source,
    /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\[\d{2}:\d{2}:\d{2}(?:\.\d+)?\])/.source,
    /(\[?(?:FATAL|CRITICAL|ERROR|ERR!|FAILED)\]?|\b(?:Traceback|AssertionError|TypeError|ReferenceError|SyntaxError|ValueError|KeyError|RuntimeError|ImportError|ModuleNotFoundError|PermissionError|OSError|ConnectionError|TimeoutError|ENOENT|EACCES|EADDRINUSE|ECONNREFUSED|ETIMEDOUT|ERR_MODULE_NOT_FOUND|UnhandledPromiseRejection)\b)/.source,
    /(\[?(?:WARN|WARNING)\]?|\bDeprecationWarning\b)/.source,
    /(\[(?:SUCCESS|READY|LISTENING|STARTED|CONNECTED|OK|PASS|PASSED)\]|\bfound 0 vulnerabilities\b)/.source,
    /(\[(?:INFO|NOTICE)\]|\b(?:INFO|NOTICE):|\bcontainer@cmnty~)/.source,
    /(\[(?:DEBUG|TRACE)\]|\b(?:DEBUG|TRACE):)/.source,
    /(\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/[^\s"]*(?:\s+HTTP\/[0-9.]+)?"?\s+[1-5]\d{2}\b)/.source,
    /([a-zA-Z0-9_./-]+\.(?:[cm]?[jt]sx?|py|json|ya?ml|env|sh|sql):\d+(?::\d+)?)/.source,
    /(\b(?:localhost|(?:\d{1,3}\.){3}\d{1,3}):\d{2,5}\b)/.source,
  ].join('|'),
  'g'
);

function classifySemanticToken(
  match: RegExpExecArray,
  defaultClass: string
): HighlightToken[] {
  const full = match[0];

  if (match[1]) {
    const parts = /^(\s*)(npm)(\s+)(error|ERR!)(?:(\s+)(\S+))?$/.exec(full);
    if (parts) {
      const out: HighlightToken[] = [];
      if (parts[1]) out.push({ text: parts[1], className: defaultClass });
      out.push({ text: parts[2], className: 'text-zinc-100 font-semibold' });
      out.push({ text: parts[3], className: defaultClass });
      out.push({ text: parts[4], className: 'text-red-500 font-semibold' });
      if (parts[5] && parts[6]) {
        out.push({ text: parts[5], className: defaultClass });
        out.push({ text: parts[6], className: 'text-blue-400' });
      }
      return out;
    }
  }

  if (match[2]) {
    const parts = /^(\s*)(npm)(\s+)(warn|WARN)(?:(\s+)(\S+))?$/.exec(full);
    if (parts) {
      const out: HighlightToken[] = [];
      if (parts[1]) out.push({ text: parts[1], className: defaultClass });
      out.push({ text: parts[2], className: 'text-zinc-100 font-semibold' });
      out.push({ text: parts[3], className: defaultClass });
      out.push({ text: parts[4], className: 'text-yellow-400 font-semibold' });
      if (parts[5] && parts[6]) {
        out.push({ text: parts[5], className: defaultClass });
        out.push({ text: parts[6], className: 'text-fuchsia-400' });
      }
      return out;
    }
  }

  if (match[3]) {
    const parts = /^(\s*)(npm)(\s+)(notice)(?:(\s+)(\S+))?$/.exec(full);
    if (parts) {
      const out: HighlightToken[] = [];
      if (parts[1]) out.push({ text: parts[1], className: defaultClass });
      out.push({ text: parts[2], className: 'text-zinc-100 font-semibold' });
      out.push({ text: parts[3], className: defaultClass });
      out.push({ text: parts[4], className: 'text-fuchsia-400 font-semibold' });
      if (parts[5] && parts[6]) {
        out.push({ text: parts[5], className: defaultClass });
        out.push({ text: parts[6], className: 'text-cyan-400' });
      }
      return out;
    }
  }

  if (match[4]) {
    const parts = /^(\s*)(npm)(\s+)(http)(\s+)(fetch|cache)$/.exec(full);
    if (parts) {
      const out: HighlightToken[] = [];
      if (parts[1]) out.push({ text: parts[1], className: defaultClass });
      out.push({ text: parts[2], className: 'text-zinc-100 font-semibold' });
      out.push({ text: parts[3], className: defaultClass });
      out.push({ text: parts[4], className: 'text-emerald-400' });
      out.push({ text: parts[5], className: defaultClass });
      out.push({ text: parts[6], className: 'text-blue-400' });
      return out;
    }
  }

  if (match[5]) {
    const parts = /^(\s*)(npm)(\s+)(info|verb|silly)$/.exec(full);
    if (parts) {
      const out: HighlightToken[] = [];
      if (parts[1]) out.push({ text: parts[1], className: defaultClass });
      out.push({ text: parts[2], className: 'text-zinc-100 font-semibold' });
      out.push({ text: parts[3], className: defaultClass });
      out.push({ text: parts[4], className: 'text-cyan-400' });
      return out;
    }
  }

  if (match[6]) {
    return [{ text: full, className: 'text-cyan-400 underline decoration-cyan-400/35 underline-offset-2' }];
  }
  if (match[7]) return [{ text: full, className: 'text-zinc-500' }];
  if (match[8]) return [{ text: full, className: 'text-red-500 font-semibold' }];
  if (match[9]) return [{ text: full, className: 'text-yellow-400 font-semibold' }];
  if (match[10]) return [{ text: full, className: 'text-emerald-400 font-semibold' }];
  if (match[11]) return [{ text: full, className: 'text-blue-400 font-medium' }];
  if (match[12]) return [{ text: full, className: 'text-fuchsia-400 font-medium' }];

  if (match[13]) {
    const parts = /^(\S+)(\s+)(\/[^\s"]*(?:\s+HTTP\/[0-9.]+)?"?)(\s+)([1-5]\d{2})$/.exec(full);
    if (parts) {
      const code = Number(parts[5]);
      const statusCls =
        code < 300
          ? 'text-emerald-400 font-semibold'
          : code < 400
          ? 'text-yellow-400 font-semibold'
          : 'text-red-500 font-semibold';
      return [
        { text: parts[1], className: 'text-cyan-300 font-semibold' },
        { text: parts[2], className: defaultClass },
        { text: parts[3], className: 'text-zinc-200' },
        { text: parts[4], className: defaultClass },
        { text: parts[5], className: statusCls },
      ];
    }
  }

  if (match[14]) {
    return [
      {
        text: full,
        className: 'text-cyan-300 underline decoration-cyan-300/30 underline-offset-2',
      },
    ];
  }

  if (match[15]) {
    return [{ text: full, className: 'text-cyan-300' }];
  }

  return [{ text: full, className: defaultClass }];
}

function tokenizePlainText(
  text: string,
  defaultClass: string
): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  SEMANTIC_TOKEN_RE.lastIndex = 0;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SEMANTIC_TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        text: text.slice(lastIndex, match.index),
        className: defaultClass,
      });
    }

    const classified = classifySemanticToken(match, defaultClass);
    for (const item of classified) {
      tokens.push({
        text: item.text,
        className: item.className,
      });
    }

    lastIndex = SEMANTIC_TOKEN_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({
      text: text.slice(lastIndex),
      className: defaultClass,
    });
  }

  return tokens;
}

export function tokenizeConsoleLine(
  text: string,
  defaultClass = ''
): HighlightToken[] {
  if (!text) return [];

  const { segments, hasAnsi } = splitAnsiSegments(text);
  if (!hasAnsi) {
    return tokenizePlainText(segments.map((s) => s.text).join(''), defaultClass);
  }

  const result: HighlightToken[] = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    const ansiClass = buildAnsiClassName(seg.style, defaultClass);
    const ansiInline = buildAnsiInlineStyle(seg.style);

    if (seg.style.fgClass || seg.style.fgColor || seg.style.inverse) {
      result.push({
        text: seg.text,
        className: ansiClass,
        ...(ansiInline ? { style: ansiInline } : {}),
      });
    } else {
      result.push(...linkifyAnsiSegment(seg.text, ansiClass, ansiInline));
    }
  }

  return result;
}
