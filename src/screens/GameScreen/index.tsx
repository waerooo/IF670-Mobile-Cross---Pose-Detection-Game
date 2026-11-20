/**
 *
 * Flow:
 *  1. Camera preview (react-native-vision-camera v4)
 *  2. Countdown → Active game (60 s timer)
 *  3. Every 2 s: take photo → ML Kit → classify pose → score
 *  4. Game ends → save to Firebase → show summary
 */

import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import {Camera, useCameraDevice} from 'react-native-vision-camera';
import {useCameraPermission} from '../../hooks/useCameraPermission';
import {
  detectPoseFromPhoto,
  releasePoseDetector,
} from '../../services/mlkit/poseDetectionService';
import {
  validatePose,
  calculatePoseScore,
  calculateAccuracy,
} from '../../utils/poseDetection/poseHelpers';
import {saveGameSession} from '../../services/firebase/databaseService';
import {COLORS, GAME_DURATION_SECONDS} from '../../constants';
import type {GameStatus, GameChallenge, PoseValidationResult} from '../../types';

// ── Challenges ───────────────────────────────────────────────

const CHALLENGES: GameChallenge[] = [
  { id: '1', poseLabel: 'T_POSE', displayName: 'T-Pose', emoji: '✈️', durationMs: 2000, pointsReward: 10 },
  { id: '2', poseLabel: 'HANDS_UP', displayName: 'Hands Up!', emoji: '🙌', durationMs: 2000, pointsReward: 8 },
  { id: '3', poseLabel: 'SQUAT', displayName: 'Squat', emoji: '🏋️', durationMs: 2000, pointsReward: 12 },
  { id: '4', poseLabel: 'LUNGE_LEFT', displayName: 'Lunge Left', emoji: '👈', durationMs: 2000, pointsReward: 10 },
  { id: '5', poseLabel: 'LUNGE_RIGHT', displayName: 'Lunge Right', emoji: '👉', durationMs: 2000, pointsReward: 10 },
  { id: '6', poseLabel: 'JUMPING_JACK_OPEN', displayName: 'Jump Wide!', emoji: '🌟', durationMs: 2000, pointsReward: 8 },
];

function getRandomChallenge(): GameChallenge {
  return CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
}

// ── Component ────────────────────────────────────────────────

interface GameScreenProps {
  userId?: string; // passed from navigation / auth context
  onBackToMenu?: () => void;
}

const GameScreen: React.FC<GameScreenProps> = ({
  userId = 'anonymous',
  onBackToMenu,
}) => {
  // Camera
  const { isGranted, isLoading: permLoading, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const cameraRef = useRef<Camera>(null);

  // Game state
  const [gameStatus, setGameStatus] = useState<GameStatus>('IDLE');
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_SECONDS);
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [poseCount, setPoseCount] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [currentChallenge, setCurrentChallenge] = useState<GameChallenge>(getRandomChallenge());
  const [lastResult, setLastResult] = useState<PoseValidationResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [finalPoses, setFinalPoses] = useState(0);
  const [finalAccuracy, setFinalAccuracy] = useState(0);

  // Refs (avoid stale closures in intervals)
  const scoreRef = useRef(0);
  const poseCountRef = useRef(0);
  const framesRef = useRef(0);
  const detectionRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Cleanup on unmount ──────────────────────────────────────

  useEffect(() => {
    return () => {
      clearIntervals();
      releasePoseDetector();
    };
  }, []);

  function clearIntervals() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (detectionRef.current) clearInterval(detectionRef.current);
    timerRef.current = null;
    detectionRef.current = null;
  }

  // ── Countdown → Start ───────────────────────────────────────

  const startCountdown = useCallback(() => {
    setGameStatus('COUNTDOWN');
    setCountdown(3);

    let count = 3;
    const id = setInterval(() => {
      count -= 1;
      setCountdown(count);
      if (count === 0) {
        clearInterval(id);
        startGame();
      }
    }, 1000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Game Loop ───────────────────────────────────────────────

  const startGame = useCallback(() => {
    // Reset state
    scoreRef.current = 0;
    poseCountRef.current = 0;
    framesRef.current = 0;
    setScore(0);
    setPoseCount(0);
    setTotalFrames(0);
    setTimeLeft(GAME_DURATION_SECONDS);
    setLastResult(null);
    setGameStatus('ACTIVE');
    setCurrentChallenge(getRandomChallenge());

    // Countdown timer
    let remaining = GAME_DURATION_SECONDS;
    timerRef.current = setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        endGame();
      }
    }, 1000);

    // Pose detection every 2 seconds
    detectionRef.current = setInterval(async () => {
      await captureAndDetect();
    }, 2000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const captureAndDetect = useCallback(async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
      });

      framesRef.current += 1;
      setTotalFrames(framesRef.current);

      const pose = await detectPoseFromPhoto(`file://${photo.path}`);
      if (!pose) return;

      const result = validatePose(pose);
      setLastResult(result);

      if (result.isValid && result.label === currentChallenge.poseLabel) {
        const pts = calculatePoseScore(result);
        scoreRef.current += pts;
        poseCountRef.current += 1;
        setScore(scoreRef.current);
        setPoseCount(poseCountRef.current);
        // Switch to next challenge after success
        setCurrentChallenge(getRandomChallenge());
      }
    } catch (err) {
      // Camera not ready / permission revoked mid-game → ignore silently
    }
  }, [currentChallenge]);

  const endGame = useCallback(async () => {
    clearIntervals();
    setGameStatus('ENDED');

    const accuracy = calculateAccuracy(poseCountRef.current, framesRef.current);
    setFinalScore(scoreRef.current);
    setFinalPoses(poseCountRef.current);
    setFinalAccuracy(accuracy);

    // ── Save to Firebase (A2 integration point) ──────────────
    setIsSaving(true);
    try {
      await saveGameSession({
        userId,
        score: scoreRef.current,
        poseCount: poseCountRef.current,
        duration: GAME_DURATION_SECONDS,
        accuracy,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error('[GameScreen] Failed to save session:', err);
      Alert.alert('Peringatan', 'Skor tidak tersimpan. Cek koneksi internet.');
    } finally {
      setIsSaving(false);
    }

    setShowSummary(true);
  }, [userId]);

  const restartGame = useCallback(() => {
    setShowSummary(false);
    setGameStatus('IDLE');
    setTimeLeft(GAME_DURATION_SECONDS);
    setScore(0);
    setPoseCount(0);
  }, []);

  // ── Permission Screen ───────────────────────────────────────

  if (permLoading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.infoText}>Memeriksa izin kamera...</Text>
        {onBackToMenu && (
          <TouchableOpacity style={styles.primaryButton} onPress={onBackToMenu}>
            <Text style={styles.primaryButtonText}>Kembali ke Menu</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (!isGranted) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.icon}>📷</Text>
        <Text style={styles.titleText}>Izin Kamera Diperlukan</Text>
        <Text style={styles.infoText}>
          SnapFit perlu mengakses kamera untuk mendeteksi pose kamu.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Izinkan Kamera</Text>
        </TouchableOpacity>
        {onBackToMenu && (
          <TouchableOpacity style={styles.secondaryButton} onPress={onBackToMenu}>
            <Text style={styles.secondaryButtonText}>Kembali ke Menu</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.icon}>❌</Text>
        <Text style={styles.infoText}>Kamera tidak tersedia di perangkat ini.</Text>
        {onBackToMenu && (
          <TouchableOpacity style={styles.primaryButton} onPress={onBackToMenu}>
            <Text style={styles.primaryButtonText}>Kembali ke Menu</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Main Render ─────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* ── Camera Feed ── */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={gameStatus !== 'ENDED'}
        photo={true}
      />

      {/* ── HUD ── */}
      <View style={styles.hud}>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>⏱ Waktu</Text>
          <Text style={[styles.hudValue, timeLeft <= 10 && styles.hudValueDanger]}>
            {timeLeft}s
          </Text>
        </View>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>⭐ Skor</Text>
          <Text style={styles.hudValue}>{score}</Text>
        </View>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>💪 Pose</Text>
          <Text style={styles.hudValue}>{poseCount}</Text>
        </View>
      </View>

      {/* ── Challenge Card ── */}
      {gameStatus === 'ACTIVE' && (
        <View style={styles.challengeCard}>
          <Text style={styles.challengeEmoji}>{currentChallenge.emoji}</Text>
          <Text style={styles.challengeText}>{currentChallenge.displayName}</Text>
          {lastResult && (
            <Text style={[
              styles.feedbackText,
              lastResult.isValid ? styles.feedbackSuccess : styles.feedbackFail,
            ]}>
              {lastResult.isValid
                ? `✅ +${calculatePoseScore(lastResult)} pts`
                : '❌ Coba lagi!'}
            </Text>
          )}
        </View>
      )}

      {/* ── Countdown Overlay ── */}
      {gameStatus === 'COUNTDOWN' && (
        <View style={styles.countdownOverlay}>
          <Text style={styles.countdownText}>{countdown}</Text>
          <Text style={styles.countdownSubText}>Bersiap...</Text>
        </View>
      )}

      {/* ── Idle Start Button ── */}
      {gameStatus === 'IDLE' && (
        <View style={styles.idleOverlay}>
          <Text style={styles.titleText}>SnapFit 💪</Text>
          <Text style={styles.infoText}>Ikuti pose yang ditampilkan sebelum waktu habis!</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={startCountdown}>
            <Text style={styles.primaryButtonText}>Mulai Game</Text>
          </TouchableOpacity>
          {onBackToMenu && (
            <TouchableOpacity style={styles.secondaryButton} onPress={onBackToMenu}>
              <Text style={styles.secondaryButtonText}>Kembali ke Menu</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Saving Indicator ── */}
      {isSaving && (
        <View style={styles.savingOverlay}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.infoText}>Menyimpan skor...</Text>
        </View>
      )}

      {/* ── Game Summary Modal ── */}
      <Modal visible={showSummary} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🏁 Game Selesai!</Text>

            <View style={styles.statRow}>
              <Text style={styles.statLabel}>⭐ Skor Akhir</Text>
              <Text style={styles.statValue}>{finalScore}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>💪 Pose Berhasil</Text>
              <Text style={styles.statValue}>{finalPoses}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>🎯 Akurasi</Text>
              <Text style={styles.statValue}>{finalAccuracy}%</Text>
            </View>

            <TouchableOpacity style={styles.primaryButton} onPress={restartGame}>
              <Text style={styles.primaryButtonText}>Main Lagi</Text>
            </TouchableOpacity>
            {onBackToMenu && (
              <TouchableOpacity style={styles.secondaryButton} onPress={onBackToMenu}>
                <Text style={styles.secondaryButtonText}>Kembali ke Menu</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centeredContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  icon: { fontSize: 56 },
  titleText: { color: COLORS.text, fontSize: 22, fontWeight: 'bold', textAlign: 'center' },
  infoText: { color: COLORS.textSecondary, fontSize: 15, textAlign: 'center' },

  // HUD
  hud: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  hudItem: { alignItems: 'center' },
  hudLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },
  hudValue: { color: COLORS.text, fontSize: 30, fontWeight: 'bold' },
  hudValueDanger: { color: '#FF4444' },

  // Challenge Card
  challengeCard: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 20,
    paddingHorizontal: 32,
    paddingVertical: 20,
    alignItems: 'center',
    gap: 6,
  },
  challengeEmoji: { fontSize: 48 },
  challengeText: { color: '#FFF', fontSize: 22, fontWeight: 'bold' },
  feedbackText: { fontSize: 16, fontWeight: '600', marginTop: 4 },
  feedbackSuccess: { color: '#4CAF50' },
  feedbackFail: { color: '#FF5722' },

  // Countdown
  countdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: { color: '#FFF', fontSize: 120, fontWeight: 'bold' },
  countdownSubText: { color: COLORS.textSecondary, fontSize: 20, marginTop: 8 },

  // Idle
  idleOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
  },

  // Saving
  savingOverlay: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },

  // Buttons
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 30,
    marginTop: 8,
  },
  primaryButtonText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 30,
    marginTop: 4,
  },
  secondaryButtonText: { color: COLORS.text, fontSize: 16, fontWeight: '600' },

  // Summary Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  modalCard: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 32,
    gap: 16,
  },
  modalTitle: { color: COLORS.text, fontSize: 26, fontWeight: 'bold', textAlign: 'center' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  statLabel: { color: COLORS.textSecondary, fontSize: 16 },
  statValue: { color: COLORS.text, fontSize: 20, fontWeight: 'bold' },
});

export default GameScreen;
