// Keyboard and pointer input. Held keys steer the plane; one-shot presses
// (drop cargo, restart, pause, camera, confirm) are queued as bit flags and
// taken once by the loop, so a press between two frames is never lost and
// never counted twice.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_RESTART = 4;
export const ACTION_DROP = 8;
export const ACTION_CAMERA = 16;
export const ACTION_MUTE = 32;

const THROTTLE_UP = new Set(['KeyW']);
const THROTTLE_DOWN = new Set(['KeyS']);
const BANK_LEFT = new Set(['KeyA']);
const BANK_RIGHT = new Set(['KeyD']);
const PITCH_UP = new Set(['ArrowUp']);
const PITCH_DOWN = new Set(['ArrowDown']);
const BOOST = new Set(['ShiftLeft', 'ShiftRight']);
const CONFIRM = new Set(['Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const RESTART = new Set(['KeyR']);
const DROP = new Set(['Space']);
const CAMERA = new Set(['KeyC']);
const MUTE = new Set(['KeyM']);

export function createInput(target) {
  const held = new Set();
  let actions = 0;
  let mouseX = 0;
  let mouseActive = false;

  function onKeyDown(event) {
    if (event.repeat) {
      if (THROTTLE_UP.has(event.code) || THROTTLE_DOWN.has(event.code) ||
          BANK_LEFT.has(event.code) || BANK_RIGHT.has(event.code) ||
          PITCH_UP.has(event.code) || PITCH_DOWN.has(event.code) ||
          BOOST.has(event.code)) {
        held.add(event.code);
        event.preventDefault();
      }
      return;
    }
    if (CONFIRM.has(event.code)) actions |= ACTION_CONFIRM;
    else if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
    else if (RESTART.has(event.code)) actions |= ACTION_RESTART;
    else if (DROP.has(event.code)) actions |= ACTION_DROP;
    else if (CAMERA.has(event.code)) actions |= ACTION_CAMERA;
    else if (MUTE.has(event.code)) actions |= ACTION_MUTE;
    else if (THROTTLE_UP.has(event.code) || THROTTLE_DOWN.has(event.code) ||
        BANK_LEFT.has(event.code) || BANK_RIGHT.has(event.code) ||
        PITCH_UP.has(event.code) || PITCH_DOWN.has(event.code) ||
        BOOST.has(event.code)) {
      held.add(event.code);
    } else {
      return;
    }
    event.preventDefault();
  }

  function onKeyUp(event) {
    held.delete(event.code);
  }

  function onBlur() {
    held.clear();
    mouseActive = false;
  }

  function onPointerMove(event) {
    mouseX = event.clientX / Math.max(1, window.innerWidth) - 0.5;
    mouseActive = true;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointermove', onPointerMove);
  if (target) {
    target.addEventListener('pointerdown', () => {
      actions |= ACTION_CONFIRM;
    });
  }

  function hasAny(set) {
    for (const code of set) if (held.has(code)) return true;
    return false;
  }

  return {
    /** -1 throttle down, +1 throttle up, 0 neither. */
    throttleAxis() {
      return (hasAny(THROTTLE_UP) ? 1 : 0) - (hasAny(THROTTLE_DOWN) ? 1 : 0);
    },
    /** -1 bank left, +1 bank right, 0 neither (mouse nudges the same axis). */
    bankAxis() {
      let value = (hasAny(BANK_RIGHT) ? 1 : 0) - (hasAny(BANK_LEFT) ? 1 : 0);
      if (value === 0 && mouseActive) value = Math.max(-1, Math.min(1, mouseX * 1.6));
      return value;
    },
    /** -1 pitch down, +1 pitch up, 0 neither. */
    pitchAxis() {
      return (hasAny(PITCH_UP) ? 1 : 0) - (hasAny(PITCH_DOWN) ? 1 : 0);
    },
    boost() {
      return hasAny(BOOST);
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
