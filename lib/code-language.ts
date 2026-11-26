import { LanguageDescription, LanguageSupport, StreamLanguage, type StreamParser } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { angular } from '@codemirror/lang-angular';
import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { jinja } from '@codemirror/lang-jinja';
import { json } from '@codemirror/lang-json';
import { less } from '@codemirror/lang-less';
import { liquid } from '@codemirror/lang-liquid';
import { markdown } from '@codemirror/lang-markdown';
import { php } from '@codemirror/lang-php';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sass } from '@codemirror/lang-sass';
import { sql, PostgreSQL, MySQL, SQLite, MariaSQL, MSSQL, PLSQL, Cassandra, StandardSQL } from '@codemirror/lang-sql';
import { vue } from '@codemirror/lang-vue';
import { wast } from '@codemirror/lang-wast';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { csharp, kotlin, scala, dart, objectiveC } from '@codemirror/legacy-modes/mode/clike';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { r } from '@codemirror/legacy-modes/mode/r';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { erlang } from '@codemirror/legacy-modes/mode/erlang';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf';

export interface ResolvedCodeLanguage {
  name: string;
  support: LanguageSupport | null;
  fallbackDescription: LanguageDescription | null;
}

function legacySupport(parser: StreamParser<unknown>): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(parser));
}

const STATIC_LANGUAGE_BUILDERS: Record<string, () => LanguageSupport> = {
  JavaScript: () => javascript(),
  JSX: () => javascript({ jsx: true }),
  TypeScript: () => javascript({ typescript: true }),
  TSX: () => javascript({ jsx: true, typescript: true }),
  Python: () => python(),
  JSON: () => json(),
  HTML: () => html(),
  Angular: () => angular(),
  Vue: () => vue(),
  CSS: () => css(),
  SCSS: () => sass(),
  Sass: () => sass({ indented: true }),
  LESS: () => less(),
  Markdown: () => markdown(),
  YAML: () => yaml(),
  XML: () => xml(),
  PHP: () => php(),
  Go: () => go(),
  Rust: () => rust(),
  Java: () => java(),
  C: () => cpp(),
  'C++': () => cpp(),
  Jinja: () => jinja(),
  Liquid: () => liquid(),
  WebAssembly: () => wast(),
  SQL: () => sql({ dialect: StandardSQL }),
  PostgreSQL: () => sql({ dialect: PostgreSQL }),
  MySQL: () => sql({ dialect: MySQL }),
  SQLite: () => sql({ dialect: SQLite }),
  'MariaDB SQL': () => sql({ dialect: MariaSQL }),
  'MS SQL': () => sql({ dialect: MSSQL }),
  PLSQL: () => sql({ dialect: PLSQL }),
  CQL: () => sql({ dialect: Cassandra }),
  Shell: () => legacySupport(shell),
  Dockerfile: () => legacySupport(dockerFile),
  Properties: () => legacySupport(properties),
  TOML: () => legacySupport(toml),
  'C#': () => legacySupport(csharp),
  Kotlin: () => legacySupport(kotlin),
  Scala: () => legacySupport(scala),
  Dart: () => legacySupport(dart),
  'Objective-C': () => legacySupport(objectiveC),
  Ruby: () => legacySupport(ruby),
  Lua: () => legacySupport(lua),
  PowerShell: () => legacySupport(powerShell),
  Nginx: () => legacySupport(nginx),
  Diff: () => legacySupport(diff),
  Perl: () => legacySupport(perl),
  R: () => legacySupport(r),
  Groovy: () => legacySupport(groovy),
  Haskell: () => legacySupport(haskell),
  Erlang: () => legacySupport(erlang),
  Swift: () => legacySupport(swift),
  CMake: () => legacySupport(cmake),
  Protocol: () => legacySupport(protobuf),
  'Protocol Buffers': () => legacySupport(protobuf),
};

const SPECIAL_FILENAME_MAP: Array<{
  match: RegExp;
  label: string;
  build: () => LanguageSupport;
}> = [
  { match: /^\.env(?:\..+)?$/i, label: 'ENV / Properties', build: () => legacySupport(properties) },
  {
    match: /^(?:\.gitignore|\.dockerignore|\.eslintignore|\.prettierignore)$/i,
    label: 'Ignore / Shell',
    build: () => legacySupport(shell),
  },
  {
    match: /^(?:\.npmrc|\.yarnrc|\.editorconfig|\.gitattributes|procfile)$/i,
    label: 'Config',
    build: () => legacySupport(properties),
  },
  {
    match: /^(?:\.bashrc|\.zshrc|\.profile|\.bash_profile)$/i,
    label: 'Shell',
    build: () => legacySupport(shell),
  },
  { match: /^dockerfile(?:\..+)?$/i, label: 'Dockerfile', build: () => legacySupport(dockerFile) },
  { match: /^(?:makefile|gnumakefile)$/i, label: 'Makefile', build: () => legacySupport(shell) },
  { match: /^(?:\.eslintrc|\.prettierrc|\.babelrc)$/i, label: 'JSON', build: () => json() },
  {
    match: /^requirements(?:[-_.].+)?\.txt$/i,
    label: 'Requirements',
    build: () => legacySupport(properties),
  },
  { match: /^pipfile$/i, label: 'TOML', build: () => legacySupport(toml) },
  { match: /^nginx(?:\..+)?\.conf$/i, label: 'Nginx', build: () => legacySupport(nginx) },
  { match: /^prisma\.schema$/i, label: 'Schema', build: () => legacySupport(properties) },
];

export function resolveCodeLanguage(filePath: string): ResolvedCodeLanguage {
  const baseName = filePath.split('/').pop()?.trim() ?? '';
  if (!baseName) {
    return { name: 'Plain Text', support: null, fallbackDescription: null };
  }

  for (const rule of SPECIAL_FILENAME_MAP) {
    if (rule.match.test(baseName)) {
      return {
        name: rule.label,
        support: rule.build(),
        fallbackDescription: null,
      };
    }
  }

  const direct = LanguageDescription.matchFilename(languages, baseName);
  if (direct) {
    const staticBuilder = Object.hasOwn(STATIC_LANGUAGE_BUILDERS, direct.name)
      ? STATIC_LANGUAGE_BUILDERS[direct.name]
      : undefined;
    return {
      name: direct.name,
      support: staticBuilder ? staticBuilder() : null,
      fallbackDescription: staticBuilder ? null : direct,
    };
  }

  return { name: 'Plain Text', support: null, fallbackDescription: null };
}
