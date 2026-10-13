// ============================================================
// equipmentNeed — does this exercise need the equipment finder? (owner, 2026-10-13)
//
// OPT-IN ONLY: the finder runs only for an exercise that explicitly uses a chair, a bottle or a can
// (named in its name / description / instructions / tips). Every other exercise — bodyweight, ball
// drills (the ball is virtual), shadow drills — never shows it.
// ============================================================

const ITEMS = [
  { id: 'chair', words: ['כיסא', 'כסא', 'chair'] },
  { id: 'bottle', words: ['בקבוק', 'bottle'] },
  { id: 'can', words: ['פחית', 'פחיות', 'soda can', 'a can ', 'cans of', 'tin can'] },
];

const textOf = (v) => (Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : '');

/** The equipment this exercise explicitly uses ('chair' | 'bottle' | 'can'), or null. */
export function requiredEquipment(exercise) {
  if (!exercise) return null;
  const text = [exercise.name, exercise.nameEn, exercise.description, exercise.instructions, exercise.tips, exercise.equipment]
    .map(textOf).join(' ').toLowerCase()
    // a wheelchair is the trainee's own seat, not equipment to find
    .replace(/כיסא גלגלים|כסא גלגלים|כיסא הגלגלים|wheel ?chair/g, ' ');
  if (!text.trim()) return null;
  const hit = ITEMS.find(it => it.words.some(w => text.includes(w)));
  return hit ? hit.id : null;
}

export function needsEquipmentCheck(exercise) {
  return requiredEquipment(exercise) !== null;
}
