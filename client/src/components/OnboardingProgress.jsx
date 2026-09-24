// Shared onboarding progress bar used across ProfileGate, SportSelection, Goals

const ONBOARDING_STEPS = [
  { key: 'details', labelHe: 'פרטים', labelEn: 'Details' },
  { key: 'scan', labelHe: 'סריקה', labelEn: 'Scan' },
  { key: 'profile', labelHe: 'פרופיל', labelEn: 'Profile' },
  { key: 'sport', labelHe: 'ספורט', labelEn: 'Sport' },
  { key: 'goals', labelHe: 'מטרות', labelEn: 'Goals' },
];

export default function OnboardingProgress({ currentStep, isHe }) {
  const stepIndex = ONBOARDING_STEPS.findIndex(s => s.key === currentStep);

  return (
    <div className="max-w-lg mx-auto mb-6">
      <div className="flex items-center justify-between">
        {ONBOARDING_STEPS.map((step, i) => {
          const isDone = i < stepIndex;
          const isCurrent = i === stepIndex;
          return (
            <div key={step.key} className="flex-1 flex flex-col items-center">
              <div className="flex items-center w-full">
                {i > 0 && (
                  <div className={`flex-1 h-0.5 ${isDone ? 'bg-blue-500' : 'bg-gray-200'}`} />
                )}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition ${
                    isDone
                      ? 'bg-blue-500 text-white'
                      : isCurrent
                      ? 'bg-blue-100 border-2 border-blue-500 text-blue-700'
                      : 'bg-gray-100 border border-gray-300 text-gray-400'
                  }`}
                >
                  {isDone ? '\u2713' : i + 1}
                </div>
                {i < ONBOARDING_STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 ${isDone ? 'bg-blue-500' : 'bg-gray-200'}`} />
                )}
              </div>
              <span className={`text-xs mt-1 ${isCurrent ? 'text-blue-700 font-semibold' : 'text-gray-400'}`}>
                {isHe ? step.labelHe : step.labelEn}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
