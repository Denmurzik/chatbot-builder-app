import type { Edge } from '@xyflow/react';
import { blockWrites, type Block } from '@chatbot/model';
import { ru } from '@/i18n/ru';
import { cn } from '@/lib/utils';
import { safeOutputs, type BlockNode } from '../convert';
import { outputLabel } from '../output-label';
import { previewBlock } from './output-preview';

const t = ru.blockDialog;

interface OutputPaneProps {
  node: BlockNode;
  nodes: BlockNode[];
  edges: Edge[];
  testValues: Record<string, string>;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="border-b pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

// Правая колонка: что блок отдаёт дальше — переменные, выходы и предпросмотр
export function OutputPane({ node, nodes, edges, testValues }: OutputPaneProps) {
  const block = { ...node.data, id: node.id, x: 0, y: 0 } as Block;
  const writes = blockWrites(block);
  const outputs = safeOutputs(node.data);
  const preview = previewBlock(node.data, testValues);
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.data.title ?? id;
  const targetOf = (output: string) =>
    edges.find((edge) => edge.source === node.id && edge.sourceHandle === output)?.target;

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <SectionTitle>{t.writes}</SectionTitle>
        {writes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.writesNone}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {writes.map((name) => (
              <li key={name}>
                <code className="rounded bg-muted px-1.5 py-0.5 text-sm">{name}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle>{t.outputs}</SectionTitle>
        {outputs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.outputsNone}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {outputs.map((output) => {
              const target = targetOf(output);
              return (
                <li
                  key={output}
                  data-active={preview.branch === output ? 'true' : undefined}
                  className={cn(
                    'flex flex-col rounded-md border px-2 py-1.5 text-sm',
                    preview.branch === output && 'border-primary bg-primary/10',
                  )}
                >
                  <span className="font-medium">{outputLabel(node.data.type, output)}</span>
                  <span className="text-xs text-muted-foreground">
                    {target ? t.leadsTo(titleOf(target)) : t.notConnected}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label={t.preview}>
        <SectionTitle>{t.preview}</SectionTitle>
        <p className="text-xs text-muted-foreground">{t.previewHint}</p>
        {preview.error && (
          <p role="status" className="text-sm text-destructive">
            {preview.error}
          </p>
        )}
        {preview.branch && (
          <p role="status" className="text-sm font-medium">
            {t.previewBranch(outputLabel(node.data.type, preview.branch))}
          </p>
        )}
        {preview.rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{row.label}</span>
            <pre className="rounded-md bg-muted p-2 text-sm break-words whitespace-pre-wrap">
              {row.value}
            </pre>
          </div>
        ))}
        {preview.buttons.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t.previewOptions}</span>
            <div className="flex flex-wrap gap-1.5">
              {preview.buttons.map((button) => (
                <span key={button} className="rounded-full border px-3 py-1 text-sm">
                  {button}
                </span>
              ))}
            </div>
          </div>
        )}
        {!preview.error &&
          !preview.branch &&
          preview.rows.length === 0 &&
          preview.buttons.length === 0 && (
            <p className="text-sm text-muted-foreground">{t.previewEmpty}</p>
          )}
      </section>
    </div>
  );
}
