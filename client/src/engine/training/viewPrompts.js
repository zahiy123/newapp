// "Step into the frame" prompts for the body part an exercise / warm-up move needs.
// Shared by the warm-up timer and the Expert Execution gate (Stage 3.1).

/** @param {'legs'|'arms'|'upper'|'torso'|'body'|string} part */
export function viewPromptText(part, isHe) {
  if (part === 'legs') return isHe ? 'לא רואים את הרגליים — אנא היכנס למסגרת' : "I can't see your legs — please step into the frame";
  if (part === 'upper' || part === 'torso') return isHe ? 'לא רואים את הכתפיים — אנא היכנס למסגרת' : "I can't see your shoulders — please step into the frame";
  if (part === 'body') return isHe ? 'לא רואים את כל הגוף — התרחק קצת מהמצלמה' : "I can't see your whole body — move back a little";
  return isHe ? 'לא רואים את הידיים — אנא היכנס למסגרת' : "I can't see your arms — please step into the frame";
}

/** Camera placement hint for a profile's best measuring view. */
export function cameraViewHint(view, isHe) {
  if (view === 'side') return isHe ? 'לדיוק מרבי — עמוד עם הצד למצלמה' : 'For best accuracy — stand side-on to the camera';
  return isHe ? 'עמוד מול המצלמה' : 'Face the camera';
}
