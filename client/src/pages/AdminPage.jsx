// The system admin (ADMIN_EMAILS on the server) approves / rejects clinician requests and revokes clinicians.
// The page is only a view — the server refuses every action of a non-admin.
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { clinic, clinicError } from '../utils/clinicApi';

const fmt = (ms, isHe) => (ms ? new Date(ms).toLocaleDateString(isHe ? 'he-IL' : 'en-GB') : '');

export default function AdminPage() {
  const { portal } = useAuth();
  const { lang } = useLanguage();
  const isHe = (lang || 'he') === 'he';
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(null);

  const load = () => clinic('GET', '/admin').then(r => (r.ok ? setData(r.data) : setMsg(clinicError(r.error, isHe))));
  useEffect(() => { if (portal?.isAdmin) load(); }, [portal?.isAdmin]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function act(path, uid) {
    setMsg('');
    const r = await clinic('POST', `/admin/${path}`, { uid });
    setConfirm(null);
    if (!r.ok) { setMsg(clinicError(r.error, isHe)); return; }
    setMsg(path === 'approve' ? (isHe ? 'אושר — המטפל ילחץ "בדוק שוב" בפורטל.' : 'Approved — the clinician taps "Check again".') : (isHe ? 'בוצע.' : 'Done.'));
    load();
  }

  if (!portal?.isAdmin) return <div dir={isHe ? 'rtl' : 'ltr'} className="text-gray-600">{portal?.unavailable ? clinicError(portal.error, isHe) : (isHe ? 'אין הרשאת מנהל.' : 'No admin access.')}</div>;

  return (
    <div dir={isHe ? 'rtl' : 'ltr'} className="max-w-3xl mx-auto space-y-5">
      <h1 className="text-2xl font-extrabold text-gray-900">{'🛡️'} {isHe ? 'ניהול מטפלים' : 'Clinician admin'}</h1>
      {msg && <div className="text-sm bg-gray-100 rounded-lg px-3 py-2">{msg}</div>}
      <section className="bg-white rounded-xl shadow p-5 space-y-3">
        <h2 className="font-bold text-gray-900">{isHe ? 'בקשות ממתינות' : 'Pending requests'}</h2>
        {!data && <div className="text-sm text-gray-500">{isHe ? 'טוען…' : 'Loading…'}</div>}
        {data?.requests?.length === 0 && <div className="text-sm text-gray-500">{isHe ? 'אין בקשות.' : 'No requests.'}</div>}
        {(data?.requests || []).map(r => (
          <div key={r.uid} className="flex items-center justify-between gap-3 border-t pt-3 flex-wrap">
            <div>
              <div className="font-semibold">{r.name}</div>
              <div className="text-xs text-gray-500">{r.email}{r.licenseNo ? ` · ${isHe ? 'רישיון' : 'license'} ${r.licenseNo}` : ''} · {fmt(r.at, isHe)}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => act('approve', r.uid)} className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-sm font-semibold">{isHe ? 'אשר כמטפל' : 'Approve'}</button>
              <button onClick={() => act('reject', r.uid)} className="px-3 py-1.5 rounded-lg border text-sm">{isHe ? 'דחה' : 'Reject'}</button>
            </div>
          </div>
        ))}
      </section>
      <section className="bg-white rounded-xl shadow p-5 space-y-3">
        <h2 className="font-bold text-gray-900">{isHe ? 'מטפלים פעילים' : 'Active clinicians'}</h2>
        {data?.clinicians?.length === 0 && <div className="text-sm text-gray-500">{isHe ? 'אין מטפלים פעילים.' : 'None.'}</div>}
        {(data?.clinicians || []).map(c => (
          <div key={c.uid} className="flex items-center justify-between gap-3 border-t pt-3 flex-wrap">
            <div>
              <div className="font-semibold">{c.name}</div>
              <div className="text-xs text-gray-500">{c.email} · {isHe ? 'אושר' : 'approved'} {fmt(c.approvedAt, isHe)}</div>
            </div>
            {confirm === c.uid ? (
              <div className="flex items-center gap-2 text-sm">
                <span>{isHe ? 'לבטל הרשאה? כל המטופלים שלו ינותקו מיד.' : 'Revoke? All their patients are unlinked at once.'}</span>
                <button onClick={() => act('revoke', c.uid)} className="px-3 py-1 rounded-lg bg-rose-600 text-white font-semibold">{isHe ? 'כן' : 'Yes'}</button>
                <button onClick={() => setConfirm(null)} className="px-3 py-1 rounded-lg border">{isHe ? 'ביטול' : 'Cancel'}</button>
              </div>
            ) : (
              <button onClick={() => setConfirm(c.uid)} className="text-xs text-rose-700 underline">{isHe ? 'ביטול הרשאה' : 'Revoke'}</button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
