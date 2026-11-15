export class Input {
  constructor({ canvas, onFirstInteract, onLockChange }) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.look = { x: 0, y: 0 };
    this.actions = [];
    this.enabled = false;
    this.locked = false;
    this.fallback = false;
    this.onFirstInteract = onFirstInteract;
    this.onLockChange = onLockChange;
    this.bind();
  }

  bind() {
    const gameKeys = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight',
      'KeyR', 'Digit1', 'Digit2', 'KeyQ', 'Space',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    ]);

    window.addEventListener('keydown', (e) => {
      this.onFirstInteract?.();
      if (!this.enabled) return;
      if (gameKeys.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'KeyR') this.actions.push({ a: 'reload' });
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.actions.push({ a: 'dash' });
      if (e.code === 'Digit1') this.actions.push({ a: 'weapon', v: 1 });
      if (e.code === 'Digit2') this.actions.push({ a: 'weapon', v: 2 });
      if (e.code === 'KeyQ') {
        this.actions.push({ a: 'weapon', v: this.lastWeapon === 2 ? 1 : 2 });
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.look.x += e.movementX || 0;
      this.look.y += e.movementY || 0;
    });

    window.addEventListener('mousedown', (e) => {
      this.onFirstInteract?.();
      if (!this.enabled || (!this.locked && !this.fallback)) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
      if (e.button === 0 || e.button === 2) e.preventDefault();
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });

    window.addEventListener('wheel', (e) => {
      if (!this.enabled || (!this.locked && !this.fallback)) return;
      e.preventDefault();
      this.actions.push({ a: 'weapon', v: this.lastWeapon === 2 ? 1 : 2 });
    }, { passive: false });

    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
    window.addEventListener('contextmenu', (e) => {
      if (this.enabled || this.locked) e.preventDefault();
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      const changed = locked !== this.locked;
      this.locked = locked;
      if (!locked) {
        this.mouse.left = false;
        this.mouse.right = false;
        this.look.x = 0;
        this.look.y = 0;
      }
      if (changed) this.onLockChange?.(locked);
    });
  }

  requestLock() {
    if (this.locked) return;
    try {
      const result = this.canvas.requestPointerLock?.();
      if (result?.catch) result.catch(() => {});
    } catch {
      // Pointer lock can be denied; the pause overlay remains.
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clear() {
    this.keys.clear();
    this.mouse.left = false;
    this.mouse.right = false;
    this.look.x = 0;
    this.look.y = 0;
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on) this.clear();
  }

  setFallback(on) {
    this.fallback = !!on;
  }

  getMove() {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW')) y += 1;
    if (this.keys.has('KeyS')) y -= 1;
    if (this.keys.has('KeyD')) x += 1;
    if (this.keys.has('KeyA')) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { forward: y, strafe: x };
  }

  consumeLook() {
    const look = { x: this.look.x, y: this.look.y };
    this.look.x = 0;
    this.look.y = 0;
    return look;
  }

  consumeActions() {
    const list = this.actions;
    this.actions = [];
    return list;
  }

  setLastWeapon(v) {
    this.lastWeapon = v;
  }
}
