// Original WebAudio synth sounds only: no audio files, no samples, nothing
// copied. A low engine hum whose pitch and loudness follow the throttle, a
// two-note chime for rings and pickups, a low thud for landings and crashes,
// and a click for menus. The audio context is created on the first user
// gesture, so the game never plays sound before the player interacts.

export function createAudio() {
  let context = null;
  let master = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let engineFilter = null;
  let muted = false;
  let started = false;

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(context.destination);

      // Engine: two detuned sawtooths through a low-pass filter.
      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineOsc2 = context.createOscillator();
      engineOsc2.type = 'sawtooth';
      engineOsc2.frequency.value = 55 * 1.007;
      engineFilter = context.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineFilter.Q.value = 1.2;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineOsc2.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      engineOsc2.start();
      started = true;
      return true;
    } catch {
      return false;
    }
  }

  function resume() {
    if (context && context.state === 'suspended') context.resume();
  }

  function tone(frequency, startAt, duration, type, volume) {
    if (!context || !master) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, context.currentTime + startAt);
    gain.gain.linearRampToValueAtTime(volume, context.currentTime + startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + startAt + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(context.currentTime + startAt);
    osc.stop(context.currentTime + startAt + duration + 0.05);
  }

  return {
    /** Call from any user gesture (click / keypress) to unlock sound. */
    unlock() {
      if (ensure()) resume();
    },
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    /** Engine hum follows throttle 0..1 and boost; call every frame while flying. */
    engine(throttle, boosting, flying) {
      if (!started || !context) return;
      const target = flying && !muted ? 0.05 + throttle * 0.11 + (boosting ? 0.05 : 0) : 0;
      const now = context.currentTime;
      engineGain.gain.setTargetAtTime(target, now, 0.08);
      const freq = 52 + throttle * 66 + (boosting ? 22 : 0);
      engineOsc.frequency.setTargetAtTime(freq, now, 0.1);
      engineOsc2.frequency.setTargetAtTime(freq * 1.007, now, 0.1);
      engineFilter.frequency.setTargetAtTime(280 + throttle * 700, now, 0.1);
    },
    ring() {
      if (!ensure()) return;
      resume();
      tone(880, 0, 0.28, 'sine', 0.32);
      tone(1318.5, 0.09, 0.4, 'sine', 0.28);
    },
    pickup() {
      if (!ensure()) return;
      resume();
      tone(659.3, 0, 0.18, 'triangle', 0.3);
      tone(987.8, 0.07, 0.3, 'triangle', 0.28);
    },
    thud(hard) {
      if (!ensure()) return;
      resume();
      tone(hard ? 55 : 82, 0, hard ? 0.5 : 0.3, 'sine', hard ? 0.6 : 0.4);
      tone(38, 0.02, 0.4, 'triangle', 0.35);
    },
    click() {
      if (!ensure()) return;
      resume();
      tone(1200, 0, 0.06, 'square', 0.08);
    },
    fanfare() {
      if (!ensure()) return;
      resume();
      tone(523.25, 0, 0.22, 'triangle', 0.3);
      tone(659.25, 0.12, 0.22, 'triangle', 0.3);
      tone(783.99, 0.24, 0.4, 'triangle', 0.32);
    },
    fail() {
      if (!ensure()) return;
      resume();
      tone(311.1, 0, 0.3, 'triangle', 0.28);
      tone(233.1, 0.18, 0.5, 'triangle', 0.26);
    },
  };
}
