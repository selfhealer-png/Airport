import { deviceRatio, screenToTile, zoomAt, type Camera } from '@/render/camera';
import { beginDrag, moveDrag, type BuildAim, type DragState } from './drag';

interface ActivePointer {
  x: number;
  y: number;
}

export interface PointerHandlers {
  /**
   * Whether a one-finger drag should build rather than pan. Checked when the finger goes
   * down, so releasing a tool mid-drag cannot strand the gesture.
   */
  isBuilding?(): boolean;
  /**
   * Whether a drag may move the camera.
   *
   * False when the whole field already fits on screen: there is nothing off the edge to
   * uncover, so a pan can only nudge the map away from centre and leave it there. On a phone
   * that reads as the map drifting for no reason. The pinch is not gated by this — see the
   * note at the two-finger branch.
   */
  canPan?(): boolean;
  /** The build changed: a new anchor, a new end tile, or simply a new crosshair position. */
  onBuildUpdate?(aim: BuildAim): void;
  /**
   * The last finger lifted with the build still live. Commit it.
   *
   * Carries the final aim rather than making the caller keep its own copy, so what is
   * committed is resolved from exactly the values that were last previewed.
   */
  onBuildEnd?(aim: BuildAim): void;
  /**
   * The build was abandoned without committing — a second finger landed, or the browser took
   * the pointer away.
   *
   * This channel did not exist, and its absence was a real bug: `pointercancel` and the
   * second finger of a pinch both routed to the commit path, so a mis-grab or a notification
   * banner mid-drag would build whatever happened to be under the finger. It also gives the
   * gesture the abort it never had — once a drag started there was no way out but to build.
   */
  onBuildCancel?(): void;
  /**
   * The player moved the camera themselves. The app stops re-framing the map after this, so
   * it must fire only when the camera has actually moved.
   */
  onCameraMoved?(): void;
}

/**
 * Touch and mouse control for the map.
 *
 * One finger drags: it pans normally, or draws out a build when a tool is selected. Two
 * fingers pinch to zoom **and** drag to pan — the two compose in one gesture, which is what
 * makes building while zoomed in possible at all. Before that, panning was only available on
 * the gesture that building had already taken, so zooming in to see a tile left you unable to
 * reach the rest of the field.
 */
export function attachPointerControls(
  element: HTMLElement,
  camera: Camera,
  handlers: PointerHandlers = {},
): () => void {
  const pointers = new Map<number, ActivePointer>();
  let pinchDistance = 0;
  let pinchScale = 0;
  let pinchCentre: { x: number; y: number } | null = null;
  let drag: DragState | null = null;

  const distance = (a: ActivePointer, b: ActivePointer): number =>
    Math.hypot(a.x - b.x, a.y - b.y);

  const localPoint = (event: PointerEvent): { x: number; y: number } => {
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const tileAt = (x: number, y: number) => screenToTile(camera, x, y);

  /**
   * Re-reads the two-finger baseline from whichever two pointers are down.
   *
   * Called whenever the set of pointers changes, so adding or lifting a finger mid-gesture
   * re-bases instead of jumping the map. `Map` preserves insertion order, so this always
   * takes the two oldest contacts — a stray third finger or a palm no longer kills the
   * gesture, it is simply ignored.
   */
  const rebasePinch = (): void => {
    if (pointers.size < 2) {
      pinchDistance = 0;
      pinchCentre = null;
      return;
    }
    const [a, b] = [...pointers.values()] as [ActivePointer, ActivePointer];
    pinchDistance = distance(a, b);
    pinchScale = camera.scale;
    pinchCentre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const endDrag = (commit: boolean): void => {
    if (!drag) return;
    const { aim } = drag;
    drag = null;
    if (commit) handlers.onBuildEnd?.(aim);
    else handlers.onBuildCancel?.();
  };

  const onPointerDown = (event: PointerEvent): void => {
    element.setPointerCapture(event.pointerId);
    const { x, y } = localPoint(event);
    pointers.set(event.pointerId, { x, y });

    if (pointers.size === 1 && handlers.isBuilding?.()) {
      drag = beginDrag(x, y, tileAt);
      handlers.onBuildUpdate?.(drag.aim);
      return;
    }

    // A second finger abandons any build in progress rather than committing it. There is no
    // sane rule for which finger would own the build afterwards, and cancelling is what the
    // player means by grabbing the map with a second thumb.
    if (pointers.size >= 2) {
      endDrag(false);
      rebasePinch();
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

    if (pointers.size === 1) {
      if (drag) {
        drag = moveDrag(drag, x, y, tileAt);
        handlers.onBuildUpdate?.(drag.aim);
      } else if (handlers.canPan?.() !== false) {
        camera.x -= dx / camera.scale;
        camera.y -= dy / camera.scale;
        handlers.onCameraMoved?.();
      }
      return;
    }

    if (pointers.size < 2 || pinchDistance <= 0 || !pinchCentre) return;

    const [a, b] = [...pointers.values()] as [ActivePointer, ActivePointer];
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    /*
     * Zoom first, about the midpoint, then translate by how far the midpoint moved. In that
     * order the two compose: `zoomAt` keeps the pixel under the midpoint fixed, so the pan is
     * a clean translation on top of it.
     *
     * The zoom is deliberately NOT gated on `canPan`. Panning only unlocks once the field is
     * bigger than the screen, so gating the zoom too would make that state unreachable and
     * kill zooming outright. The translation IS gated, for the same reason the one-finger
     * drag is: at the fitted zoom there is nothing off the edge to uncover.
     */
    const before = camera.scale;
    zoomAt(camera, centre.x, centre.y, (pinchScale * distance(a, b)) / pinchDistance, deviceRatio());
    let moved = camera.scale !== before;

    if (handlers.canPan?.() !== false) {
      const shiftX = centre.x - pinchCentre.x;
      const shiftY = centre.y - pinchCentre.y;
      if (shiftX !== 0 || shiftY !== 0) {
        camera.x -= shiftX / camera.scale;
        camera.y -= shiftY / camera.scale;
        moved = true;
      }
    }
    // Advanced even when the pan was refused, or a refused pan would accumulate and the map
    // would lurch the instant zooming in unlocked it.
    pinchCentre = centre;

    /*
     * Only when something actually changed. `zoomAt` no-ops when the snapped scale is
     * unchanged, and this used to fire regardless — so resting two fingers on the map and
     * wiggling set `framed` permanently and the map never re-fitted itself again. That is the
     * exact poison the `canPan` gate exists to prevent, leaking in through the other gesture.
     */
    if (moved) handlers.onCameraMoved?.();
  };

  const removePointer = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    rebasePinch();
  };

  const onPointerUp = (event: PointerEvent): void => {
    removePointer(event);
    // Committed only when the last finger leaves. A build never survives a multi-finger
    // gesture, so there is nothing to hand back to a surviving contact.
    if (pointers.size === 0) endDrag(true);
  };

  /**
   * The browser took the pointer away — a notification banner, an edge swipe, a lost capture.
   *
   * Cancels rather than commits. This shared a handler with `pointerup`, which meant an iOS
   * banner arriving mid-drag would build a runway.
   */
  const onPointerCancel = (event: PointerEvent): void => {
    removePointer(event);
    endDrag(false);
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const { x, y } = localPoint(event as unknown as PointerEvent);
    const dpr = deviceRatio();
    const before = camera.scale;
    zoomAt(camera, x, y, camera.scale + (event.deltaY < 0 ? 1 : -1) / dpr, dpr);
    if (camera.scale !== before) handlers.onCameraMoved?.();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('wheel', onWheel);
  };
}
