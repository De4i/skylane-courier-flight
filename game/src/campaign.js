// Campaign progress, saved in localStorage: which missions are unlocked,
// and the best time, score and medal for each one. Mission 1 starts
// unlocked; finishing a mission unlocks the next. Nothing here is sent
// anywhere — it lives in this browser only.

import { CAMPAIGN_KEY } from './config.js';

const DEFAULT = { unlocked: 1, best: {} };

export function loadCampaign() {
  try {
    const raw = window.localStorage.getItem(CAMPAIGN_KEY);
    if (!raw) return { ...DEFAULT, best: {} };
    const parsed = JSON.parse(raw);
    return {
      unlocked: Math.max(1, Math.min(6, parsed.unlocked | 0 || 1)),
      best: parsed.best && typeof parsed.best === 'object' ? parsed.best : {},
    };
  } catch {
    return { ...DEFAULT, best: {} };
  }
}

export function saveCampaign(campaign) {
  try {
    window.localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(campaign));
  } catch {
    // Storage can be off (private windows): progress then lasts this visit only.
  }
}

/**
 * Record a finished mission. Returns the medal earned. Unlocks the next
 * mission and keeps the best (fastest) time and the highest score.
 */
export function recordFinish(campaign, missionId, number, time, score, medal) {
  const previous = campaign.best[missionId];
  const bestTime = previous ? Math.min(previous.time, time) : time;
  const bestScore = previous ? Math.max(previous.score, score) : score;
  const bestMedal = previous ? betterMedal(previous.medal, medal) : medal;
  campaign.best[missionId] = { time: bestTime, score: bestScore, medal: bestMedal };
  if (number < 6) campaign.unlocked = Math.max(campaign.unlocked, number + 1);
  saveCampaign(campaign);
  return medal;
}

function betterMedal(a, b) {
  const rank = { gold: 3, silver: 2, bronze: 1 };
  return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
}

export function medalEmoji(medal) {
  if (medal === 'gold') return '🥇';
  if (medal === 'silver') return '🥈';
  if (medal === 'bronze') return '🥉';
  return '';
}
