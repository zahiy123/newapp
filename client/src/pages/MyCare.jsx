// "המטפל שלי" (Stage 4B) — the trainee links to a clinician with an invite code + explicit consent, sees who it
// is, can unlink at any moment, and sees WHO viewed their data and WHEN (the server's audit log).
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { clinic, clinicError } from '../utils/clinicApi';

const fmtTime = (ms, isHe) => (ms ? new Date(ms).toLocaleString(isHe ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const ACTION_HE = { consent_link: 'התחברת למטפל', admin_self_link: 'חיבור בדיקה (מנהל)', unlink: 'ניתקת את החיבור', view_patient_list: 'ראה אותך ברשימת המטופלים', view_patient_data: 'צפה בנתונים שלך', end_care: 'סיים את הטיפול' };
const ACTION_EN = { consent_link: 'You linked', admin_self_link: 'A test link (admin)', unlink: 'You unlinked', view_patient_list: 'Saw you in the patient list', view_patient_data: 'Viewed your data', end_care: 'Ended the care' };
const SHARED_HE = ['ההתקדמות שלך: דיוק בכל תרגיל ומה תוקן', 'טווחי התנועה', 'היסטוריית הכאב (כולל מצב בטוח)', 'דוחות האימונים והתאמות העומס', 'יומן המאמן'];
const SHARED_EN = ['Your progress: accuracy per exercise and what was fixed', 'Range of motion', 'Pain history (incl. safe mode)', 'Workout reports and load adaptations', 'The coach notebook'];

export default function MyCare() {
  const { portal, refreshPortal } = useAuth();
  const { lang } = useLanguage();
  const isHe = (lang || 'he') === 'he';
  const [code, setCode] = useState('');
  const [peek, setPeek] = useState(null);
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const linked = portal?.myClinician;
  useEffect(() => { if (portal && !portal.unavailable) clinic('GET', '/my-audit').then(r => r.ok && setAudit(r.data)); }, [portal]);

  async function check() {
    setMsg(''); setBusy(true);
    const r = await clinic('GET', `/invites/${encodeURIComponent(code.trim())}`);
    setBusy(false);
    if (r.ok) setPeek(r.data); else setMsg(clinicError(r.error, isHe));
  }
  async function link() {
    setMsg(''); setBusy(true);
    const r = await clinic('POST', '/link', { code: code.trim(), consent });
    setBusy(false);
    if (!r.ok) { setMsg(clinicError(r.error, isHe)); return; }
    setPeek(null); setCode(''); setConsent(false);
    setMsg(isHe ? `התחברת ל${r.data.clinicianName}.` : `Linked to ${r.data.clinicianName}.`);
    refreshPortal();
  }
  async function unlink() {
    const r = await clinic('POST', '/unlink');
    setConfirmUnlink(false);
    if (r.ok) { setMsg(isHe ? 'החיבור נותק. למטפל אין יותר גישה לנתונים שלך.' : 'Unlinked. The clinician no longer has access.'); refreshPortal(); }
    else setMsg(clinicError(r.error, isHe));
  }

  if (!portal) return <div className="text-gray-500">{isHe ? 'טוען…' : 'Loading…'}</div>;

  return (
    <div dir={isHe ? 'rtl' : 'ltr'} className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl font-extrabold text-gray-900">{'🩺'} {isHe ? 'המטפל שלי' : 'My clinician'}</h1>
      {portal.unavailable && <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 text-sm">{clinicError(portal.error, isHe)}</div>}

      {!portal.unavailable && linked && (
        <section className="bg-white rounded-xl shadow p-5 space-y-3">
          <div className="text-lg font-bold text-gray-900">{linked.name}</div>
          <div className="text-sm text-gray-600">{isHe ? 'רואה את הנתונים שלך מאז' : 'Sees your data since'} {fmtTime(linked.since, isHe)}</div>
          {confirmUnlink ? (
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span>{isHe ? 'לנתק? הגישה של המטפל תיחסם מיד.' : 'Unlink? The clinician’s access ends at once.'}</span>
              <button onClick={unlink} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-semibold">{isHe ? 'כן, לנתק' : 'Yes, unlink'}</button>
              <button onClick={() => setConfirmUnlink(false)} className="px-3 py-1.5 rounded-lg border">{isHe ? 'ביטול' : 'Cancel'}</button>
            </div>
          ) : (
            <button onClick={() => setConfirmUnlink(true)} className="text-sm text-rose-700 underline">{isHe ? 'ניתוק מהמטפל' : 'Unlink'}</button>
          )}
        </section>
      )}

      {!portal.unavailable && !linked && (
        <section className="bg-white rounded-xl shadow p-5 space-y-3">
          <p className="text-sm text-gray-700">{isHe ? 'קיבלת קוד מהפיזיותרפיסט שלך? הכנס אותו כאן.' : 'Got a code from your physiotherapist? Enter it here.'}</p>
          {!peek ? (
            <div className="flex gap-2">
              <label htmlFor="invite-code" className="sr-only">{isHe ? 'קוד הזמנה' : 'Invite code'}</label>
              <input id="invite-code" dir="ltr" value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={8} placeholder="ABC123"
                className="flex-1 px-3 py-2 border rounded-lg tracking-widest text-center font-bold" />
              <button disabled={busy || code.trim().length < 6} onClick={check} className="px-4 py-2 rounded-lg bg-teal-700 text-white font-semibold disabled:opacity-50">{isHe ? 'המשך' : 'Next'}</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-gray-900">{isHe ? 'המטפל:' : 'Clinician:'} <span className="font-bold">{peek.clinicianName}</span></div>
              <div className="text-sm text-gray-700">{isHe ? 'אם תאשר, המטפל יוכל לראות:' : 'If you consent, the clinician can see:'}</div>
              <ul className="text-sm text-gray-800 list-disc ps-5 space-y-0.5">{(isHe ? SHARED_HE : SHARED_EN).map(x => <li key={x}>{x}</li>)}</ul>
              <div className="text-xs text-gray-500">{isHe ? 'רק המטפל הזה. כל צפייה נרשמת ותראה אותה כאן. אפשר לנתק בכל רגע.' : 'Only this clinician. Every view is logged and shown here. You can unlink at any time.'}</div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1" />
                <span>{isHe ? 'אני מאשר לשתף את הנתונים האלה עם המטפל הזה' : 'I consent to share this data with this clinician'}</span>
              </label>
              <div className="flex gap-2">
                <button disabled={busy || !consent} onClick={link} className="px-4 py-2 rounded-lg bg-teal-700 text-white font-semibold disabled:opacity-50">{isHe ? 'אישור וחיבור' : 'Consent and link'}</button>
                <button onClick={() => { setPeek(null); setConsent(false); }} className="px-4 py-2 rounded-lg border">{isHe ? 'ביטול' : 'Cancel'}</button>
              </div>
            </div>
          )}
        </section>
      )}

      {msg && <div className="text-sm bg-gray-100 rounded-lg px-3 py-2">{msg}</div>}

      {!portal.unavailable && (
        <section className="bg-white rounded-xl shadow p-5 space-y-2">
          <h2 className="font-bold text-gray-900">{isHe ? 'מי צפה בנתונים שלי ומתי' : 'Who viewed my data and when'}</h2>
          {!audit?.length && <div className="text-sm text-gray-500">{isHe ? 'אין רישומים.' : 'Nothing logged.'}</div>}
          {(audit || []).map((r, i) => (
            <div key={i} className="flex gap-3 text-sm border-t pt-2">
              <span className="text-gray-500 tabular-nums w-28 shrink-0">{fmtTime(r.at, isHe)}</span>
              <span className="text-gray-800">{r.by && r.by !== 'trainee' ? `${r.by}: ` : ''}{(isHe ? ACTION_HE : ACTION_EN)[r.action] || r.action}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
