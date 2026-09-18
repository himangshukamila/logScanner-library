// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampPanelGeometry, initialPanelGeometry, usePanelGeometry } from '../src/react/usePanelGeometry.js';

function GeometryHarness({ open = true }: { open?: boolean }) {
  const panel = usePanelGeometry(open);
  const [escapeSeen, setEscapeSeen] = useState(false);
  return (
    <div onKeyDown={(event) => { if (event.key === 'Escape') setEscapeSeen(true); }}>
      {open && <section ref={panel.panelRef} style={panel.style}>
        <button type="button" {...panel.dragProps}>Move panel</button>
        <button type="button" {...panel.resizeProps}>Resize panel</button>
        <button type="button" {...panel.resizeStartProps}>Resize panel from top left</button>
      </section>}
      <output aria-label="Geometry">{JSON.stringify(panel.geometry)}</output>
      <output aria-label="Interaction">{panel.interaction ?? 'idle'}</output>
      <output aria-label="Escape handled">{String(escapeSeen)}</output>
    </div>
  );
}

function readGeometry() {
  return JSON.parse(screen.getByLabelText('Geometry').textContent ?? 'null') as ReturnType<typeof initialPanelGeometry>;
}

function viewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

function pointer(target: HTMLElement, type: string, pointerId: number, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } });
  fireEvent(target, event);
}

const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;
const captures = new WeakMap<HTMLElement, number>();

beforeEach(() => {
  // Geometry now survives reload, so each test has to start from an empty session.
  window.sessionStorage.clear();
  viewport(1200, 900);
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn(function (this: HTMLElement, id: number) { captures.set(this, id); }) },
    hasPointerCapture: { configurable: true, value: vi.fn(function (this: HTMLElement, id: number) { return captures.get(this) === id; }) },
    releasePointerCapture: { configurable: true, value: vi.fn(function (this: HTMLElement) { captures.delete(this); }) },
  });
});

afterEach(() => {
  cleanup();
  viewport(originalWidth, originalHeight);
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
  Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture');
  Reflect.deleteProperty(HTMLElement.prototype, 'releasePointerCapture');
  vi.restoreAllMocks();
});

describe('panel geometry', () => {
  it('starts above the launcher and clamps to small viewports', () => {
    expect(initialPanelGeometry({ width: 1200, height: 900 })).toEqual({ x: 540, y: 312, width: 640, height: 512 });
    expect(initialPanelGeometry({ width: 300, height: 320 })).toEqual({ x: 12, y: 12, width: 276, height: 240 });
    expect(clampPanelGeometry({ x: -10, y: 10_000, width: 100, height: 900 }, { width: 1200, height: 900 }))
      .toEqual({ x: 20, y: 20, width: 320, height: 804 });
  });

  it('docks into the launcher corner and reserves that edge', () => {
    const viewportSize = { width: 1200, height: 900 };
    expect(initialPanelGeometry(viewportSize, 'bottom-left')).toEqual({ x: 20, y: 312, width: 640, height: 512 });
    expect(initialPanelGeometry(viewportSize, 'top-right')).toEqual({ x: 540, y: 76, width: 640, height: 512 });
    expect(initialPanelGeometry(viewportSize, 'top-left')).toEqual({ x: 20, y: 76, width: 640, height: 512 });
    // A top launcher reserves the top edge, so the panel cannot slide underneath it.
    expect(clampPanelGeometry({ x: 0, y: 0, width: 640, height: 512 }, viewportSize, 'top-left').y).toBe(76);
    expect(clampPanelGeometry({ x: 0, y: 0, width: 640, height: 512 }, viewportSize, 'bottom-left').y).toBe(20);
  });

  it('restores a stored rectangle on the next session and clamps it to the viewport', () => {
    render(<GeometryHarness />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move panel' }), { key: 'ArrowLeft' });
    const moved = readGeometry();
    expect(JSON.parse(window.sessionStorage.getItem('logscan.panel-geometry.v1') ?? 'null')).toEqual(moved);

    cleanup();
    render(<GeometryHarness />);
    expect(readGeometry()).toEqual(moved);

    cleanup();
    window.sessionStorage.setItem('logscan.panel-geometry.v1', JSON.stringify({ x: 9_000, y: 9_000, width: 5_000, height: 5_000 }));
    render(<GeometryHarness />);
    expect(readGeometry()).toEqual({ x: 20, y: 20, width: 1160, height: 804 });
  });

  it('ignores unusable stored geometry instead of failing to open', () => {
    window.sessionStorage.setItem('logscan.panel-geometry.v1', '{"x":"left","y":null}');
    render(<GeometryHarness />);
    expect(readGeometry()).toEqual(initialPanelGeometry({ width: 1200, height: 900 }));
    cleanup();

    window.sessionStorage.setItem('logscan.panel-geometry.v1', 'not json');
    render(<GeometryHarness />);
    expect(readGeometry()).toEqual(initialPanelGeometry({ width: 1200, height: 900 }));
  });

  it('supports precise keyboard movement and anchored resizing without swallowing Escape', () => {
    render(<GeometryHarness />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move panel' }), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move panel' }), { key: 'ArrowUp', shiftKey: true });
    expect(readGeometry()).toEqual({ x: 530, y: 311, width: 640, height: 512 });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize panel' }), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize panel' }), { key: 'ArrowDown' });
    expect(readGeometry()).toEqual({ x: 530, y: 311, width: 650, height: 513 });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move panel' }), { key: 'Escape' });
    expect(screen.getByLabelText('Escape handled')).toHaveTextContent('true');
  });

  it('keeps geometry across close and reopen and clamps after viewport changes', () => {
    const { rerender } = render(<GeometryHarness />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move panel' }), { key: 'ArrowLeft' });
    const moved = readGeometry();
    rerender(<GeometryHarness open={false} />);
    rerender(<GeometryHarness />);
    expect(readGeometry()).toEqual(moved);
    act(() => { viewport(350, 400); window.dispatchEvent(new Event('resize')); });
    expect(readGeometry()).toEqual({ x: 12, y: 12, width: 326, height: 320 });
  });

  it('captures one pointer, ignores another pointer, and stops movement after cancel', () => {
    render(<GeometryHarness />);
    const handle = screen.getByRole('button', { name: 'Move panel' });
    pointer(handle, 'pointerdown', 7, 600, 350);
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    expect(screen.getByLabelText('Interaction')).toHaveTextContent('drag');
    pointer(handle, 'pointermove', 8, 0, 0);
    expect(readGeometry().x).toBe(540);
    pointer(handle, 'pointermove', 7, 500, 250);
    expect(readGeometry()).toEqual({ x: 440, y: 212, width: 640, height: 512 });
    pointer(handle, 'pointercancel', 7, 500, 250);
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(screen.getByLabelText('Interaction')).toHaveTextContent('idle');
    pointer(handle, 'pointermove', 7, 100, 100);
    expect(readGeometry().x).toBe(440);
  });

  it('resizes with its top-left fixed and enforces minimum sizes', () => {
    render(<GeometryHarness />);
    const handle = screen.getByRole('button', { name: 'Resize panel' });
    pointer(handle, 'pointerdown', 1, 1180, 824);
    pointer(handle, 'pointermove', 1, 10, 10);
    expect(readGeometry()).toEqual({ x: 540, y: 312, width: 320, height: 280 });
    pointer(handle, 'pointermove', 1, 2000, 2000);
    expect(readGeometry()).toEqual({ x: 540, y: 312, width: 640, height: 512 });
    pointer(handle, 'pointerup', 1, 2000, 2000);
    expect(screen.getByLabelText('Interaction')).toHaveTextContent('idle');
  });

  it('releases pointer capture and removes the viewport listener on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<GeometryHarness />);
    const handle = screen.getByRole('button', { name: 'Move panel' });
    pointer(handle, 'pointerdown', 3, 600, 350);
    unmount();
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(3);
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('grows a docked panel from its top-left corner while preserving its right and bottom edges', () => {
    render(<GeometryHarness />);
    const handle = screen.getByRole('button', { name: 'Resize panel from top left' });
    pointer(handle, 'pointerdown', 2, 540, 312);
    pointer(handle, 'pointermove', 2, 440, 212);
    expect(readGeometry()).toEqual({ x: 440, y: 212, width: 740, height: 612 });
    expect(screen.getByLabelText('Interaction')).toHaveTextContent('resize');
    pointer(handle, 'pointermove', 2, -100, -100);
    expect(readGeometry()).toEqual({ x: 20, y: 20, width: 1160, height: 804 });
    pointer(handle, 'pointermove', 2, 2000, 2000);
    expect(readGeometry()).toEqual({ x: 860, y: 544, width: 320, height: 280 });
    pointer(handle, 'pointerup', 2, 2000, 2000);
    expect(screen.getByLabelText('Interaction')).toHaveTextContent('idle');
  });

  it('moves the top-left resize corner with keyboard arrows and Shift precision', () => {
    render(<GeometryHarness />);
    const handle = screen.getByRole('button', { name: 'Resize panel from top left' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true });
    expect(readGeometry()).toEqual({ x: 530, y: 311, width: 650, height: 513 });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
    expect(readGeometry()).toEqual({ x: 540, y: 312, width: 640, height: 512 });
  });
});
