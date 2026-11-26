'use client';

import React, { useLayoutEffect, useRef } from 'react';
import $ from 'jquery';
import { tokenizeConsoleLine } from '@/lib/console-highlight';

interface JqueryHighlightedTextProps {
  text: string;
  defaultClass?: string;
  emptyFallback?: string;
}

export default function JqueryHighlightedText({
  text,
  defaultClass = '',
  emptyFallback = '\u00A0',
}: JqueryHighlightedTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const $container = $(el);
    $container.empty();

    if (!text) {
      $container.append($('<span>').text(emptyFallback));
      return;
    }

    const tokens = tokenizeConsoleLine(text, defaultClass);
    if (tokens.length === 0) {
      $container.append($('<span>').text(emptyFallback));
      return;
    }

    const nodes: HTMLElement[] = [];
    for (const tok of tokens) {
      const $span = $('<span>').text(tok.text);
      if (tok.className) {
        $span.addClass(tok.className);
      }
      if (tok.style) {
        $span.css(tok.style as Record<string, string | number>);
      }
      const domNode = $span.get(0);
      if (domNode) {
        nodes.push(domNode);
      }
    }

    $container.append(nodes);
  }, [text, defaultClass, emptyFallback]);

  return <span ref={containerRef} data-jquery-highlight="true" />;
}
