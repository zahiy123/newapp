// Sport-specific game rules engine

export const GAME_SPORTS = {
  footballAmputee: {
    key: 'footballAmputee',
    name: { he: 'כדורגל קטועים', en: 'Amputee Football' },
    icon: '\u26BD',
    defaultHalfLength: 25, // minutes
    playersPerTeam: 7,
    rules: {
      noOffside: true,
      fieldSize: '60x40m',
      goalKeeperUpperLimb: true,
    }
  },
  football: {
    key: 'football',
    name: { he: 'כדורגל', en: 'Football' },
    icon: '\u26BD',
    defaultHalfLength: 45,
    playersPerTeam: 11,
    rules: {}
  },
  basketball: {
    key: 'basketball',
    name: { he: 'כדורסל', en: 'Basketball' },
    icon: '\uD83C\uDFC0',
    defaultHalfLength: 10, // quarter
    playersPerTeam: 5,
    rules: {}
  },
};

// Foul detection rules
export const FOUL_RULES = {
  footballAmputee: [
    {
      id: 'crutch_contact',
      name: { he: 'מגע קביים', en: 'Crutch Contact' },
      description: { he: 'שימוש בקב לעצירת יריב', en: 'Using crutch to block opponent' },
      // Detection: check if two players\' wrist/elbow landmarks overlap
      detect(playerPoses) {
        if (playerPoses.length < 2) return null;
        for (let i = 0; i < playerPoses.length; i++) {
          for (let j = i + 1; j < playerPoses.length; j++) {
            const dist = playerDistance(playerPoses[i], playerPoses[j]);
            // Very close proximity + wrist overlap suggests crutch contact
            if (dist < 0.05) {
              const wristOverlap = checkWristOverlap(playerPoses[i].landmarks, playerPoses[j].landmarks);
              if (wristOverlap) return { players: [i, j], type: 'crutch_contact' };
            }
          }
        }
        return null;
      }
    },
    {
      id: 'dangerous_play',
      name: { he: 'משחק מסוכן', en: 'Dangerous Play' },
      description: { he: 'שימוש מסוכן בקביים', en: 'Dangerous use of crutches' },
      detect(playerPoses) {
        // Detect high crutch swings (wrist above shoulder level near other player)
        for (let i = 0; i < playerPoses.length; i++) {
          const lm = playerPoses[i].landmarks;
          const shoulder = lm[11]; // left shoulder
          const wrist = lm[15]; // left wrist
          if (shoulder && wrist && wrist.visibility > 0.3 && shoulder.visibility > 0.3) {
            if (wrist.y < shoulder.y - 0.1) { // wrist significantly above shoulder
              // Check if another player is nearby
              for (let j = 0; j < playerPoses.length; j++) {
                if (i !== j && playerDistance(playerPoses[i], playerPoses[j]) < 0.1) {
                  return { players: [i, j], type: 'dangerous_play' };
                }
              }
            }
          }
        }
        return null;
      }
    }
  ],
  football: [
    {
      id: 'handball',
      name: { he: 'נגיעת יד', en: 'Handball' },
      description: { he: 'נגיעה בכדור עם היד', en: 'Touching ball with hand' },
      detect() { return null; } // requires ball tracking
    }
  ],
  basketball: [],
};

// Event types per sport with marker colors for video analysis timeline
export const GAME_EVENT_TYPES = {
  footballAmputee: {
    goal: { color: '#22c55e', icon: '\u26BD', he: 'גול', en: 'Goal' },
    foul: { color: '#eab308', icon: '\uD83D\uDFE8', he: 'עבירה', en: 'Foul' },
    corner: { color: '#3b82f6', icon: '\uD83D\uDEA9', he: 'קרנית', en: 'Corner' },
    throw_in: { color: '#8b5cf6', icon: '\u2194\uFE0F', he: 'זריקת אאוט', en: 'Throw-in' },
    penalty: { color: '#ef4444', icon: '\uD83C\uDFAF', he: 'פנדל', en: 'Penalty' },
    free_kick: { color: '#f97316', icon: '\u2B50', he: 'בעיטה חופשית', en: 'Free Kick' },
    yellow_card: { color: '#facc15', icon: '\uD83D\uDFE8', he: 'כרטיס צהוב', en: 'Yellow Card' },
    red_card: { color: '#dc2626', icon: '\uD83D\uDFE5', he: 'כרטיס אדום', en: 'Red Card' },
  },
  football: {
    goal: { color: '#22c55e', icon: '\u26BD', he: 'גול', en: 'Goal' },
    foul: { color: '#eab308', icon: '\uD83D\uDFE8', he: 'עבירה', en: 'Foul' },
    corner: { color: '#3b82f6', icon: '\uD83D\uDEA9', he: 'קרנית', en: 'Corner' },
    throw_in: { color: '#8b5cf6', icon: '\u2194\uFE0F', he: 'זריקת אאוט', en: 'Throw-in' },
    penalty: { color: '#ef4444', icon: '\uD83C\uDFAF', he: 'פנדל', en: 'Penalty' },
    free_kick: { color: '#f97316', icon: '\u2B50', he: 'בעיטה חופשית', en: 'Free Kick' },
    offside: { color: '#6366f1', icon: '\u26A0\uFE0F', he: 'נבדל', en: 'Offside' },
    yellow_card: { color: '#facc15', icon: '\uD83D\uDFE8', he: 'כרטיס צהוב', en: 'Yellow Card' },
    red_card: { color: '#dc2626', icon: '\uD83D\uDFE5', he: 'כרטיס אדום', en: 'Red Card' },
  },
  basketball: {
    basket_2pt: { color: '#22c55e', icon: '\uD83C\uDFC0', he: 'סל 2 נקודות', en: '2-Point Basket' },
    basket_3pt: { color: '#10b981', icon: '\uD83C\uDFC0', he: 'סל 3 נקודות', en: '3-Point Basket' },
    foul: { color: '#eab308', icon: '\uD83D\uDFE8', he: 'עבירה', en: 'Foul' },
    turnover: { color: '#f97316', icon: '\uD83D\uDD04', he: 'איבוד כדור', en: 'Turnover' },
    block: { color: '#3b82f6', icon: '\u270B', he: 'חסימה', en: 'Block' },
  },
};

// Goal detection — simplified zone-based
export function detectGoalZone(ballPosition, goalZone) {
  if (!ballPosition || !goalZone) return false;
  return (
    ballPosition.x >= goalZone.x &&
    ballPosition.x <= goalZone.x + goalZone.width &&
    ballPosition.y >= goalZone.y &&
    ballPosition.y <= goalZone.y + goalZone.height
  );
}

// Player tracking — assign consistent IDs based on position continuity
export function trackPlayers(prevPlayers, currentPoses) {
  if (prevPlayers.length === 0) {
    return currentPoses.map((p, i) => ({ ...p, trackId: i + 1 }));
  }

  const assigned = new Set();
  const tracked = currentPoses.map(pose => {
    let bestMatch = null;
    let bestDist = Infinity;

    for (const prev of prevPlayers) {
      if (assigned.has(prev.trackId)) continue;
      const dist = Math.hypot(pose.center.x - prev.center.x, pose.center.y - prev.center.y);
      if (dist < bestDist && dist < 0.15) { // max movement threshold
        bestDist = dist;
        bestMatch = prev;
      }
    }

    if (bestMatch) {
      assigned.add(bestMatch.trackId);
      return { ...pose, trackId: bestMatch.trackId };
    }
    return { ...pose, trackId: null };
  });

  // Assign new IDs to unmatched players
  let nextId = Math.max(0, ...prevPlayers.map(p => p.trackId)) + 1;
  return tracked.map(p => p.trackId ? p : { ...p, trackId: nextId++ });
}

// Helper: distance between two players' centers
function playerDistance(p1, p2) {
  return Math.hypot(p1.center.x - p2.center.x, p1.center.y - p2.center.y);
}

// Helper: check wrist-to-body overlap between two players
function checkWristOverlap(lm1, lm2) {
  const wrists1 = [lm1[15], lm1[16]].filter(w => w?.visibility > 0.3);
  const torso2 = [lm2[11], lm2[12], lm2[23], lm2[24]].filter(t => t?.visibility > 0.3);

  for (const w of wrists1) {
    for (const t of torso2) {
      const dist = Math.hypot(w.x - t.x, w.y - t.y);
      if (dist < 0.04) return true;
    }
  }
  return false;
}
