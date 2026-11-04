// THE PHYSIOTHERAPIST PORTAL (Stage 4B) — its own area, never the trainee app. Steps 0–1: the account state
// (request → admin approval), invite codes, the patient list. The reports (step 3), the clinical limits and the
// lock (step 4) and the clinician-built plan (step 5) come next. The server checks every request (zero trust).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { clinic, clinicError, setLoginAs } from '../utils/clinicApi';

const fmt = (ms, isHe) => (ms ? new Date(ms).toLocaleDateString(isHe ? 'he-IL' : 'en-GB') : '');

function Shell({ isHe, email, onLogout, children }) {
  return (
    <div dir={isHe ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50">
      <header className="bg-teal-800 text-white">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="font-bold">{'🩺'} {isHe ? 'פורטל המטפלים' : 'Clinician portal'}</div>
          <div className="flex items-center gap-3 text-sm">
            <span className="opacity-80 truncate max-w-[12rem]">{email}</span>
            <button onClick={onLogout} className="underline">{isHe ? 'יציאה' : 'Log out'}</button>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">{children}</main>
    </div>
  );
}

export default function ClinicianPortal() {
  const { user, logout, portal, refreshPortal } = useAuth();
  const { lang } = useLanguage();
  const isHe = (lang || 'he') === 'he';
  const navigate = useNavigate();
  const [patients, setPatients] = useState(null);
  const [invite, setInvite] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [reqName, setReqName] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(null);

  const active = portal?.role === 'clinician';
  useEffect(() => {
    if (!active) return;
    clinic('GET', '/patients').then(r => (r.ok ? setPatients(r.data) : setMsg(clinicError(r.error, isHe))));
  }, [active, isHe]);

  async function newInvite() {
    setBusy(true); setMsg('');
    const r = await clinic('POST', '/invites');
    setBusy(false);
    if (r.ok) setInvite(r.data); else setMsg(clinicError(r.error, isHe));
  }
  async function sendRequest() {
    setBusy(true); setMsg('');
    const r = await clinic('POST', '/request', { name: reqName.trim() });
    setBusy(false);
    if (r.ok) refreshPortal(); else setMsg(clinicError(r.error, isHe));
  }
  async function endCare(traineeId) {
    const r = await clinic('POST', '/end', { traineeId });
    setConfirmEnd(null);
    if (r.ok) setPatients(p => p.filter(x => x.traineeId !== traineeId)); else setMsg(clinicError(r.error, isHe));
  }
  const toTraineeApp = () => { setLoginAs('trainee'); navigate('/'); };
  const shellProps = { isHe, email: user?.email, onLogout: () => { setLoginAs('trainee'); logout(); } };


  if (!portal) return <Shell {...shellProps}><div className="text-gray-500">{isHe ? 'טוען…' : 'Loading…'}</div></Shell>;

  if (portal.unavailable) {
    return (
      <Shell {...shellProps}>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900">{clinicError(portal.error, isHe)}</div>
        <button onClick={() => refreshPortal()} className="text-sm underline text-gray-600">{isHe ? 'נסה שוב' : 'Try again'}</button>
      </Shell>
    );
  }

  if (!active) {
    return (
      <Shell {...shellProps}>
        {portal.clinicianStatus === 'pending' ? (
          <div className="bg-white rounded-xl shadow p-5 space-y-3">
            <div className="text-lg font-bold text-gray-900">{'⏳'} {isHe ? 'הבקשה שלך ממתינה לאישור' : 'Your request is waiting for approval'}</div>
            <p className="text-sm text-gray-600">{isHe ? 'מנהל המערכת יאשר את החשבון כחשבון מטפל. אחרי האישור לחץ "בדוק שוב".' : 'The system admin will approve the account as a clinician. After approval, tap "Check again".'}</p>
            <button onClick={() => refreshPortal({ forceToken: true })} className="px-4 py-2 rounded-lg bg-teal-700 text-white font-semibold">{isHe ? 'בדוק שוב' : 'Check again'}</button>
          </div>
        ) : portal.clinicianStatus === 'revoked' ? (
          <div className="bg-white rounded-xl shadow p-5 text-gray-800">{isHe ? 'הרשאת המטפל של החשבון הזה בוטלה. לפרטים פנה למנהל המערכת.' : 'This account’s clinician access was revoked. Contact the system admin.'}</div>
        ) : (
          <div className="bg-white rounded-xl shadow p-5 space-y-3">
            <div className="text-lg font-bold text-gray-900">{isHe ? 'בקשה לפתיחת חשבון מטפל' : 'Request a clinician account'}</div>
            <label htmlFor="req-name" className="block text-sm text-gray-700">{isHe ? 'שם מלא' : 'Full name'}</label>
            <input id="req-name" value={reqName} onChange={e => setReqName(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
            <button disabled={busy} onClick={sendRequest} className="px-4 py-2 rounded-lg bg-teal-700 text-white font-semibold disabled:opacity-50">{isHe ? 'שלח בקשה' : 'Send request'}</button>
          </div>
        )}
        {msg && <div className="text-sm text-rose-700">{msg}</div>}
        <button onClick={toTraineeApp} className="text-sm underline text-gray-600">{isHe ? 'אני מתאמן — לאפליקציית האימון' : 'I am a trainee — to the training app'}</button>
      </Shell>
    );
  }

  return (
    <Shell {...shellProps}>
      <section className="bg-white rounded-xl shadow p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-bold text-gray-900">{isHe ? 'הזמנת מטופל' : 'Invite a patient'}</h2>
          <button disabled={busy} onClick={newInvite} className="px-4 py-2 rounded-lg bg-teal-700 text-white font-semibold disabled:opacity-50">{isHe ? 'צור קוד הזמנה' : 'Create an invite code'}</button>
        </div>
        {invite && (
          <div className="rounded-xl bg-teal-50 border border-teal-200 p-4 text-center space-y-1">
            <div className="text-3xl font-extrabold tracking-[0.3em] text-teal-900 tabular-nums" dir="ltr">{invite.code}</div>
            <div className="text-sm text-teal-800">{isHe ? `המטופל מכניס את הקוד ב"המטפל שלי" ומאשר שיתוף. בתוקף עד ${fmt(invite.expiresAt, isHe)}, לשימוש אחד.` : `The patient enters it in "My clinician" and consents. Valid until ${fmt(invite.expiresAt, isHe)}, single use.`}</div>
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl shadow p-5 space-y-3">
        <h2 className="text-lg font-bold text-gray-900">{isHe ? 'המטופלים שלי' : 'My patients'}</h2>
        {patients === null && <div className="text-gray-500 text-sm">{isHe ? 'טוען…' : 'Loading…'}</div>}
        {patients?.length === 0 && <div className="text-gray-500 text-sm">{isHe ? 'עוד אין מטופלים מחוברים.' : 'No linked patients yet.'}</div>}
        <div className="divide-y divide-gray-100">
          {(patients || []).map(p => (
            <div key={p.traineeId} className="py-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-gray-900">{p.name || (isHe ? 'ללא שם' : 'No name')}</div>
                <div className="text-xs text-gray-500">{isHe ? `מחובר מ-${fmt(p.since, isHe)}` : `Linked since ${fmt(p.since, isHe)}`}{p.sport ? ` · ${p.sport}` : ''}</div>
              </div>
              {confirmEnd === p.traineeId ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-700">{isHe ? 'לסיים את הטיפול?' : 'End care?'}</span>
                  <button onClick={() => endCare(p.traineeId)} className="px-3 py-1 rounded-lg bg-rose-600 text-white font-semibold">{isHe ? 'כן, לסיים' : 'Yes, end'}</button>
                  <button onClick={() => setConfirmEnd(null)} className="px-3 py-1 rounded-lg border">{isHe ? 'ביטול' : 'Cancel'}</button>
                </div>
              ) : (
                <button onClick={() => setConfirmEnd(p.traineeId)} className="text-xs text-gray-500 underline">{isHe ? 'סיום טיפול' : 'End care'}</button>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500">{isHe ? 'הדוחות המלאים, המגבלות הקליניות ובניית תוכנית יתווספו בשלבים הבאים.' : 'Full reports, clinical limits and plan building come in the next steps.'}</p>
      </section>
      {msg && <div className="text-sm text-rose-700">{msg}</div>}
    </Shell>
  );
}
