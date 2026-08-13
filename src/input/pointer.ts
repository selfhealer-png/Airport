import { deviceRatio, screenToTile, zoomAt, type Camera } from '@/render/camera';
import type { TileIndex } from '@/sim/types';

const TAP_MOVE_TOLERANCE_PX = 8;
const TAP_DURATION_MS = 300;

interface ActivePointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
  startedAt: number;
  moved: boolean;
}

export interface PointerHandlers {
  /**
   * Whether a one-finger drag should build rather than pan. Checked when the finger goes
   * down, so releasing a tool mid-drag cannot strand the gesture.
   */
  isBuilding?(): boolean;
  onBuildStart?(tile: TileIndex): void;
  onBuildMove?(tile: TileIndex): void;
  onBuildEnd?(): void;
  /** A press that did not turn into a drag or a pinch. */
  onTap?(tile: TileIndex): void;
  /**
   * The player has panned or zoomed, and the view is now theirs.
   *
   * Until this fires the app keeps re-framing the map to fit; afterwards it must never move
   * the camera again on its own.
   */
  onCameraMoved?(): void;
}

/**
 * Touch and mouse control for the map.
 *
 * One finger drags: it pans normally, or draws out a build when a tool is selected. Two
 * fingers always pinch to zoom, even mid-build, so the player can frame a long runway
 * without putting the tool down.
 *
 * Zoom snaps to whole device pixels per sprite pixel, so a pinch steps through zoom levels
 * rather than sliding
 * continuously. That is the price of crisp pixel art, and the steps are large enough on a
 * phone to read as intentional.
 */
export function attachPointerControls(
  element: HTMLElement,
  camera: Camera,
  handlers: PointerHandlers = {},
): () => void {
  const pointers = new Map<number, ActivePointer>();
  let pinchStartDistance = 0;
  let pinchStartScale = 0;
  let building = false;

  const distance = (a: ActivePointer, b: ActivePointer): number =>
    Math.hypot(a.x - b.x, a.y - b.y);

  const localPoint = (event: PointerEvent): { x: number; y: number } => {
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const tileAt = (x: number, y: number): TileIndex => screenToTile(camera, x, y);

  const endBuild = (): void => {
    if (!building) return;
    building = false;
    handlers.onBuildEnd?.();
  };

  const onPointerDown = (event: PointerEvent): void => {
    element.setPointerCapture(event.pointerId);
    const { x, y } = localPoint(event);
    pointers.set(event.pointerId, {
      x, y, startX: x, startY: y, startedAt: performance.now(), moved: false,
    });

    if (pointers.size === 1 && handlers.isBuilding?.()) {
      building = true;
      handlers.onBuildStart?.(tileAt(x, y));
      return;
    }

    if (pointers.size === 2) {
      // A second finger converts the gesture into a pinch, abandoning any build in progress.
      endBuild();
      const [a, b] = [...pointers.values()] as [ActivePointer, ActivePointer];
      pinchStartDistance = distance(a, b);
      pinchStartScale = camera.scale;
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;

    const { x, y } = localPoint(event);
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    pointer.x = x;
    pointer.y = y;
    if (Math.hypot(x - pointer.startX, y - pointer.startY) > TAP_MOVE_TOLERANCE_PX) {
      pointer.moved = true;
    }

    if (pointers.size === 1) {
      if (building) {
        handlers.onBuildMove?.(tileAt(x, y));
      } else {
        camera.x -= dx / camera.scale;
        camera.y -= dy / camera.scale;
        handlers.onCameraMoved?.();
      }
      return;
    }

    if (pointers.size === 2 && pinchStartDistance > 0) {
      const [a, b] = [...pointers.values()] as [ActivePointer, ActivePointer];
      const ratio = distance(a, b) / pinchStartDistance;
      zoomAt(camera, (a.x + b.x) / 2, (a.y + b.y) / 2, pinchStartScale * ratio, deviceRatio());
      handlers.onCameraMoved?.();
    }
  };

  const endPointer = (event: PointerEvent): void => {
    const pointer = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    if (pointers.size < 2) pinchStartDistance = 0;
    if (!pointer) return;

    if (building && pointers.size === 0) {
      endBuild();
      return;
    }

    const wasTap =
      !pointer.moved &&
      performance.now() - pointer.startedAt < TAP_DURATION_MS &&
      pointers.size === 0;
    if (wasTap) handlers.onTap?.(tileAt(pointer.x, pointer.y));
  };

  // Desktop convenience; the phone build never sees this.
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    // One device step per notch, not one CSS pixel: at a fractional zoom a whole CSS pixel
    // per sprite pixel is several zoom levels at once.
    const dpr = deviceRatio();
    const step = (event.deltaY < 0 ? 1 : -1) / dpr;
    zoomAt(camera, event.clientX - rect.left, event.clientY - rect.top, camera.scale + step, dpr);
    handlers.onCameraMoved?.();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', endPointer);
  element.addEventListener('pointercancel', endPointer);
  element.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', endPointer);
    element.removeEventListener('pointercancel', endPointer);
    element.removeEventListener('wheel', onWheel);
  };
}
