import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, Decoration, type DecorationSet, gutter, GutterMarker, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export interface Marks {
  /** line that will run next (1-based), or 0 */
  exec: number;
  /** lines with problems at the current moment */
  diags: Array<{ line: number; severity: 'error' | 'warn' | 'info' }>;
  /** compile error line */
  error: number;
}

const setMarks = StateEffect.define<Marks>();

class Dot extends GutterMarker {
  constructor(readonly kind: string) { super(); }
  override toDOM() { const s = document.createElement('span'); s.className = 'cm-marker ' + this.kind; return s; }
  override eq(o: Dot) { return o.kind === this.kind; }
}

const marksField = StateField.define<{ marks: Marks; deco: DecorationSet }>({
  create: () => ({ marks: { exec: 0, diags: [], error: 0 }, deco: Decoration.none }),
  update(v, tr) {
    for (const e of tr.effects) {
      if (e.is(setMarks)) {
        const m = e.value;
        const doc = tr.state.doc;
        const ranges: Array<ReturnType<ReturnType<typeof Decoration.line>['range']>> = [];
        const addLine = (n: number, cls: string) => { if (n >= 1 && n <= doc.lines) ranges.push(Decoration.line({ class: cls }).range(doc.line(n).from)); };
        for (const d of m.diags) addLine(d.line, d.severity === 'error' ? 'cm-diag-err' : 'cm-diag-warn');
        if (m.error) addLine(m.error, 'cm-diag-err');
        addLine(m.exec, 'cm-exec-line');
        return { marks: m, deco: Decoration.set(ranges, true) };
      }
    }
    return tr.docChanged ? { marks: v.marks, deco: v.deco.map(tr.changes) } : v;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

const markGutter = gutter({
  class: 'cm-markgutter',
  lineMarker(view, line) {
    const n = view.state.doc.lineAt(line.from).number;
    const m = view.state.field(marksField).marks;
    if (m.exec === n) return new Dot('exec');
    if (m.error === n) return new Dot('err');
    const d = m.diags.find((x) => x.line === n);
    if (d) return new Dot(d.severity === 'error' ? 'err' : 'warn');
    return null;
  },
  lineMarkerChange: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(setMarks))),
  initialSpacer: () => new Dot('exec'),
});

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier], color: 'var(--syn-keyword)', fontWeight: '500' },
  { tag: [t.typeName, t.standard(t.typeName), t.className], color: 'var(--syn-type)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.string, t.character, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--syn-pre)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-fn)', fontWeight: '600' },
  { tag: t.operator, color: 'var(--muted)' },
]);

interface Props {
  value: string;
  onChange(v: string): void;
  marks: Marks;
  onRun(): void;
  readOnly?: boolean;
}

export function Editor({ value, onChange, marks, onRun, readOnly }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onRun });
  cb.current = { onChange, onRun };

  useEffect(() => {
    const exts: Extension[] = [
      lineNumbers(),
      markGutter,
      marksField,
      history(),
      drawSelection(),
      bracketMatching(),
      indentUnit.of('  '),
      cpp(),
      syntaxHighlighting(highlight),
      EditorState.tabSize.of(2),
      Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { cb.current.onRun(); return true; } }])),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()); }),
      EditorView.contentAttributes.of({ 'aria-label': 'C++ source code', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      EditorState.readOnly.of(!!readOnly),
    ];
    view.current = new EditorView({ state: EditorState.create({ doc: value, extensions: exts }), parent: host.current! });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // external edits (loading an example) replace the document
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: setMarks.of(marks) });
    if (marks.exec >= 1 && marks.exec <= v.state.doc.lines) {
      const pos = v.state.doc.line(marks.exec).from;
      v.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'nearest', yMargin: 70 }) });
    }
  }, [marks.exec, marks.error, marks.diags.map((d) => d.line + d.severity).join(',')]);

  return <div className="editor-wrap" ref={host} />;
}
