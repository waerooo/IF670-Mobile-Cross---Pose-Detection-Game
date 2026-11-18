import React, {useState} from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import CameraView from '../../components/game/CameraView';
import {COLORS, GAME_DURATION_SECONDS} from '../../constants';

const GameScreen: React.FC = () => {
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [poseCount, setPoseCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_SECONDS);
  const [isGameActive, setIsGameActive] = useState(false);

  const handleCameraReady = () => {
    setIsCameraReady(true);
  };

  const handleStartGame = () => {
    if (!isCameraReady) return;
    setIsGameActive(true);
    // TODO: StartTimer(), connect ML Kit
  };

  return (
    <View style={styles.container}>
      {/* Camera Feed (full screen background) */}
      <CameraView
        style={StyleSheet.absoluteFill}
        onCameraReady={handleCameraReady}
      />

      {/* HUD Overlay */}
      <View style={styles.hud}>
        {/* Timer */}
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>Time Left</Text>
          <Text style={styles.hudValue}>{timeLeft}s</Text>
        </View>

        {/* Pose Count */}
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>Poses</Text>
          <Text style={styles.hudValue}>{poseCount}</Text>
        </View>
      </View>

      {/* Start Button (sementara) */}
      {!isGameActive && isCameraReady && (
        <TouchableOpacity style={styles.startButton} onPress={handleStartGame}>
          <Text style={styles.startButtonText}>Mulai Game</Text>
        </TouchableOpacity>
      )}

      {/* Camera not ready indicator */}
      {!isCameraReady && (
        <View style={styles.loadingOverlay}>
          <Text style={styles.loadingText}>Mempersiapkan kamera...</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  hud: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  hudItem: {
    alignItems: 'center',
  },
  hudLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  hudValue: {
    color: COLORS.text,
    fontSize: 32,
    fontWeight: 'bold',
  },
  startButton: {
    position: 'absolute',
    bottom: 60,
    alignSelf: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 32,
  },
  startButtonText: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: 'bold',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: COLORS.text,
    fontSize: 16,
  },
});

export default GameScreen;
