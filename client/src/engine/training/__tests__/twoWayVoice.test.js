import { describe, it, expect } from 'vitest';
import { parseVoiceCommand, isEchoOf, commandAllowed, isNextCommand } from '../voiceCommands.js';

describe('Two-way voice — the commands', () => {
  it('break / stop / continue / one more / repeat', () => {
    expect(parseVoiceCommand('הפסקה')?.type).toBe('pause');
    expect(parseVoiceCommand('אני צריך הפסקה')?.type).toBe('pause');
    expect(parseVoiceCommand('עצור')?.type).toBe('stop');
    expect(parseVoiceCommand('ממשיכים')?.type).toBe('resume');
    expect(parseVoiceCommand('עוד אחת')?.type).toBe('oneMore');
    expect(parseVoiceCommand('תחזור')?.type).toBe('repeat');
    expect(parseVoiceCommand('מה אמרת')?.type).toBe('repeat');
    expect(parseVoiceCommand('one more')?.type).toBe('oneMore');
  });
  it('short words inside a longer sentence are not commands (the coach says them)', () => {
    expect(parseVoiceCommand('חזור לעמידה זקופה ותנשום')).toBe(null);
    expect(parseVoiceCommand('עצור את הברך מעל האצבעות בירידה')).toBe(null);
    expect(parseVoiceCommand('ממשיכים לסט הבא עם אותו מיקוד')).toBe(null);
  });
  it('a question goes to the coach', () => {
    expect(parseVoiceCommand('למה אני צריך לנעול את הקרסול')?.type).toBe('question');
    expect(parseVoiceCommand('how deep should I go')?.type).toBe('question');
    expect(parseVoiceCommand('למה')).toBe(null);
  });
  it('"next exercise" stays its own command', () => {
    expect(isNextCommand('תרגיל הבא')).toBe(true);
    expect(parseVoiceCommand('תרגיל הבא')).toBe(null);
  });
  it('the echo guard: the coach own line heard back is ignored', () => {
    const lines = ['זהי, איך הגדם מרגיש היום? בפעם הקודמת עצרנו בסקוואט'];
    expect(isEchoOf('איך הגדם מרגיש היום', lines)).toBe(true);
    expect(isEchoOf('למה אני צריך לנעול את הקרסול', lines)).toBe(false);
  });
  it('each command only where it makes sense', () => {
    expect(commandAllowed('pause', 'exercising')).toBe(true);
    expect(commandAllowed('resume', 'exercising')).toBe(false);
    expect(commandAllowed('resume', 'paused')).toBe(true);
    expect(commandAllowed('oneMore', 'resting')).toBe(false);
    expect(commandAllowed('question', 'resting')).toBe(true);
  });
});
