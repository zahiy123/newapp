import { useState, useEffect } from 'react';
import { apiUrl } from '../utils/api';

// Biomechanical overlay data for each frame scenario
const QA_SCENARIOS = [
  {
    sport: 'כושר',
    exercise: 'בורפיז (Burpees)',
    reps: [
      {
        label: 'מושלם',
        score: 9,
        isUrgent: false,
        issue_key: 'good_form',
        feedback: 'זאהי, בורפי מושלם! נחיתה רכה וחזה עד הרצפה, אתה מכונה!',
        frames: [
          { id: 'f1', phase: 'התחלה', desc: 'עמידה זקופה, ידיים למעלה, הכנה לירידה. Core מגויס, רגליים ברוחב כתפיים.' },
          { id: 'f2', phase: 'שיא מאמץ', desc: 'Push-up: חזה נוגע ברצפה, מרפקים 45°, גוף כקרש מושלם.' },
          { id: 'f3', phase: 'סיום', desc: 'קפיצה: hip extension מלא, ידיים מעל הראש, נחיתה רכה על כפות רגליים.' },
        ],
      },
      {
        label: 'תיקון כמותי',
        score: 5,
        isUrgent: false,
        issue_key: 'partial_rom',
        feedback: 'זאהי, אנרגיה מטורפת! תרד עם החזה עד הרצפה ותזרוק ידיים מעל הראש בקפיצה!',
        frames: [
          { id: 'f1', phase: 'התחלה', desc: 'ירידה לרצפה מהירה, גוף מעט חפוז.' },
          { id: 'f2', phase: 'שיא מאמץ', desc: 'חזה עוצר 15cm מהרצפה (חצי ROM), מרפקים ב-70°.', issues: ['chest_gap: 15cm', 'elbow: 70° → 45°'] },
          { id: 'f3', phase: 'סיום', desc: 'קפיצה חלקית, ידיים בגובה כתפיים בלבד.', issues: ['arms: shoulder height → overhead'] },
        ],
      },
      {
        label: 'מסוכן ⚠️',
        score: 3,
        isUrgent: true,
        issue_key: 'hip_sag_lumbar',
        feedback: 'זאהי, עצור! המותניים שוקעות וזה לוחץ על הגב התחתון. תהדק בטן לפני כל ירידה!',
        frames: [
          { id: 'f1', phase: 'התחלה', desc: 'נחיתה על עקבים עם ברכיים נעולות. סיכון לזעזוע מפרקים.', issues: ['landing: heels ⛔', 'knees: locked ⛔'] },
          { id: 'f2', phase: 'שיא מאמץ', desc: 'מותניים שוקעות! גב תחתון בהיפר-אקסטנשן. מרפקים 90° (T-shape). צוואר שבור קדימה.', issues: ['hip_sag: -8cm ⛔', 'elbow: 90° ⛔', 'neck: 45° ⛔', 'core: OFF ⛔'] },
          { id: 'f3', phase: 'סיום', desc: 'מותניים עולות ראשונות (worming). ברכיים קורסות פנימה בנחיתה.', issues: ['worming ⛔', 'knee_valgus ⛔'] },
        ],
      },
    ],
  },
  {
    sport: 'כדורגל',
    exercise: 'בעיטת עונשין (Penalty Kick)',
    reps: [
      {
        label: 'מושלם',
        score: 10,
        isUrgent: false,
        issue_key: 'good_form',
        feedback: 'זאהי, בעיטה ברמת פנדל מקצוענים! קרסול כמו קיר ופולו-ת\'רו מושלם!',
        frames: [
          { id: 'f1', phase: 'גישה', desc: 'ריצת גישה ב-30° מימין. עיניים על הכדור. גוף רפוי ומאוזן.' },
          { id: 'f2', phase: 'בעיטה', desc: 'רגל תומכת 15cm מהכדור ומצביעה ליעד. קרסול נעול. Hip rotation מלא. גוף מעל הכדור.' },
          { id: 'f3', phase: 'Follow-through', desc: 'רגל בועטת מעל המותן. Follow-through גבוה ומלא. ידיים מאזנות.' },
        ],
      },
      {
        label: 'תיקון כמותי',
        score: 5,
        isUrgent: false,
        issue_key: 'plant_foot_far',
        feedback: 'זאהי, כוח יפה! תקרב את הרגל התומכת 15 סנטימטר לכדור ותבעט עם שרוכים, לא אצבעות!',
        frames: [
          { id: 'f1', phase: 'גישה', desc: 'גישה ישרה (0°). מבט על השער במקום על הכדור.' , issues: ['approach: 0° → 30°'] },
          { id: 'f2', phase: 'בעיטה', desc: 'רגל תומכת 30cm מאחורי הכדור. Toe poke במקום laces.', issues: ['plant_foot: 30cm → 15cm', 'strike: toes → laces'] },
          { id: 'f3', phase: 'Follow-through', desc: 'Follow-through קצר, רגל עוצרת בגובה ברך.', issues: ['followthrough: knee → above hip'] },
        ],
      },
      {
        label: 'מסוכן ⚠️',
        score: 2,
        isUrgent: true,
        issue_key: 'ankle_unlocked_danger',
        feedback: 'זאהי, הקרסול רפוי מדי! סכנת פציעה, נעל את הקרסול בחוזקה לפני שבועטים!',
        frames: [
          { id: 'f1', phase: 'גישה', desc: 'ריצה מהירה מדי, גוף לא מאוזן.', issues: ['balance: unstable'] },
          { id: 'f2', phase: 'בעיטה', desc: 'רגל תומכת 50cm מהכדור. קרסול רפוי — שורש כף רגל מתכופף.', issues: ['ankle: floppy ⛔⛔', 'plant_foot: 50cm ⛔'] },
          { id: 'f3', phase: 'סיום', desc: 'גוף מסתובב 180°. ברך תומכת מסתובבת פנימה תחת עומס.', issues: ['rotation: 180° ⛔', 'knee_twist ⛔'] },
        ],
      },
    ],
  },
  {
    sport: 'כדורסל',
    exercise: 'ליי-אפ (Layup)',
    reps: [
      {
        label: 'מושלם',
        score: 9,
        isUrgent: false,
        issue_key: 'good_form',
        feedback: 'זאהי, ליי-אפ כמו בליגה! ברך נגדית למעלה ומגע רך מהלוח, מדהים!',
        frames: [
          { id: 'f1', phase: 'Gather', desc: 'שני צעדים, כדור מוגן בשתי ידיים, מבט לסל.' },
          { id: 'f2', phase: 'Take-off', desc: 'ברך נגדית נדחפת למעלה. יד ימין מורמת עם כדור. יד שמאלית מגינה.' },
          { id: 'f3', phase: 'Release', desc: 'זרוע מושטת, מגע רך מהלוח, נחיתה מאוזנת על שתי רגליים.' },
        ],
      },
      {
        label: 'תיקון כמותי',
        score: 5,
        isUrgent: false,
        issue_key: 'wrong_knee_drive',
        feedback: 'זאהי, קפיצה חזקה! תעלה את הברך השמאלית ותושיט את היד עד הסוף ללוח!',
        frames: [
          { id: 'f1', phase: 'Gather', desc: 'Gather תקין, שני צעדים.' },
          { id: 'f2', phase: 'Take-off', desc: 'ברך אותו צד עולה (ימנית ליד ימין). כדור נמוך בגובה חזה.', issues: ['knee: same-side → opposite', 'ball_height: chest → above head'] },
          { id: 'f3', phase: 'Release', desc: 'יד לא מושטת לגמרי. כדור לא מגיע ללוח. נחיתה על רגל אחת.', issues: ['arm: partial extension', 'landing: one foot → two feet'] },
        ],
      },
      {
        label: 'מסוכן ⚠️',
        score: 2,
        isUrgent: true,
        issue_key: 'valgus_landing',
        feedback: 'זאהי, היזהר בנחיתה! הברך קורסת פנימה, תנחת על שתי רגליים רחב עם ברכיים החוצה!',
        frames: [
          { id: 'f1', phase: 'Gather', desc: 'שלושה צעדים (traveling). אין gather נכון.', issues: ['steps: 3 ⛔ → 2'] },
          { id: 'f2', phase: 'Take-off', desc: 'אין knee drive, שתי רגליים יחד (hop). כדור ביד אחת ללא הגנה.', issues: ['no_knee_drive ⛔', 'ball_unprotected ⛔'] },
          { id: 'f3', phase: 'Landing', desc: 'רגל אחת, ברך valgus חמור, קרסול מתעקם.', issues: ['valgus: severe ⛔⛔', 'ankle_roll ⛔'] },
        ],
      },
    ],
  },
  {
    sport: 'כדורגל קטועים',
    exercise: 'מסירה מהמקום (Crutch-Pass)',
    reps: [
      {
        label: 'מושלם',
        score: 10,
        isUrgent: false,
        issue_key: 'good_form',
        feedback: 'זאהי, מסירה מדויקת על הקביים! משולש איזון מושלם ופולו-ת\'רו ליעד, ככה אלוף!',
        frames: [
          { id: 'f1', phase: 'הכנה', desc: 'קביים ברוחב כתפיים+. משולש איזון מושלם. כדור ליד הרגל. גוף ישר.' },
          { id: 'f2', phase: 'העברת משקל', desc: 'משקל על הקביים, core מגויס, רגל מתנדנדת לאחור. כתפיים מעל קביים.' },
          { id: 'f3', phase: 'מסירה', desc: 'רגל עוברת דרך הכדור בחלק פנימי. Follow-through ליעד. גוף יציב.' },
        ],
      },
      {
        label: 'תיקון כמותי',
        score: 6,
        isUrgent: false,
        issue_key: 'short_followthrough',
        feedback: 'זאהי, כיוון מעולה! תמשיך את הרגל אחרי הכדור עוד 30 סנטימטר לכיוון היעד!',
        frames: [
          { id: 'f1', phase: 'הכנה', desc: 'קביים ברוחב סביר. כדור קצת רחוק (40cm).', issues: ['ball_distance: 40cm → 20cm'] },
          { id: 'f2', phase: 'העברת משקל', desc: 'משקל על קביים, אבל core לא מגויס לגמרי. גוף נע קדימה.', issues: ['core: partial'] },
          { id: 'f3', phase: 'מסירה', desc: 'מגע נכון (חלק פנימי) אבל follow-through קצר. רגל עוצרת.', issues: ['followthrough: +30cm needed'] },
        ],
      },
      {
        label: 'מסוכן ⚠️',
        score: 1,
        isUrgent: true,
        issue_key: 'crutch_collapse_risk',
        feedback: 'זאהי, עצור! הקביים צמודות מדי ויש סכנת נפילה! תרחיב בסיס לרוחב כתפיים לפני מסירה!',
        frames: [
          { id: 'f1', phase: 'הכנה', desc: 'קביים צמודות (25cm). כדור בין הקביים. Base צר מסוכן.', issues: ['crutch_base: 25cm ⛔ → 50cm+'] },
          { id: 'f2', phase: 'העברת משקל', desc: 'קביה ימנית מחליקה, כתפיים נוטות שמאלה. Core רפוי.', issues: ['crutch_slip ⛔', 'shoulder_tilt ⛔', 'core: OFF ⛔'] },
          { id: 'f3', phase: 'קריסה', desc: 'קביה שמאלית עולה מרצפה, שחקן על קביה אחת בלבד. סכנת נפילה!', issues: ['single_crutch ⛔⛔', 'fall_risk: CRITICAL'] },
        ],
      },
    ],
  },
];

// Score → color mapping
function getScoreColor(score) {
  if (score >= 8) return '#22c55e'; // green
  if (score >= 5) return '#f59e0b'; // amber
  return '#ef4444'; // red
}

function getScoreBg(score) {
  if (score >= 8) return 'rgba(34,197,94,0.1)';
  if (score >= 5) return 'rgba(245,158,11,0.1)';
  return 'rgba(239,68,68,0.1)';
}

// Skeleton overlay SVG for push-up frame (dangerous)
function SkeletonOverlay({ issues }) {
  const hasHipSag = issues?.some(i => i.includes('hip_sag'));
  const hasElbow = issues?.some(i => i.includes('elbow'));
  const hasNeck = issues?.some(i => i.includes('neck'));

  return (
    <svg viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      {/* Floor */}
      <line x1="0" y1="105" x2="200" y2="105" stroke="#666" strokeWidth="1" strokeDasharray="4" />
      <text x="170" y="115" fill="#666" fontSize="6">FLOOR</text>

      {/* Body skeleton */}
      {/* Head */}
      <circle cx="35" cy="35" r="8" fill="none" stroke={hasNeck ? '#ef4444' : '#60a5fa'} strokeWidth="1.5" />
      {hasNeck && <line x1="35" y1="43" x2="50" y2="48" stroke="#ef4444" strokeWidth="1.5" />}
      {!hasNeck && <line x1="35" y1="43" x2="45" y2="48" stroke="#60a5fa" strokeWidth="1.5" />}

      {/* Torso */}
      <line x1="50" y1="48" x2="120" y2={hasHipSag ? '70' : '52'} stroke={hasHipSag ? '#ef4444' : '#60a5fa'} strokeWidth="2" />

      {/* Hip sag indicator */}
      {hasHipSag && (
        <>
          <line x1="85" y1="52" x2="85" y2="70" stroke="#ef4444" strokeWidth="1" strokeDasharray="3" />
          <text x="88" y="64" fill="#ef4444" fontSize="7" fontWeight="bold">-8cm</text>
          <text x="60" y="82" fill="#ef4444" fontSize="6">HIP SAG ⛔</text>
        </>
      )}

      {/* Arms */}
      <line x1="50" y1="48" x2="40" y2="75" stroke={hasElbow ? '#ef4444' : '#60a5fa'} strokeWidth="1.5" />
      <line x1="40" y1="75" x2="35" y2="100" stroke={hasElbow ? '#ef4444' : '#60a5fa'} strokeWidth="1.5" />

      {/* Elbow angle */}
      {hasElbow && (
        <>
          <path d="M 45 65 A 10 10 0 0 1 38 78" fill="none" stroke="#ef4444" strokeWidth="1" />
          <text x="18" y="72" fill="#ef4444" fontSize="7" fontWeight="bold">90°</text>
        </>
      )}

      {/* Legs */}
      <line x1="120" y1={hasHipSag ? '70' : '52'} x2="150" y2="85" stroke="#60a5fa" strokeWidth="1.5" />
      <line x1="150" y1="85" x2="170" y2="100" stroke="#60a5fa" strokeWidth="1.5" />

      {/* Hands on floor */}
      <circle cx="35" cy="102" r="3" fill="#60a5fa" />
      {/* Feet on floor */}
      <circle cx="172" cy="102" r="3" fill="#60a5fa" />

      {/* Chest gap */}
      <line x1="70" y1={hasHipSag ? '65' : '50'} x2="70" y2="105" stroke="#ef4444" strokeWidth="0.8" strokeDasharray="2" />
      <text x="72" y={hasHipSag ? '90' : '80'} fill="#ef4444" fontSize="6">15cm gap</text>
    </svg>
  );
}

function FrameCard({ frame, repLabel, isUrgent, showSkeleton }) {
  const hasIssues = frame.issues && frame.issues.length > 0;

  return (
    <div style={{
      border: `2px solid ${isUrgent ? '#ef4444' : hasIssues ? '#f59e0b' : '#22c55e'}`,
      borderRadius: 12,
      overflow: 'hidden',
      background: '#1a1a2e',
      minWidth: 220,
    }}>
      {/* Frame image placeholder with optional skeleton */}
      <div style={{
        height: 160,
        background: `linear-gradient(135deg, ${isUrgent ? '#1a0505' : '#0a0a1a'}, ${isUrgent ? '#2d0a0a' : '#121230'})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {showSkeleton ? (
          <SkeletonOverlay issues={frame.issues} />
        ) : (
          <div style={{ textAlign: 'center', color: '#555', fontSize: 13, padding: 12 }}>
            <div style={{ fontSize: 28, marginBottom: 4 }}>
              {isUrgent ? '⚠️' : hasIssues ? '🔧' : '✅'}
            </div>
            <div style={{ color: '#888', fontSize: 11 }}>{frame.phase}</div>
          </div>
        )}

        {/* Phase badge */}
        <div style={{
          position: 'absolute', top: 6, left: 6,
          background: 'rgba(0,0,0,0.7)', color: '#fff',
          padding: '2px 8px', borderRadius: 6, fontSize: 10,
        }}>
          {frame.id.toUpperCase()} — {frame.phase}
        </div>
      </div>

      {/* Description */}
      <div style={{ padding: 10 }}>
        <p style={{ color: '#e0e0e0', fontSize: 12, margin: 0, lineHeight: 1.5, direction: 'rtl' }}>
          {frame.desc}
        </p>

        {/* Issue tags */}
        {hasIssues && (
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {frame.issues.map((issue, idx) => (
              <span key={idx} style={{
                background: issue.includes('⛔') ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)',
                color: issue.includes('⛔') ? '#fca5a5' : '#fcd34d',
                padding: '2px 6px', borderRadius: 4, fontSize: 10, fontFamily: 'monospace',
              }}>
                {issue}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RepRow({ rep, sportName }) {
  const scoreColor = getScoreColor(rep.score);
  const scoreBg = getScoreBg(rep.score);

  return (
    <div style={{
      marginBottom: 20,
      border: `1px solid ${rep.isUrgent ? '#ef4444' : '#333'}`,
      borderRadius: 14,
      background: scoreBg,
      overflow: 'hidden',
    }}>
      {/* Rep header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 16px',
        background: 'rgba(0,0,0,0.3)',
        borderBottom: '1px solid #333',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            background: scoreColor, color: '#000', fontWeight: 'bold',
            padding: '4px 10px', borderRadius: 8, fontSize: 14,
          }}>
            {rep.score}/10
          </span>
          <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>{rep.label}</span>
          {rep.isUrgent && (
            <span style={{
              background: '#ef4444', color: '#fff',
              padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 'bold',
            }}>
              URGENT
            </span>
          )}
        </div>
        <span style={{
          fontFamily: 'monospace', fontSize: 11,
          color: '#888', background: 'rgba(255,255,255,0.05)',
          padding: '2px 8px', borderRadius: 4,
        }}>
          {rep.issue_key}
        </span>
      </div>

      {/* 3 Frames */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
        padding: 12,
      }}>
        {rep.frames.map((frame, i) => (
          <FrameCard
            key={frame.id}
            frame={frame}
            repLabel={rep.label}
            isUrgent={rep.isUrgent}
            showSkeleton={rep.isUrgent && i === 1}
          />
        ))}
      </div>

      {/* TTS Feedback */}
      <div style={{
        padding: '10px 16px',
        background: 'rgba(0,0,0,0.2)',
        borderTop: '1px solid #222',
        direction: 'rtl',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🔊</span>
          <span style={{ color: '#e0e0e0', fontSize: 13, fontStyle: 'italic', lineHeight: 1.5 }}>
            "{rep.feedback}"
          </span>
        </div>
      </div>
    </div>
  );
}

export default function DebugFrameGallery() {
  const [stats, setStats] = useState(null);
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    fetch(apiUrl('/api/coach/debug-frames'))
      .then(r => r.json())
      .then(setStats)
      .catch(() => setStats({ totalFrames: 0, error: 'Server not running' }));
  }, []);

  const scenario = QA_SCENARIOS[activeTab];

  return (
    <div style={{
      maxWidth: 900, margin: '0 auto', padding: 20,
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      background: '#0f0f23', minHeight: '100vh', color: '#fff',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, margin: 0, color: '#60a5fa' }}>
          🔬 Debug Frame Gallery — QA Vision Coach
        </h1>
        <p style={{ color: '#888', fontSize: 13, marginTop: 6 }}>
          Biomechanical analysis simulation with skeleton overlay
        </p>
        {stats && (
          <div style={{
            marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'rgba(96,165,250,0.1)', padding: '6px 16px', borderRadius: 8,
          }}>
            <span style={{ color: '#60a5fa', fontSize: 13 }}>
              📁 {stats.totalFrames || 0} frames saved
            </span>
            {stats.error && <span style={{ color: '#f59e0b', fontSize: 11 }}>({stats.error})</span>}
          </div>
        )}
      </div>

      {/* Sport tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
        {QA_SCENARIOS.map((s, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(i)}
            style={{
              padding: '8px 18px', borderRadius: 10,
              border: activeTab === i ? '2px solid #60a5fa' : '1px solid #333',
              background: activeTab === i ? 'rgba(96,165,250,0.15)' : 'transparent',
              color: activeTab === i ? '#60a5fa' : '#888',
              cursor: 'pointer', fontSize: 13, fontWeight: activeTab === i ? 'bold' : 'normal',
              transition: 'all 0.2s',
            }}
          >
            {s.sport} — {s.exercise}
          </button>
        ))}
      </div>

      {/* Active sport */}
      <div>
        <h2 style={{ fontSize: 18, color: '#fff', marginBottom: 16, textAlign: 'center' }}>
          {scenario.sport}: {scenario.exercise}
        </h2>
        {scenario.reps.map((rep, i) => (
          <RepRow key={i} rep={rep} sportName={scenario.sport} />
        ))}
      </div>

      {/* Summary */}
      <div style={{
        marginTop: 30, padding: 16, borderRadius: 12,
        background: 'rgba(96,165,250,0.05)', border: '1px solid #333',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 14, color: '#888' }}>Total QA Scenarios</div>
        <div style={{ fontSize: 28, fontWeight: 'bold', color: '#60a5fa' }}>
          {QA_SCENARIOS.length * 3} reps × 3 frames = {QA_SCENARIOS.length * 9} debug images
        </div>
      </div>
    </div>
  );
}
