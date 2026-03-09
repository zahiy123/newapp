/**
 * Maps exercise names (Hebrew/English) to YouTube demo video IDs.
 * Uses keyword matching — same pattern as exerciseAnalysis.js ANALYZER_MAP.
 *
 * Each entry: { keywords: [...], videoId, start?, end? }
 * videoId = 11-char YouTube ID (NOT full URL)
 * start/end = seconds for &start= / &end= params
 */

const VIDEO_MAP = [
  {
    keywords: ['שכיבות סמיכה', 'push', 'פוש'],
    videoId: 'W_5nw911c_A',
    start: 0,
  },
  {
    keywords: ['גובלט', 'goblet'],
    videoId: 'i1sgX_-tiBU',
    start: 0,
  },
  {
    keywords: ['סקוואט', 'squat', 'כריעה'],
    videoId: '-5LhNSMBrEs',
    start: 0,
  },
  {
    keywords: ['פלאנק צידי', 'side plank'],
    videoId: '_R389Jk0tIo',
    start: 0,
  },
  {
    keywords: ['פלאנק', 'plank'],
    videoId: 'EPiXN2bkLoQ',
    start: 0,
  },
  {
    keywords: ['לאנג', 'lunge', 'מכרע'],
    videoId: 'g8-Ge9S0aUw',
    start: 0,
  },
  {
    keywords: ['דיפ', 'dip'],
    videoId: '4ua3MzaU0QU',
    start: 0,
  },
  {
    keywords: ['כפיפות מרפק', 'bicep', 'ביספ'],
    videoId: 'MKWBV29S6c0',
    start: 0,
  },
  {
    keywords: ['גשר ישבן', 'glute bridge'],
    videoId: 'tqp5XQPpTxYE',
    start: 0,
  },
  {
    keywords: ['כפיפות בטן', 'crunch'],
    videoId: 'NnVhqMQRvmM',
    start: 0,
  },
  {
    keywords: ['מטפס הרים', 'mountain climber'],
    videoId: 'kLh-uczlPLg',
    start: 0,
  },
  {
    keywords: ['ישיבה על הקיר', 'wall sit'],
    videoId: '6Li55TURhVg',
    start: 0,
  },
  {
    keywords: ['כתפיים', 'shoulder press', 'לחיצת כתפ'],
    videoId: 'RW52pKHs0mw',
    start: 0,
  },
  {
    keywords: ['הרמה צידית', 'lateral raise'],
    videoId: 'XPPfnSEATJA',
    start: 0,
  },
  {
    keywords: ['משיכת משקולת', 'row', 'bent over'],
    videoId: '6gvmcqr226U',
    start: 0,
  },
  {
    keywords: ['הרחבת מרפק', 'tricep', 'טריצפס'],
    videoId: 'b_r_LW4HEcM',
    start: 0,
  },
  {
    keywords: ['בורפי', 'burpee'],
    videoId: 'TU8QYVW0gDU',
    start: 0,
  },
  {
    keywords: ['jumping jack'],
    videoId: 'uLVt6u15L98',
    start: 0,
  },
];

/**
 * Find a YouTube video for a given exercise name.
 * @param {string} exerciseName - exercise name in Hebrew or English
 * @returns {{ videoId: string, start?: number, end?: number } | null}
 */
export function getExerciseVideo(exerciseName) {
  if (!exerciseName) return null;
  const lower = exerciseName.toLowerCase();
  for (const entry of VIDEO_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return { videoId: entry.videoId, start: entry.start, end: entry.end };
      }
    }
  }
  return null;
}
