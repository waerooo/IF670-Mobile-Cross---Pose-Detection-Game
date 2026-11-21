/**
 * SnapFit — Real-time Pose Matching Fitness Game Screen
 *
 * Flow:
 *  1. Camera preview with zoom & camera flip controls
 *  2. Countdown → Active game (60 s timer)
 *  3. Every 1.5 s: photo → ML Kit → classify pose → score + skeleton overlay
 *  4. Game ends → instant summary modal + async background save to Firebase
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import type { CameraPosition } from 'react-native-vision-camera';
import { useCameraPermission } from '../../hooks/useCameraPermission';
import {
  detectPoseFromPhoto,
  releasePoseDetector,
} from '../../services/mlkit/poseDetectionService';
import {
  validatePose,
  calculatePoseScore,
  calculateAccuracy,
} from '../../utils/poseDetection/poseHelpers';
import { saveGameSession } from '../../services/firebase/databaseService';
import { COLORS, GAME_DURATION_SECONDS } from '../../constants';
import type { GameStatus, GameChallenge, PoseValidationResult, PoseLandmark } from '../../types';
import PoseOverlay from '../../components/game/PoseOverlay';

// ── Challenges with Clear Indonesian UX Instructions ─────────

export interface ChallengeWithInstruction extends GameChallenge {
  instruction: string;
}

const CHALLENGES: ChallengeWithInstruction[] = [
  {
    id: '1',
    poseLabel: 'T_POSE',
    displayName: 'T-Pose',
    emoji: '✈️',
    durationMs: 2000,
    pointsReward: 10,
    instruction: 'Rentangkan kedua tangan lurus ke samping setinggi bahu',
  },
  {
    id: '2',
    poseLabel: 'HANDS_UP',
    displayName: 'Hands Up!',
    emoji: '🙌',
    durationMs: 2000,
    pointsReward: 8,
    instruction: 'Angkat kedua tangan lurus ke atas kepala',
  },
  {
    id: '3',
    poseLabel: 'HAND_RIGHT_UP',
    displayName: 'Tangan Kanan!',
    emoji: '🙋‍♂️',
    durationMs: 2000,
    pointsReward: 8,
    instruction: 'Angkat tangan kanan lurus ke atas kepala',
  },
  {
    id: '4',
    poseLabel: 'HAND_LEFT_UP',
    displayName: 'Tangan Kiri!',
    emoji: '🙋‍♀️',
    durationMs: 2000,
    pointsReward: 8,
    instruction: 'Angkat tangan kiri lurus ke atas kepala',
  },
];

function getRandomChallenge(): ChallengeWithInstruction {
  return CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
}

// ── Component ────────────────────────────────────────────────

interface GameScreenProps {
  userId?: string; // passed from navigation / auth context
  onBackToMenu?: () => void;
}

const GameScreen: React.FC<GameScreenProps> = ({
  userId = 'abidzar-tester',
  onBackToMenu,
}) => {
  // Camera permission & device
  const { isGranted, isLoading: permLoading, requestPermission } = useCameraPermission();
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('front');
  const device = useCameraDevice(cameraPosition);
  const cameraRef = useRef<Camera>(null);
  const [zoom, setZoom] = useState(1);
  const [resizeMode, setResizeMode] = useState<'cover' | 'contain'>('contain');

  // Game state
  const [gameStatus, setGameStatus] = useState<GameStatus>('IDLE');
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_SECONDS);
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [poseCount, setPoseCount] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [currentChallenge, setCurrentChallenge] = useState<ChallengeWithInstruction>(getRandomChallenge());
  const currentChallengeRef = useRef<ChallengeWithInstruction>(currentChallenge);
  const [landmarks, setLandmarks] = useState<PoseLandmark[] | null>(null);
  const [lastResult, setLastResult] = useState<PoseValidationResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [isSuccessHold, setIsSuccessHold] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [finalPoses, setFinalPoses] = useState(0);
  const [finalAccuracy, setFinalAccuracy] = useState(0);

  // Refs (avoid stale closures in intervals)
  const scoreRef = useRef(0);
  const poseCountRef = useRef(0);
  const framesRef = useRef(0);
  const detectionRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDetectingRef = useRef(false);
  const isSuccessCooldownRef = useRef(false);

  // Automatically maximize field-of-view when camera device loads
  useEffect(() => {
    if (device) {
      setZoom(device.minZoom);
    }
  }, [device]);

  // Flip between front and back camera
  const toggleCameraPosition = useCallback(() => {
    setCameraPosition(prev => (prev === 'front' ? 'back' : 'front'));
  }, []);

  // Toggle between Full Body (contain, no cropping) and Full Screen (cover)
  const toggleResizeMode = useCallback(() => {
    setResizeMode(prev => (prev === 'contain' ? 'cover' : 'contain'));
  }, []);

  // Toggle between minZoom (ultra-wide/zoom out) and standard 1.0x
  const toggleZoom = useCallback(() => {
    if (!device) return;
    setZoom(prev => {
      const min = device.minZoom;
      return prev <= min + 0.05 ? Math.min(1.0, device.maxZoom) : min;
    });
  }, [device]);

  // Skip / Change to next challenge anytime
  const skipChallenge = useCallback(() => {
    let next = getRandomChallenge();
    while (CHALLENGES.length > 1 && next.id === currentChallengeRef.current.id) {
      next = getRandomChallenge();
    }
    currentChallengeRef.current = next;
    setCurrentChallenge(next);
    setLastResult(null);
  }, []);

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
    setLandmarks(null);
    setGameStatus('ACTIVE');
    isSuccessCooldownRef.current = false;
    setIsSuccessHold(false);
    const firstChallenge = getRandomChallenge();
    currentChallengeRef.current = firstChallenge;
    setCurrentChallenge(firstChallenge);

    // Countdown timer
    let remaining = GAME_DURATION_SECONDS;
    timerRef.current = setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        endGame();
      }
    }, 1000);

    // Fast real-time pose tracking loop (every 250ms for near-instant response)
    detectionRef.current = setInterval(async () => {
      await captureAndDetect();
    }, 250);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const captureAndDetect = useCallback(async () => {
    if (!cameraRef.current || isDetectingRef.current) return;
    isDetectingRef.current = true;

    try {
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: false,
      });

      framesRef.current += 1;
      setTotalFrames(framesRef.current);

      const pose = await detectPoseFromPhoto(`file://${photo.path}`);
      if (!pose) {
        setLandmarks(null);
        return;
      }

      setLandmarks(pose.landmarks);
      const result = validatePose(pose);
      setLastResult(result);

      const target = currentChallengeRef.current;
      if (result.isValid && result.label === target.poseLabel) {
        if (isSuccessCooldownRef.current) return;
        isSuccessCooldownRef.current = true;
        setIsSuccessHold(true);

        const pts = target.pointsReward || calculatePoseScore(result);
        scoreRef.current += pts;
        poseCountRef.current += 1;
        setScore(scoreRef.current);
        setPoseCount(poseCountRef.current);

        // Hold for 1.8 seconds so player sees match & stickman before changing pose
        setTimeout(() => {
          let next = getRandomChallenge();
          while (CHALLENGES.length > 1 && next.id === currentChallengeRef.current.id) {
            next = getRandomChallenge();
          }
          currentChallengeRef.current = next;
          setCurrentChallenge(next);
          setIsSuccessHold(false);
          isSuccessCooldownRef.current = false;
        }, 1800);
      }
    } catch (err) {
      // Camera not ready mid-frame → ignore silently
    } finally {
      isDetectingRef.current = false;
    }
  }, []);

  const endGame = useCallback(async () => {
    clearIntervals();
    setGameStatus('ENDED');
    setLandmarks(null);

    const accuracy = calculateAccuracy(poseCountRef.current, framesRef.current);
    setFinalScore(scoreRef.current);
    setFinalPoses(poseCountRef.current);
    setFinalAccuracy(accuracy);

    // Show summary modal immediately so user never waits!
    setShowSummary(true);

    // Save to Firebase in the background (non-blocking)
    setIsSaving(true);
    saveGameSession({
      userId,
      score: scoreRef.current,
      poseCount: poseCountRef.current,
      duration: GAME_DURATION_SECONDS,
      accuracy,
      timestamp: Date.now(),
    })
      .catch(err => console.warn('[GameScreen] Session save note:', err))
      .finally(() => setIsSaving(false));
  }, [userId]);

  const restartGame = useCallback(() => {
    setShowSummary(false);
    setGameStatus('IDLE');
    setTimeLeft(GAME_DURATION_SECONDS);
    setScore(0);
    setPoseCount(0);
    setLandmarks(null);
    setLastResult(null);
    setIsSuccessHold(false);
    isSuccessCooldownRef.current = false;
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
      {/* ── Camera Feed with Zoom and Pinch Gesture ── */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={gameStatus !== 'ENDED'}
        photo={true}
        zoom={zoom}
        enableZoomGesture={true}
        resizeMode={resizeMode}
      />

      {/* ── Skeletal Pose Tracker Overlay (Real-time Skeleton) ── */}
      {gameStatus === 'ACTIVE' && (
        <PoseOverlay
          landmarks={landmarks}
          isMatched={Boolean(
            isSuccessHold || (lastResult?.isValid && lastResult.label === currentChallenge.poseLabel),
          )}
          resizeMode={resizeMode}
        />
      )}

      {/* ── Top HUD ── */}
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

      {/* ── Camera Controls Bar (Full Body / Zoom / Flip) ── */}
      <View style={styles.cameraControlsBar}>
        <TouchableOpacity style={styles.controlPill} onPress={toggleResizeMode}>
          <Text style={styles.controlPillText}>
            {resizeMode === 'contain' ? '📐 Full Body' : '📐 Layar Penuh'}
          </Text>
        </TouchableOpacity>
        {device.minZoom < 1 && (
          <TouchableOpacity style={styles.controlPill} onPress={toggleZoom}>
            <Text style={styles.controlPillText}>
              🔍 Zoom: {zoom.toFixed(1)}x {zoom <= (device.minZoom + 0.05) ? '(Wide)' : ''}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.controlPill} onPress={toggleCameraPosition}>
          <Text style={styles.controlPillText}>
            🔄 {cameraPosition === 'front' ? 'Kamera Belakang' : 'Kamera Depan'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Challenge Card & Live Pose Guidance ── */}
      {gameStatus === 'ACTIVE' && (
        <View style={styles.challengeCard}>
          <View style={styles.challengeHeader}>
            <Text style={styles.challengeEmoji}>{currentChallenge.emoji}</Text>
            <View style={styles.challengeTitleBlock}>
              <Text style={styles.challengeLabel}>TANTANGAN SAAT INI:</Text>
              <Text style={styles.challengeText}>{currentChallenge.displayName}</Text>
            </View>
            <TouchableOpacity style={styles.skipButton} onPress={skipChallenge}>
              <Text style={styles.skipButtonText}>⏭️ Ganti</Text>
            </TouchableOpacity>
          </View>

          {/* Clear Indonesian Instruction */}
          <View style={styles.instructionBox}>
            <Text style={styles.challengeInstruction}>{currentChallenge.instruction}</Text>
          </View>

          {/* Live Pose Detection Feedback */}
          {isSuccessHold ? (
            <Text style={[styles.feedbackText, styles.feedbackSuccess]}>
              {`🎉 Pose Cocok! +${currentChallenge.pointsReward} pts — Tahan sejenak...`}
            </Text>
          ) : lastResult ? (
            <Text
              style={[
                styles.feedbackText,
                lastResult.isValid && lastResult.label === currentChallenge.poseLabel
                  ? styles.feedbackSuccess
                  : styles.feedbackFail,
              ]}>
              {lastResult.isValid && lastResult.label === currentChallenge.poseLabel
                ? '✅ Pose Cocok!'
                : lastResult.isValid
                ? `⚠️ Terdeteksi ${lastResult.label.replace(/_/g, ' ')}`
                : '❌ Pose belum pas, ikuti instruksi di atas!'}
            </Text>
          ) : (
            <Text style={styles.feedbackIdle}>
              👤 Posisikan tubuh menghadap kamera
            </Text>
          )}
        </View>
      )}

      {/* ── Countdown Overlay ── */}
      {gameStatus === 'COUNTDOWN' && (
        <View style={styles.countdownOverlay}>
          <Text style={styles.countdownText}>{countdown}</Text>
          <Text style={styles.countdownSubText}>Bersiap di depan kamera...</Text>
        </View>
      )}

      {/* ── Idle Start Screen ── */}
      {gameStatus === 'IDLE' && (
        <View style={styles.idleOverlay}>
          <Text style={styles.appTitle}>SnapFit 💪</Text>
          <Text style={styles.infoText}>
            Posisikan kamera agar seluruh tubuh terlihat dari kepala hingga kaki.
          </Text>
          <Text style={styles.subInfoText}>
            Pinch layar atau tekan tombol Wide untuk zoom out.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={startCountdown}>
            <Text style={styles.primaryButtonText}>Mulai Game (60s)</Text>
          </TouchableOpacity>
          {onBackToMenu && (
            <TouchableOpacity style={styles.secondaryButton} onPress={onBackToMenu}>
              <Text style={styles.secondaryButtonText}>Kembali ke Menu</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Game Summary Modal (Instant Popup) ── */}
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

            {isSaving ? (
              <View style={styles.inlineSaving}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={styles.inlineSavingText}>Menyimpan skor ke cloud...</Text>
              </View>
            ) : (
              <View style={styles.inlineSaving}>
                <Text style={[styles.inlineSavingText, { color: '#00FF66' }]}>
                  ☁️ Skor tersinkronisasi ke cloud
                </Text>
              </View>
            )}

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
  appTitle: { color: COLORS.primary, fontSize: 36, fontWeight: 'bold', textAlign: 'center' },
  infoText: { color: COLORS.textSecondary, fontSize: 15, textAlign: 'center', paddingHorizontal: 16 },
  subInfoText: { color: '#AAA', fontSize: 13, textAlign: 'center', marginTop: -6 },

  // HUD
  hud: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  hudItem: { alignItems: 'center' },
  hudLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },
  hudValue: { color: COLORS.text, fontSize: 28, fontWeight: 'bold' },
  hudValueDanger: { color: '#FF4444' },

  // Camera Controls Bar
  cameraControlsBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  controlPill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  controlPillText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },

  // Challenge Card
  challengeCard: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(15, 15, 25, 0.88)',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 229, 255, 0.4)',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  challengeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  challengeEmoji: { fontSize: 38 },
  challengeTitleBlock: { flex: 1 },
  challengeLabel: { color: COLORS.primary, fontSize: 11, fontWeight: 'bold', letterSpacing: 0.5 },
  challengeText: { color: '#FFF', fontSize: 22, fontWeight: 'bold' },
  skipButton: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },

  instructionBox: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  challengeInstruction: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },

  feedbackText: { fontSize: 14, fontWeight: '700', textAlign: 'center', marginTop: 2 },
  feedbackSuccess: { color: '#00FF66' },
  feedbackFail: { color: '#FF7043' },
  feedbackIdle: { color: '#AAA', fontSize: 12, textAlign: 'center', fontStyle: 'italic' },

  // Countdown
  countdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: { color: '#FFF', fontSize: 120, fontWeight: 'bold' },
  countdownSubText: { color: COLORS.textSecondary, fontSize: 18, marginTop: 8 },

  // Idle Overlay
  idleOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
  },

  // Buttons
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: 30,
    marginTop: 8,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#FFF', fontSize: 17, fontWeight: 'bold' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 30,
    marginTop: 4,
    alignItems: 'center',
  },
  secondaryButtonText: { color: COLORS.text, fontSize: 16, fontWeight: '600' },

  // Summary Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  modalCard: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 32,
    gap: 14,
  },
  modalTitle: { color: COLORS.text, fontSize: 26, fontWeight: 'bold', textAlign: 'center' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  statLabel: { color: COLORS.textSecondary, fontSize: 16 },
  statValue: { color: COLORS.text, fontSize: 20, fontWeight: 'bold' },
  inlineSaving: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  inlineSavingText: { color: COLORS.textSecondary, fontSize: 13 },
});

export default GameScreen;
