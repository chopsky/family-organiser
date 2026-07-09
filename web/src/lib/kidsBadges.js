// Kids-mode streak badges — display metadata for the four milestone tiers a
// streak can unlock, plus a cheerful one-liner for the Quests streak card.
// The tiers + star bonuses are defined server-side (src/services/kids-streak.js);
// this file is purely how they LOOK. Badges are earned by keeping a daily-quest
// streak going - they are never bought, and buying cosmetics never grants one
// (the decoupling; see docs/kids-engagement-plan.md).

export const BADGE_META = {
  streak_7: { emoji: '🔥', label: 'Week Warrior', blurb: '7-day streak', tier: 7 },
  streak_30: { emoji: '⚡', label: 'Monthly Master', blurb: '30-day streak', tier: 30 },
  streak_100: { emoji: '🌟', label: 'Century Streak', blurb: '100-day streak', tier: 100 },
  streak_365: { emoji: '👑', label: 'Year-Long Legend', blurb: '365-day streak', tier: 365 },
};

// Fixed display order (easiest -> hardest) for the badge shelf.
export const BADGE_ORDER = ['streak_7', 'streak_30', 'streak_100', 'streak_365'];

/**
 * A kid-friendly line for the streak card, given the streak payload
 * ({ current, longest, satisfiedToday, atRisk, nextMilestone }).
 */
export function streakLine(s) {
  if (!s || s.current <= 0) return 'Do your quests to start a streak!';
  if (s.atRisk) return `Finish today to keep your ${s.current}-day streak! 🔥`;
  if (s.satisfiedToday) return `${s.current} days in a row — amazing! 🎉`;
  return `${s.current}-day streak going strong!`;
}
