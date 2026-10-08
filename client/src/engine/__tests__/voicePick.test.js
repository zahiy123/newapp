import { describe, it, expect } from 'vitest';
import { pickCoachVoice, voicesFor, voiceGender, fallbackPitch } from '../voicePick.js';

const V = (name, lang = 'he-IL', extra = {}) => ({ name, lang, voiceURI: name, localService: true, ...extra });
const ANDROID = [V('Google US English', 'en-US'), V('Google עברית'), V('he-il-x-heb-network')];
const IOS = [V('Carmit'), V('Samantha', 'en-US')];
const WINDOWS = [V('Microsoft Asaf - Hebrew (Israel)'), V('Microsoft Zira - English (United States)', 'en-US')];
const EDGE = [V('Microsoft Hila Online (Natural) - Hebrew (Israel)'), V('Microsoft Avri Online (Natural) - Hebrew (Israel)')];

describe('The coach voice is chosen explicitly from the device voices', () => {
  it('keeps only the voices of the language (he-IL / he_IL / iw)', () => {
    expect(voicesFor([V('a', 'he_IL'), V('b', 'iw-IL'), V('c', 'en-US')], 'he-IL').map(v => v.name)).toEqual(['a', 'b']);
  });

  it('knows female / male Hebrew voices by name', () => {
    expect(voiceGender(V('Carmit'))).toBe('female');
    expect(voiceGender(V('Microsoft Hila Online (Natural) - Hebrew (Israel)'))).toBe('female');
    expect(voiceGender(V('Microsoft Asaf - Hebrew (Israel)'))).toBe('male');
    expect(voiceGender(V('Microsoft Avri Online (Natural) - Hebrew (Israel)'))).toBe('male');
    expect(voiceGender(V('Google עברית'))).toBeNull();
  });

  it('female coach: a real female Hebrew voice when one exists (iPhone Carmit, Edge Hila)', () => {
    expect(pickCoachVoice(IOS, 'female').voice.name).toBe('Carmit');
    expect(pickCoachVoice(IOS, 'female').confident).toBe(true);
    expect(pickCoachVoice(EDGE, 'female').voice.name).toMatch(/Hila/);
    expect(pickCoachVoice(EDGE, 'male').voice.name).toMatch(/Avri/);
  });

  it('only a male Hebrew voice (Windows Asaf) → NOT confident → the caller raises the pitch clearly', () => {
    const r = pickCoachVoice(WINDOWS, 'female');
    expect(r.voice.name).toMatch(/Asaf/);
    expect(r.confident).toBe(false);
    expect(fallbackPitch('female')).toBeGreaterThan(1.3);
  });

  it('a voice the trainee chose wins (and counts as confident)', () => {
    const r = pickCoachVoice(ANDROID, 'female', 'he-IL', 'he-il-x-heb-network');
    expect(r.voice.name).toBe('he-il-x-heb-network');
    expect(r.confident).toBe(true);
  });

  it('no voice for the language → no voice, not confident', () => {
    expect(pickCoachVoice([V('Samantha', 'en-US')], 'female', 'he-IL')).toMatchObject({ voice: null, confident: false });
  });
});
