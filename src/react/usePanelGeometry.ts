import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { readSession, writeSession } from './session.js';

export interface PanelGeometry { x: number; y: number; width: number; height: number }
export interface PanelViewport { width: number; height: number }
export type LauncherPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
type Interaction = 'drag' | 'resize';
type GestureKind = Interaction | 'resize-start';
type HandleProps = Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture' | 'onKeyDown'>;

interface Gesture {
  kind: GestureKind;
  pointerId: number;
  target: HTMLButtonElement;
  startX: number;
  startY: number;
  geometry: PanelGeometry;
}

const STORAGE_KEY = 'logscan.panel-geometry.v1';

function boundsFor(viewport: PanelViewport, position: LauncherPosition = 'bottom-right') {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const gutter = Math.min(width >= 640 ? 20 : 12, Math.floor((Math.min(width, height) - 1) / 2));
  // Reserve the launcher's corner on whichever edge it occupies.
  const launcherSpace = Math.min(56, Math.max(0, height - gutter * 2 - 1));
  const atTop = position.startsWith('top');
  return {
    gutter,
    left: gutter,
    top: gutter + (atTop ? launcherSpace : 0),
    right: width - gutter,
    bottom: height - gutter - (atTop ? 0 : launcherSpace),
    width: width - gutter * 2,
    height: height - gutter * 2 - launcherSpace,
  };
}

function readStoredGeometry(): PanelGeometry | null {
  const value = readSession(STORAGE_KEY);
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  // Stored values are editable by hand, so treat them as untrusted input.
  if (![x, y, width, height].every((part) => typeof part === 'number' && Number.isFinite(part))) return null;
  return { x, y, width, height } as PanelGeometry;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Keep the complete panel in view, including when its viewport becomes smaller. */
export function clampPanelGeometry(geometry: PanelGeometry, viewport: PanelViewport, position?: LauncherPosition): PanelGeometry {
  const bounds = boundsFor(viewport, position);
  const width = clamp(geometry.width, Math.min(320, bounds.width), bounds.width);
  const height = clamp(geometry.height, Math.min(280, bounds.height), bounds.height);
  return {
    x: clamp(geometry.x, bounds.left, bounds.right - width),
    y: clamp(geometry.y, bounds.top, bounds.bottom - height),
    width,
    height,
  };
}

/** Dock the panel into the launcher's corner so both stay reachable together. */
export function initialPanelGeometry(viewport: PanelViewport, position: LauncherPosition = 'bottom-right'): PanelGeometry {
  const bounds = boundsFor(viewport, position);
  const width = Math.min(640, bounds.width);
  const height = Math.min(512, bounds.height);
  return {
    x: position.endsWith('right') ? bounds.right - width : bounds.left,
    y: position.startsWith('top') ? bounds.top : bounds.bottom - height,
    width,
    height,
  };
}

function changeGeometry(geometry: PanelGeometry, kind: GestureKind, dx: number, dy: number, viewport: PanelViewport, position: LauncherPosition): PanelGeometry {
  if (kind === 'drag') {
    return clampPanelGeometry({ ...geometry, x: geometry.x + dx, y: geometry.y + dy }, viewport, position);
  }
  const bounds = boundsFor(viewport, position);
  if (kind === 'resize-start') {
    const right = geometry.x + geometry.width;
    const bottom = geometry.y + geometry.height;
    const x = clamp(geometry.x + dx, bounds.left, right - Math.min(320, right - bounds.left));
    const y = clamp(geometry.y + dy, bounds.top, bottom - Math.min(280, bottom - bounds.top));
    return { x, y, width: right - x, height: bottom - y };
  }
  const maxWidth = bounds.right - geometry.x;
  const maxHeight = bounds.bottom - geometry.y;
  return {
    ...geometry,
    width: clamp(geometry.width + dx, Math.min(320, maxWidth), maxWidth),
    height: clamp(geometry.height + dy, Math.min(280, maxHeight), maxHeight),
  };
}

function releaseCapture(gesture: Gesture | null) {
  if (!gesture) return;
  try {
    if (gesture.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
  } catch {
    // The control may have detached or the browser may have released capture already.
  }
}

export function usePanelGeometry(open: boolean, position: LauncherPosition = 'bottom-right') {
  const panelRef = useRef<HTMLElement>(null);
  const geometryRef = useRef<PanelGeometry | null>(null);
  const viewportRef = useRef<PanelViewport | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [geometry, setGeometry] = useState<PanelGeometry | null>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);

  useEffect(() => {
    if (!open) {
      setInteraction(null);
      return;
    }

    function measure() {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      releaseCapture(gesture);
      setInteraction(null);
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      viewportRef.current = viewport;
      // A stored rectangle survives reload; it is still clamped to the viewport it reopens in.
      const remembered = geometryRef.current ?? readStoredGeometry();
      const next = remembered
        ? clampPanelGeometry(remembered, viewport, position)
        : initialPanelGeometry(viewport, position);
      geometryRef.current = next;
      setGeometry(next);
    }

    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      const gesture = gestureRef.current;
      gestureRef.current = null;
      releaseCapture(gesture);
    };
  }, [open, position]);

  function publish(next: PanelGeometry) {
    geometryRef.current = next;
    setGeometry(next);
  }

  /** Persist once a gesture settles rather than on every pointer sample. */
  function remember() {
    if (geometryRef.current) writeSession(STORAGE_KEY, geometryRef.current);
  }

  function startGesture(kind: GestureKind, event: PointerEvent<HTMLButtonElement>) {
    if (!open || event.button !== 0 || event.isPrimary === false || gestureRef.current || !geometryRef.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const gesture: Gesture = {
      kind,
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      geometry: geometryRef.current,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    gestureRef.current = gesture;
    setInteraction(kind === 'drag' ? 'drag' : 'resize');
  }

  function movePointer(event: PointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current;
    const viewport = viewportRef.current;
    if (!gesture || !viewport || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    publish(changeGeometry(gesture.geometry, gesture.kind, event.clientX - gesture.startX, event.clientY - gesture.startY, viewport, position));
  }

  function finishGesture(event: PointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gestureRef.current = null;
    releaseCapture(gesture);
    setInteraction(null);
    remember();
  }

  function moveKeyboard(kind: GestureKind, event: KeyboardEvent<HTMLButtonElement>) {
    if (!open || !geometryRef.current || !viewportRef.current || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 1 : 10;
    const movement: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const delta = movement[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const gesture = gestureRef.current;
    gestureRef.current = null;
    releaseCapture(gesture);
    setInteraction(null);
    publish(changeGeometry(geometryRef.current, kind, delta[0], delta[1], viewportRef.current, position));
    remember();
  }

  function handleProps(kind: GestureKind): HandleProps {
    return {
      onPointerDown: (event) => startGesture(kind, event),
      onPointerMove: movePointer,
      onPointerUp: finishGesture,
      onPointerCancel: finishGesture,
      onLostPointerCapture: finishGesture,
      onKeyDown: (event) => moveKeyboard(kind, event),
    };
  }

  const style: CSSProperties = geometry
    ? { left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height }
    : { visibility: 'hidden' };

  return {
    panelRef, geometry, style, interaction,
    dragProps: handleProps('drag'),
    resizeProps: handleProps('resize'),
    resizeStartProps: handleProps('resize-start'),
  };
}
