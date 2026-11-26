'use client';

import React, { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { resolveCodeLanguage } from '@/lib/code-language';

interface CodeEditorProps {
  filename: string;
  value: string;
  onChange: (nextValue: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
}

const cmntyEditorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#09090B',
      color: '#f4f4f5',
      fontSize: '12px',
      fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      minHeight: '420px',
    },
    '.cm-scroller': {
      overflow: 'auto',
      minHeight: '420px',
      maxHeight: '65vh',
      fontFamily: 'inherit',
      lineHeight: '1.6',
    },
    '.cm-content': {
      padding: '12px 0',
      caretColor: '#f4f4f5',
    },
    '.cm-line': {
      padding: '0 14px 0 8px',
    },
    '.cm-gutters': {
      backgroundColor: '#0C0C0F',
      color: '#52525b',
      borderRight: '1px solid #1f242d',
      minWidth: '42px',
      userSelect: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#141820',
      color: '#e4e4e7',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(56, 189, 248, 0.22) !important',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-panels': {
      backgroundColor: '#111318',
      color: '#e4e4e7',
      borderTop: '1px solid #27272a',
      borderBottom: '1px solid #27272a',
    },
    '.cm-textfield': {
      backgroundColor: '#09090B',
      color: '#f4f4f5',
      border: '1px solid #3f3f46',
      borderRadius: '4px',
    },
    '.cm-button': {
      backgroundImage: 'none',
      backgroundColor: '#27272a',
      color: '#f4f4f5',
      border: '1px solid #3f3f46',
      borderRadius: '4px',
    },
  },
  { dark: true }
);

export default function CodeEditor({
  filename,
  value,
  onChange,
  onSave,
  readOnly = false,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());
  const labelCompartmentRef = useRef(new Compartment());

  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const latestValueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    const langComp = languageCompartmentRef.current;
    const readOnlyComp = readOnlyCompartmentRef.current;
    const labelComp = labelCompartmentRef.current;

    const state = EditorState.create({
      doc: latestValueRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        oneDark,
        cmntyEditorTheme,
        langComp.of([]),
        readOnlyComp.of([]),
        labelComp.of([]),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const nextDoc = update.state.doc.toString();
            latestValueRef.current = nextDoc;
            onChangeRef.current(nextDoc);
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: container,
    });
    viewRef.current = view;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: labelCompartmentRef.current.reconfigure(
        EditorView.contentAttributes.of({
          'aria-label': `Editor kode untuk ${filename}`,
          spellcheck: 'false',
        })
      ),
    });

    const resolved = resolveCodeLanguage(filename);
    if (resolved.support) {
      view.dispatch({
        effects: languageCompartmentRef.current.reconfigure(resolved.support),
      });
      return;
    }

    if (!resolved.fallbackDescription) {
      view.dispatch({
        effects: languageCompartmentRef.current.reconfigure([]),
      });
      return;
    }

    let cancelled = false;
    try {
      void resolved.fallbackDescription
        .load()
        .then((support) => {
          if (cancelled || !viewRef.current) return;
          viewRef.current.dispatch({
            effects: languageCompartmentRef.current.reconfigure(support),
          });
        })
        .catch(() => {
          if (cancelled || !viewRef.current) return;
          viewRef.current.dispatch({
            effects: languageCompartmentRef.current.reconfigure([]),
          });
        });
    } catch {
      view.dispatch({
        effects: languageCompartmentRef.current.reconfigure([]),
      });
    }

    return () => {
      cancelled = true;
    };
  }, [filename]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (value !== currentDoc) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
      latestValueRef.current = value;
    }
  }, [value]);

  return (
    <div
      ref={hostRef}
      data-testid="code-editor"
      data-language={resolveCodeLanguage(filename).name}
      className="w-full min-h-[420px] bg-[#09090B] text-zinc-100"
    />
  );
}
