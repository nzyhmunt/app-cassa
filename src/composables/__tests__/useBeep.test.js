import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useBeep } from '../useBeep.js';
import { resolveStorageKeys } from '../../store/persistence.js';

// ---------------------------------------------------------------------------
// AudioContext mock factory
// Returns a minimal AudioContext-like object along with the inner nodes so
// tests can assert on the calls made during playBeep().
//
// NOTE: vi.fn() implementations must use regular functions (not arrow
// functions) when the mock is called with `new` (as a constructor), because
// arrow functions cannot be constructors. A constructor that returns an
// object causes JavaScript to use that returned object instead of `this`,
// which is how we inject the mock ctx.
// ---------------------------------------------------------------------------
function createMockAudioContext() {
  const oscillator = {
    type: null,
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
  const ctx = {
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
    destination: {},
    currentTime: 0,
    close: vi.fn().mockResolvedValue(undefined),
  };
  // Use a regular function (not an arrow function) so it can act as a constructor.
  // When a constructor returns an object, that object is used as the result of `new`.
  const ctor = vi.fn().mockImplementation(function () { return ctx; });
  return { ctor, ctx, oscillator, gain };
}

describe('useBeep()', () => {
  // Derive the settings key the same way the production code does, so the
  // tests stay correct across all instance-name configurations.
  const { settingsKey } = resolveStorageKeys();

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // Clean up any AudioContext stubs added to window
    delete window.AudioContext;
    delete window.webkitAudioContext;
  });

  it('returns an object with a playBeep function', () => {
    const { playBeep } = useBeep();
    expect(typeof playBeep).toBe('function');
  });

  it('plays a beep when sounds is enabled by default (no localStorage entry)', () => {
    const { ctor, ctx } = createMockAudioContext();
    window.AudioContext = ctor;

    const { playBeep } = useBeep();
    playBeep();

    expect(ctor).toHaveBeenCalled();
    expect(ctx.createOscillator).toHaveBeenCalled();
    expect(ctx.createGain).toHaveBeenCalled();
  });

  it('plays a beep when sounds is explicitly true in localStorage', () => {
    localStorage.setItem(settingsKey, JSON.stringify({ sounds: true }));
    const { ctor, ctx } = createMockAudioContext();
    window.AudioContext = ctor;

    const { playBeep } = useBeep();
    playBeep();

    expect(ctor).toHaveBeenCalled();
  });

  it('does NOT play a beep when sounds is false in localStorage', () => {
    localStorage.setItem(settingsKey, JSON.stringify({ sounds: false }));
    const { ctor } = createMockAudioContext();
    window.AudioContext = ctor;

    const { playBeep } = useBeep();
    playBeep();

    expect(ctor).not.toHaveBeenCalled();
  });

  it('defaults to enabled when localStorage contains malformed JSON', () => {
    localStorage.setItem(settingsKey, '{not valid json}');
    const { ctor } = createMockAudioContext();
    window.AudioContext = ctor;

    const { playBeep } = useBeep();
    playBeep();

    expect(ctor).toHaveBeenCalled();
  });

  it('defaults to enabled when sounds key is not a boolean', () => {
    localStorage.setItem(settingsKey, JSON.stringify({ sounds: 'yes' }));
    const { ctor } = createMockAudioContext();
    window.AudioContext = ctor;

    const { playBeep } = useBeep();
    playBeep();

    expect(ctor).toHaveBeenCalled();
  });

  it('falls back to webkitAudioContext when AudioContext is not available', () => {
    delete window.AudioContext;
    const { ctor } = createMockAudioContext();
    window.webkitAudioContext = ctor;

    const { playBeep } = useBeep();
    playBeep();

    expect(ctor).toHaveBeenCalled();
  });

  it('wires oscillator → gain → destination and configures envelope correctly', () => {
    const { ctor, ctx, oscillator, gain } = createMockAudioContext();
    window.AudioContext = ctor;

    const { playBeep } = useBeep();
    playBeep();

    expect(oscillator.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(ctx.destination);
    expect(oscillator.type).toBe('sine');
    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(880, ctx.currentTime);
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.1, ctx.currentTime);
    expect(oscillator.start).toHaveBeenCalled();
  });

  it('closes the AudioContext after 500 ms', () => {
    const { ctor, ctx } = createMockAudioContext();
    window.AudioContext = ctor;

    const { playBeep } = useBeep();
    playBeep();

    expect(ctx.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(ctx.close).toHaveBeenCalled();
  });

  it('handles an AudioContext constructor that throws without propagating the error', () => {
    window.AudioContext = vi.fn().mockImplementation(function () {
      throw new Error('AudioContext not allowed');
    });

    const { playBeep } = useBeep();
    expect(() => playBeep()).not.toThrow();
  });
});
