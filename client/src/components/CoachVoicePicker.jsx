// CoachVoicePicker — the coach's voice, chosen EXPLICITLY from the voices this device really has.
// Lists the device's voices for the language (speechSynthesis.getVoices()), marks the ones known to
// be female / male, lets the trainee hear each one and pick it (saved per coach). When the device
// has no voice of the coach's gender, it says so and explains how to install one.

import { useEffect, useState } from 'react';
import { pickCoachVoice, voiceGender, fallbackPitch } from '../engine/voicePick';
import { genderizeCoachText } from '../engine/coachVoiceText';

const KEY = (coach) => `coachVoiceURI.${coach}`;

export default function CoachVoicePicker({ coach, isHe, lang = 'he-IL', onClose }) {
  const [voices, setVoices] = useState(() => (window.speechSynthesis ? window.speechSynthesis.getVoices() : []));
  const [saved, setSaved] = useState(() => { try { return localStorage.getItem(KEY(coach)); } catch { return null; } });

  useEffect(() => {
    const ss = window.speechSynthesis;
    if (!ss) return undefined;
    const load = () => setVoices(ss.getVoices());
    load();
    ss.addEventListener?.('voiceschanged', load);
    const tm = setTimeout(load, 600);           // some browsers fill the list late
    return () => { ss.removeEventListener?.('voiceschanged', load); clearTimeout(tm); };
  }, []);

  const { voice: auto, confident, candidates } = pickCoachVoice(voices, coach, lang, null);
  const current = saved ? (candidates.find(c => c.v.voiceURI === saved)?.v || auto) : auto;
  const anyOfGender = candidates.some(c => c.gender === coach);
  const female = coach === 'female';

  const play = (v) => {
    const ss = window.speechSynthesis;
    if (!ss) return;
    ss.cancel();
    const text = genderizeCoachText(isHe ? 'שלום, אני המאמן שלך. אני סופר איתך — יאללה, מתחילים!' : "Hi, I'm your coach. Let's get started!", coach)
      .replace('המאמן שלך', female ? 'המאמנת שלך' : 'המאמן שלך');
    const u = new SpeechSynthesisUtterance(text);
    u.lang = v?.lang || lang;
    if (v) u.voice = v;
    // the same rule as in training: a voice not known to be of the coach's gender gets the fallback pitch
    const sure = v && (voiceGender(v) === coach || v.voiceURI === saved);
    u.pitch = sure ? 1 : fallbackPitch(coach);
    ss.speak(u);
  };
  const choose = (v) => {
    try { if (v) localStorage.setItem(KEY(coach), v.voiceURI); else localStorage.removeItem(KEY(coach)); } catch { /* storage unavailable */ }
    setSaved(v ? v.voiceURI : null);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-4 w-full max-w-sm max-h-[85vh] overflow-y-auto space-y-3" dir={isHe ? 'rtl' : 'ltr'} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-lg font-bold text-gray-800">{'🔊'} {isHe ? (female ? 'הקול של המאמנת' : 'הקול של המאמן') : 'Coach voice'}</div>
          <button type="button" onClick={onClose} className="text-gray-400 text-xl px-2">{'✕'}</button>
        </div>

        {candidates.length === 0 && (
          <div className="text-sm text-gray-600">{isHe ? 'בטלפון הזה לא נמצא אף קול בעברית.' : 'No voice for this language was found on this device.'}</div>
        )}

        <div className="space-y-2">
          {candidates.map(({ v, gender }) => {
            const active = current && v.voiceURI === current.voiceURI;
            return (
              <div key={v.voiceURI} className={`rounded-xl border-2 p-2 flex items-center gap-2 ${active ? (female ? 'border-pink-500 bg-pink-50' : 'border-blue-500 bg-blue-50') : 'border-gray-200'}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{v.name}</div>
                  <div className="text-[11px] text-gray-500">
                    {gender === 'female' ? (isHe ? 'קול נשי' : 'female') : gender === 'male' ? (isHe ? 'קול גברי' : 'male') : (isHe ? 'מין לא ידוע' : 'unknown')}
                    {' · '}{v.lang}{v.localService ? '' : (isHe ? ' · ברשת' : ' · online')}
                    {active && gender !== coach && v.voiceURI !== saved && (isHe ? (female ? ' · מושמע בגובה קול נשי' : ' · מושמע בגובה קול גברי') : ' · pitch-shifted')}
                  </div>
                </div>
                <button type="button" onClick={() => play(v)} className="px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-bold">{'▶'} {isHe ? 'השמע' : 'Play'}</button>
                <button type="button" onClick={() => choose(v)} className={`px-2.5 py-1.5 rounded-lg text-xs font-bold ${active ? 'bg-green-600 text-white' : 'bg-gray-800 text-white'}`}>
                  {active ? (saved ? (isHe ? 'נבחר' : 'Chosen') : (isHe ? 'אוטומטי' : 'Auto')) : (isHe ? 'בחר' : 'Choose')}
                </button>
              </div>
            );
          })}
        </div>
        {saved && (
          <button type="button" onClick={() => choose(null)} className="text-xs text-gray-500 underline">{isHe ? 'חזור לבחירה אוטומטית' : 'Back to automatic'}</button>
        )}

        {!anyOfGender && !confident && (
          <div className="text-xs text-amber-800 bg-amber-50 rounded-xl p-3 space-y-1.5">
            <div className="font-bold">
              {isHe ? (female ? 'בטלפון הזה אין קול נשי בעברית' : 'בטלפון הזה אין קול גברי מזוהה בעברית') : `No ${coach} voice for this language on this device`}
            </div>
            <div>{isHe ? 'עד שתתקין קול מתאים, המאמן ידבר בגובה קול שונה בבירור. כדי לקבל קול אמיתי:' : 'Until you install one, the coach speaks with a clearly different pitch. To get a real voice:'}</div>
            <div>{'🤖'} <b>Android:</b> {isHe ? 'הגדרות ← ניהול כללי / מערכת ← שפה וקלט ← פלט המרת טקסט לדיבור ← מנוע Google ← ⚙️ ← התקן נתוני קול ← עברית ← בחר קול נשי וקבע אותו כברירת מחדל.' : 'Settings → System → Languages → Text-to-speech output → Google engine → ⚙ → Install voice data → Hebrew → pick a voice.'}</div>
            <div>{'🍎'} <b>iPhone:</b> {isHe ? 'הגדרות ← נגישות ← תוכן מוקרא ← קולות ← עברית ← כרמית (קול נשי) ← הורד.' : 'Settings → Accessibility → Spoken Content → Voices → Hebrew → Carmit → download.'}</div>
            <div>{isHe ? 'אחר כך סגור ופתח שוב את הדפדפן — הקול יופיע ברשימה כאן.' : 'Then restart the browser — the voice will appear in this list.'}</div>
          </div>
        )}
      </div>
    </div>
  );
}
