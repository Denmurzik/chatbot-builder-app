import { Position, ReactFlowProvider, type EdgeProps } from '@xyflow/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ru } from '@/i18n/ru';
import { EdgeButtons, ScenarioEdge } from './ScenarioEdge';

describe('EdgeButtons', () => {
  afterEach(() => {
    cleanup();
  });

  it('рендерит кнопки вставки и удаления и вызывает обработчики', () => {
    const onInsert = vi.fn();
    const onDelete = vi.fn();

    render(<EdgeButtons visible onInsert={onInsert} onDelete={onDelete} />);

    const insertBtn = screen.getByRole('button', { name: ru.editor.insertOnEdge });
    const deleteBtn = screen.getByRole('button', { name: ru.editor.deleteEdge });

    fireEvent.click(insertBtn);
    expect(onInsert).toHaveBeenCalledTimes(1);

    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('скрывает кнопки, когда visible=false', () => {
    render(<EdgeButtons visible={false} onInsert={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.queryByRole('button', { name: ru.editor.deleteEdge })).toBeNull();
    expect(screen.queryByRole('button', { name: ru.editor.insertOnEdge })).toBeNull();
  });
});

describe('ScenarioEdge', () => {
  afterEach(() => {
    cleanup();
  });

  it('рисует стрелку (markerEnd) и меняет цвет маркера при выделении', () => {
    const baseProps: EdgeProps = {
      id: 'entry::default',
      source: 'entry',
      target: 'msg_1',
      sourceX: 200,
      sourceY: 60,
      targetX: 400,
      targetY: 60,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      selected: false,
    };

    const { container, rerender } = render(
      <ReactFlowProvider>
        <svg>
          <ScenarioEdge {...baseProps} />
        </svg>
      </ReactFlowProvider>,
    );

    const path = container.querySelector('.react-flow__edge-path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('marker-end')).toMatch(/^url\(#.+\)$/);

    const markerPath = container.querySelector('marker path');
    expect(markerPath).toBeTruthy();
    const normalFill = markerPath?.getAttribute('fill');

    rerender(
      <ReactFlowProvider>
        <svg>
          <ScenarioEdge {...baseProps} selected />
        </svg>
      </ReactFlowProvider>,
    );

    const selectedFill = container.querySelector('marker path')?.getAttribute('fill');
    expect(selectedFill).not.toBe(normalFill);
  });

  it('учитывает пользовательский style.stroke (подсветка связей в превью)', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <ScenarioEdge
            id="entry::preview"
            source="entry"
            target="msg_1"
            sourceX={200}
            sourceY={60}
            targetX={400}
            targetY={60}
            sourcePosition={Position.Right}
            targetPosition={Position.Left}
            selected={false}
            style={{ stroke: 'var(--brand)', strokeWidth: 2 }}
          />
        </svg>
      </ReactFlowProvider>,
    );

    const path = container.querySelector<SVGPathElement>('.react-flow__edge-path');
    expect(path?.style.stroke).toBe('var(--brand)');
    expect(container.querySelector('marker path')?.getAttribute('fill')).toBe('var(--brand)');
  });

  it('прямая связь — плавная кривая, связь назад — ломаная со скруглениями', () => {
    function pathOf(sourceX: number, targetX: number) {
      const { container } = render(
        <ReactFlowProvider>
          <svg>
            <ScenarioEdge
              id="a::b"
              source="a"
              target="b"
              sourceX={sourceX}
              sourceY={60}
              targetX={targetX}
              targetY={60}
              sourcePosition={Position.Right}
              targetPosition={Position.Left}
              selected={false}
            />
          </svg>
        </ReactFlowProvider>,
      );
      const d = container.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? '';
      cleanup();
      return d;
    }

    expect(pathOf(200, 400)).toContain('C');
    expect(pathOf(200, 400)).not.toContain('Q');
    // Блоки вплотную: вход чуть левее выхода — всё равно прямая кривая
    expect(pathOf(400, 395)).toContain('C');
    const backward = pathOf(400, 100);
    expect(backward).toContain('Q');
    expect(backward).not.toContain('C');
  });
});
