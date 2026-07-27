// ============================================================
// AnatomyProfileForm — Training Profile + Kinetic Summary
//
// Embedded in AnatomicScan during PROFILE_INPUT (after Phase A).
// Shows kinetic inference summary at top, training fields below.
// Anatomy fields are auto-filled by KineticAnalyzer — user
// only edits them if they click "No, edit".
// ============================================================

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { mergeWithExistingProfile } from '../engine/AnatomyProfile.js';


// ---- Button Group Component ----

function ButtonGroup({ options, value, onChange, columns = 3 }) {
  return (
    <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
            value === opt.value
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}


// ---- Limb name formatter ----

function formatLimbName(limbKey, t) {
  const map = {
    left_leg: t('scan.leftLeg'),
    right_leg: t('scan.rightLeg'),
    left_arm: t('scan.leftArm'),
    right_arm: t('scan.rightArm'),
  };
  return map[limbKey] || limbKey;
}


// ---- Main Form ----

export default function AnatomyProfileForm({
  existingProfile,
  onSubmit,
  onBack,
  onReset,
  missingFields: externalMissing,
  isHe,
  savedFormData,
  onFormChange,
  kineticProfile,
  kineticInferredProfile,
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({});
  const [highlightMissing, setHighlightMissing] = useState(false);
  const [editingAnatomy, setEditingAnatomy] = useState(false);
  const initializedRef = useRef(false);

  // Initialize form — use savedFormData if available (preserves state on back-navigation),
  // otherwise merge kinetic-inferred + existing profile
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (savedFormData && Object.keys(savedFormData).length > 0) {
      setForm(savedFormData);
    } else {
      const kineticInferred = kineticInferredProfile || { disability: 'none' };
      const merged = mergeWithExistingProfile(kineticInferred, existingProfile);
      setForm(merged);
    }
  }, [existingProfile, savedFormData, kineticInferredProfile]);

  function update(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      onFormChange?.(next);
      return next;
    });
    setHighlightMissing(false);
  }

  // Training fields validation
  const trainingFields = ['name', 'age', 'height', 'weight', 'skillLevel', 'trainingDays', 'trainingLocation', 'equipment'];

  function isMissing(field) {
    if (!highlightMissing) return false;
    const val = form[field];
    return val === '' || val === undefined || val === null;
  }

  function missingClass(field) {
    return isMissing(field) ? 'border-red-400 ring-1 ring-red-400' : '';
  }

  // Anatomy edit fields (only shown when user clicks "No, edit")
  const showAmputation = form.disability === 'one_leg' || form.disability === 'one_arm';
  const showMobilityAid = form.disability && form.disability !== 'none';
  const isLeg = form.disability === 'one_leg';

  function handleSubmit() {
    // Validate training fields
    const missing = trainingFields.filter(f => {
      const val = form[f];
      return val === '' || val === undefined || val === null;
    });
    if (missing.length > 0) {
      setHighlightMissing(true);
      return;
    }
    onSubmit({
      ...form,
      age: Number(form.age),
      height: Number(form.height),
      weight: Number(form.weight),
      trainingDays: Number(form.trainingDays),
    });
  }


  // ---- Kinetic Summary Banner ----

  function KineticSummaryBanner() {
    if (!kineticProfile) return null;

    const isNatural = kineticProfile.overallPosture === 'natural';
    const isProsthetic = kineticProfile.overallPosture === 'prosthetic_detected';
    const isInsufficient = kineticProfile.overallPosture === 'insufficient';

    return (
      <div style={styles.kineticBanner}>
        <div style={styles.kineticBannerContent}>
          {isNatural && (
            <span style={styles.kineticText}>{t('scan.kineticSummaryNormal')}</span>
          )}
          {isProsthetic && (
            <div>
              <span style={styles.kineticText}>{t('scan.kineticSummaryProsthetic')}</span>
              <span style={styles.kineticLimbs}>
                {' '}{kineticProfile.detectedProsthetics.map(l => formatLimbName(l, t)).join(', ')}
              </span>
            </div>
          )}
          {isInsufficient && (
            <span style={styles.kineticText}>{t('scan.kineticInsufficient')}</span>
          )}

          {!editingAnatomy && (
            <div style={styles.kineticActions}>
              <span style={styles.kineticQuestion}>{t('scan.kineticConfirmQuestion')}</span>
              <div style={styles.kineticButtons}>
                <button type="button" onClick={() => setEditingAnatomy(false)} style={styles.kineticConfirmBtn}>
                  {t('scan.kineticConfirmBtn')}
                </button>
                <button type="button" onClick={() => setEditingAnatomy(true)} style={styles.kineticEditBtn}>
                  {t('scan.kineticEditBtn')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }


  // ---- Anatomy Edit Section (only when user clicks "No, edit") ----

  function AnatomyEditSection() {
    if (!editingAnatomy) return null;

    return (
      <div style={styles.anatomyEditSection}>
        <h4 style={styles.subTitle}>{t('scan.anatomyStepTitle')}</h4>

        {/* Disability Type */}
        <label style={styles.label}>{t('scan.disabilityLabel')}</label>
        <ButtonGroup
          columns={2}
          value={form.disability}
          onChange={v => update('disability', v)}
          options={[
            { value: 'none', label: t('scan.disabilityNone') },
            { value: 'one_leg', label: t('scan.disabilityOneLeg') },
            { value: 'one_arm', label: t('scan.disabilityOneArm') },
            { value: 'two_legs', label: t('scan.disabilityTwoLegs') },
            { value: 'two_arms', label: t('scan.disabilityTwoArms') },
            { value: 'paralyzed', label: t('scan.disabilityParalyzed') },
            { value: 'wheelchair', label: t('scan.disabilityWheelchair') },
            { value: 'other', label: t('scan.disabilityOther') },
          ]}
        />

        {/* Amputation Side */}
        {showAmputation && (
          <>
            <label style={styles.label}>{t('scan.amputationSide')}</label>
            <ButtonGroup
              columns={2}
              value={form.amputationSide}
              onChange={v => update('amputationSide', v)}
              options={[
                { value: 'left', label: t('scan.sideLeft') },
                { value: 'right', label: t('scan.sideRight') },
              ]}
            />
          </>
        )}

        {/* Amputation Level */}
        {showAmputation && (
          <>
            <label style={styles.label}>{t('scan.amputationLevel')}</label>
            <ButtonGroup
              columns={2}
              value={form.amputationLevel}
              onChange={v => update('amputationLevel', v)}
              options={isLeg
                ? [
                    { value: 'above_knee', label: t('scan.aboveKnee') },
                    { value: 'below_knee', label: t('scan.belowKnee') },
                  ]
                : [
                    { value: 'above_elbow', label: t('scan.aboveElbow') },
                    { value: 'below_elbow', label: t('scan.belowElbow') },
                  ]
              }
            />
          </>
        )}

        {/* Mobility Aid */}
        {showMobilityAid && (
          <>
            <label style={styles.label}>{t('scan.mobilityAid')}</label>
            <ButtonGroup
              columns={2}
              value={form.mobilityAid}
              onChange={v => update('mobilityAid', v)}
              options={[
                { value: 'none', label: t('scan.aidNone') },
                { value: 'crutches', label: t('scan.aidCrutches') },
                { value: 'prosthesis', label: t('scan.aidProsthesis') },
                { value: 'wheelchair', label: t('scan.aidWheelchair') },
              ]}
            />
          </>
        )}
      </div>
    );
  }


  // ---- Render ----

  return (
    <div style={styles.container}>
      <KineticSummaryBanner />
      <AnatomyEditSection />

      <h3 style={styles.title}>{t('scan.trainingStepTitle')}</h3>

      {/* Name */}
      <label style={styles.label}>{t('scan.nameLabel')}</label>
      <input
        type="text"
        value={form.name || ''}
        onChange={e => update('name', e.target.value)}
        className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none ${missingClass('name')}`}
      />

      {/* Age / Height / Weight */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label style={styles.label}>{t('scan.ageLabel')}</label>
          <input
            type="number"
            min="5"
            max="99"
            value={form.age || ''}
            onChange={e => update('age', e.target.value)}
            className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none ${missingClass('age')}`}
          />
        </div>
        <div>
          <label style={styles.label}>{t('scan.heightLabel')}</label>
          <input
            type="number"
            min="50"
            max="250"
            value={form.height || ''}
            onChange={e => update('height', e.target.value)}
            className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none ${missingClass('height')}`}
          />
        </div>
        <div>
          <label style={styles.label}>{t('scan.weightLabel')}</label>
          <input
            type="number"
            min="10"
            max="300"
            value={form.weight || ''}
            onChange={e => update('weight', e.target.value)}
            className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none ${missingClass('weight')}`}
          />
        </div>
      </div>

      {/* Skill Level */}
      <label style={styles.label}>{t('scan.skillLevelLabel')}</label>
      <ButtonGroup
        columns={3}
        value={form.skillLevel}
        onChange={v => update('skillLevel', v)}
        options={[
          { value: 'beginner', label: t('scan.skillBeginner') },
          { value: 'intermediate', label: t('scan.skillIntermediate') },
          { value: 'pro', label: t('scan.skillPro') },
        ]}
      />

      {/* Training Days */}
      <label style={styles.label}>{t('scan.trainingDaysLabel')}</label>
      <ButtonGroup
        columns={5}
        value={String(form.trainingDays)}
        onChange={v => update('trainingDays', v)}
        options={[2, 3, 4, 5, 6].map(n => ({ value: String(n), label: String(n) }))}
      />

      {/* Training Location */}
      <label style={styles.label}>{t('scan.trainingLocationLabel')}</label>
      <ButtonGroup
        columns={4}
        value={form.trainingLocation}
        onChange={v => update('trainingLocation', v)}
        options={[
          { value: 'home', label: t('scan.locHome') },
          { value: 'yard', label: t('scan.locYard') },
          { value: 'field', label: t('scan.locField') },
          { value: 'gym', label: t('scan.locGym') },
        ]}
      />

      {/* Equipment */}
      <label style={styles.label}>{t('scan.equipmentLabel')}</label>
      <ButtonGroup
        columns={3}
        value={form.equipment}
        onChange={v => update('equipment', v)}
        options={[
          { value: 'none', label: t('scan.eqNone') },
          { value: 'dumbbells', label: t('scan.eqDumbbells') },
          { value: 'resistance_bands', label: t('scan.eqBands') },
        ]}
      />

      {highlightMissing && (
        <p style={styles.errorText}>{t('scan.profileIncomplete')}</p>
      )}

      {/* Submit */}
      <div style={styles.navRow}>
        <button type="button" onClick={onBack} style={styles.backBtn}>
          {t('scan.prevStep')}
        </button>
        <button type="button" onClick={handleSubmit} style={styles.submitBtn}>
          {t('scan.confirmAndContinue')}
        </button>
      </div>
      <button type="button" onClick={onReset} style={styles.resetBtn}>
        {t('scan.startOver')}
      </button>
    </div>
  );
}


// ---- Styles ----

const styles = {
  container: {
    maxWidth: 480,
    margin: '0 auto',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: '#1e293b',
    marginBottom: 4,
    textAlign: 'center',
  },
  subTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 4,
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#475569',
    marginTop: 4,
    marginBottom: 2,
  },
  errorText: {
    fontSize: 12,
    color: '#dc2626',
    margin: 0,
  },
  navRow: {
    display: 'flex',
    gap: 12,
    marginTop: 8,
  },
  backBtn: {
    flex: 1,
    padding: '10px 16px',
    borderRadius: 10,
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#374151',
    fontWeight: 600,
    fontSize: 15,
    cursor: 'pointer',
  },
  submitBtn: {
    flex: 2,
    padding: '10px 16px',
    borderRadius: 10,
    border: 'none',
    background: '#16a34a',
    color: '#fff',
    fontWeight: 600,
    fontSize: 15,
    cursor: 'pointer',
  },
  resetBtn: {
    width: '100%',
    padding: '8px 16px',
    borderRadius: 10,
    border: 'none',
    background: 'transparent',
    color: '#94a3b8',
    fontWeight: 500,
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'center',
    marginTop: 4,
  },
  // Kinetic summary banner
  kineticBanner: {
    padding: '12px 16px',
    borderRadius: 10,
    backgroundColor: '#f0fdf4',
    border: '1px solid #86efac',
    marginBottom: 4,
  },
  kineticBannerContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  kineticText: {
    fontSize: 14,
    fontWeight: 600,
    color: '#166534',
  },
  kineticLimbs: {
    fontSize: 14,
    fontWeight: 500,
    color: '#b91c1c',
  },
  kineticQuestion: {
    fontSize: 13,
    color: '#475569',
  },
  kineticActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  kineticButtons: {
    display: 'flex',
    gap: 8,
  },
  kineticConfirmBtn: {
    flex: 1,
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid #86efac',
    background: '#dcfce7',
    color: '#166534',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  kineticEditBtn: {
    flex: 1,
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid #fca5a5',
    background: '#fef2f2',
    color: '#991b1b',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  // Anatomy edit section (hidden by default)
  anatomyEditSection: {
    padding: '12px 16px',
    borderRadius: 10,
    backgroundColor: '#fef3c7',
    border: '1px solid #fcd34d',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
};
