// Soft synthesized sounds (generated in code, no audio files).
let audioCtx = null;
let master = null;

function ctx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // shared low-pass takes the edge off every sound
    master = audioCtx.createBiquadFilter();
    master.type = "lowpass";
    master.frequency.value = 1800;
    master.Q.value = 0.3;
    master.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// a round, soft tone: slow attack (no click), gentle fade
function tone(freq, start, { volume = 0.06, attack = 0.035, decay = 1.1, glideTo = null } = {}) {
  const ac = ctx();
  const t = ac.currentTime + start;

  const env = ac.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(volume, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  env.connect(master);

  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + attack + decay * 0.6);
  osc.connect(env);
  osc.start(t);
  osc.stop(t + attack + decay + 0.05);
}

const Sound = {
  step() {
    tone(523.25, 0);          // C5
    tone(783.99, 0.07, { volume: 0.045 }); // G5
  },
  finish() {
    tone(392.0, 0, { decay: 1.8 });                  // G4
    tone(523.25, 0.09, { decay: 1.8 });              // C5
    tone(659.25, 0.18, { decay: 1.8 });              // E5
    tone(783.99, 0.3, { volume: 0.05, decay: 2.2 }); // G5
  },
  undo() {
    tone(392.0, 0, { volume: 0.04, attack: 0.02, decay: 0.28, glideTo: 294 }); // G4 sliding down
  },
};

// unlock audio on the first real click so later async calls can play
document.addEventListener("pointerdown", () => ctx(), { once: true });
