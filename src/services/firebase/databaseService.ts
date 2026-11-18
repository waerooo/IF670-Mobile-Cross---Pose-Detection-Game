/**
 */

import firestore from '@react-native-firebase/firestore';
import type { GameSession, UserStats, Achievement } from '../../types';

// ── Collections ──────────────────────────────────────────────

const SESSIONS_COL = 'gameSessions';
const USERS_COL = 'users';
const ACHIEVEMENTS_COL = 'achievements';

// ── Game Session ─────────────────────────────────────────────

/**
 * Save a completed game session to Firestore.
 * Called by GameScreen after game ends (A2 + A4 integration).
 */
export async function saveGameSession(session: Omit<GameSession, 'id'>): Promise<string> {
  try {
    const ref = await firestore()
      .collection(SESSIONS_COL)
      .add({
        ...session,
        createdAt: firestore.FieldValue.serverTimestamp(),
      });

    // Also update user aggregate stats
    await _incrementUserStats(session.userId, session);

    return ref.id;
  } catch (err) {
    console.error('[DB] saveGameSession error:', err);
    throw err;
  }
}

/**
 * Fetch the last N game sessions for a user (for Stats screen).
 */
export async function fetchRecentSessions(
  userId: string,
  limit: number = 10,
): Promise<GameSession[]> {
  try {
    const snap = await firestore()
      .collection(SESSIONS_COL)
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as GameSession));
  } catch (err) {
    console.error('[DB] fetchRecentSessions error:', err);
    return [];
  }
}

// ── User Stats ───────────────────────────────────────────────

/**
 * Fetch aggregate stats for the Settings screen.
 */
export async function fetchUserStats(userId: string): Promise<UserStats | null> {
  try {
    const doc = await firestore().collection(USERS_COL).doc(userId).get();
    if (!doc.exists) return null;
    return (doc.data()?.stats ?? null) as UserStats | null;
  } catch (err) {
    console.error('[DB] fetchUserStats error:', err);
    return null;
  }
}

/** Internal: increment aggregate stats atomically after each game. */
async function _incrementUserStats(
  userId: string,
  session: Omit<GameSession, 'id'>,
): Promise<void> {
  const ref = firestore().collection(USERS_COL).doc(userId);

  await firestore().runTransaction(async tx => {
    const doc = await tx.get(ref);
    const current: UserStats = doc.exists
      ? (doc.data()?.stats as UserStats)
      : { totalGames: 0, totalScore: 0, totalPoses: 0, bestScore: 0, averageAccuracy: 0 };

    const newTotal = current.totalGames + 1;
    const newScore = current.totalScore + session.score;
    const newPoses = current.totalPoses + session.poseCount;
    const newBest = Math.max(current.bestScore, session.score);
    const newAvgAcc = Math.round(
      (current.averageAccuracy * current.totalGames + session.accuracy) / newTotal,
    );

    tx.set(
      ref,
      {
        stats: {
          totalGames: newTotal,
          totalScore: newScore,
          totalPoses: newPoses,
          bestScore: newBest,
          averageAccuracy: newAvgAcc,
        },
      },
      { merge: true },
    );
  });
}

// ── Achievements ─────────────────────────────────────────────

/**
 * Fetch all achievements for the Achievement screen.
 * Unlocked achievements have `unlockedAt` set.
 */
export async function fetchAchievements(userId: string): Promise<Achievement[]> {
  try {
    const [masterSnap, userSnap] = await Promise.all([
      firestore().collection(ACHIEVEMENTS_COL).orderBy('requiredScore').get(),
      firestore()
        .collection(USERS_COL)
        .doc(userId)
        .collection('unlockedAchievements')
        .get(),
    ]);

    const unlockedMap = new Map<string, number>();
    userSnap.docs.forEach(doc => {
      unlockedMap.set(doc.id, doc.data().unlockedAt as number);
    });

    return masterSnap.docs.map(doc => ({
      id: doc.id,
      ...(doc.data() as Omit<Achievement, 'id' | 'unlockedAt'>),
      unlockedAt: unlockedMap.get(doc.id),
    }));
  } catch (err) {
    console.error('[DB] fetchAchievements error:', err);
    return [];
  }
}

/**
 * Check and unlock achievements based on latest stats.
 * Call after saveGameSession resolves.
 */
export async function checkAndUnlockAchievements(
  userId: string,
  stats: UserStats,
): Promise<Achievement[]> {
  try {
    const all = await fetchAchievements(userId);
    const newlyUnlocked: Achievement[] = [];

    for (const ach of all) {
      if (ach.unlockedAt) continue; // already unlocked

      const scoreOk = ach.requiredScore ? stats.bestScore >= ach.requiredScore : true;
      const posesOk = ach.requiredPoses ? stats.totalPoses >= ach.requiredPoses : true;

      if (scoreOk && posesOk) {
        const unlockedAt = Date.now();
        await firestore()
          .collection(USERS_COL)
          .doc(userId)
          .collection('unlockedAchievements')
          .doc(ach.id)
          .set({ unlockedAt });

        newlyUnlocked.push({ ...ach, unlockedAt });
      }
    }

    return newlyUnlocked;
  } catch (err) {
    console.error('[DB] checkAndUnlockAchievements error:', err);
    return [];
  }
}
