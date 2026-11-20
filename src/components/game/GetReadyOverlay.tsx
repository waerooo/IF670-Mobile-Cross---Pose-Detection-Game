import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  GAME_DURATION_SECONDS,
  PALETTE,
  RADIUS,
  SPACING,
  TYPOGRAPHY,
} from '../../constants';

interface GetReadyOverlayProps {
  count: number; // angka hitung mundur: 3, 2, 1
  bodyDetected?: boolean; // seluruh badan terlihat kamera atau belum
  durationSeconds?: number; // lama permainan, untuk teks petunjuk
}

/**
 * Lapisan "Get Ready!" yang menimpa kamera sebelum permainan mulai:
 * status badan, hitung mundur besar, dan kartu petunjuk cara main.
 * Murni tampilan. Angka hitung mundur dikirim dari GameScreen.
 */
const GetReadyOverlay: React.FC<GetReadyOverlayProps> = ({
  count,
  bodyDetected = true,
  durationSeconds = GAME_DURATION_SECONDS,
}) => (
  <View style={[StyleSheet.absoluteFill, styles.overlay]}>
    <View
      style={[styles.badge, bodyDetected ? styles.badgeOk : styles.badgeWarn]}>
      <Text
        style={[
          styles.badgeText,
          {color: bodyDetected ? PALETTE.success : PALETTE.reward},
        ]}>
        {bodyDetected
          ? '✔ Full body detected'
          : 'Step back so your full body is visible'}
      </Text>
    </View>

    <View style={styles.center}>
      <Text style={styles.heading}>Get Ready!</Text>
      <Text accessibilityLiveRegion="polite" style={styles.count}>
        {`${count}`}
      </Text>
    </View>

    <View style={styles.howTo}>
      <Text style={styles.howToTitle}>How to play</Text>
      <Text style={styles.howToText}>
        {`Copy the pose shown in the card. Hold until the ring is full → +1 pose! Get as many as you can in ${durationSeconds} seconds.`}
      </Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(9, 0, 63, 0.55)',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.screenMargin,
    paddingTop: SPACING.xl,
  },
  badge: {
    borderWidth: 2,
    borderRadius: RADIUS.pill,
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    backgroundColor: 'rgba(9, 0, 63, 0.7)',
  },
  badgeOk: {borderColor: PALETTE.success},
  badgeWarn: {borderColor: PALETTE.reward},
  badgeText: {...TYPOGRAPHY.labelMd},

  center: {alignItems: 'center'},
  heading: {...TYPOGRAPHY.displayHero, color: PALETTE.white},
  count: {...TYPOGRAPHY.counterGiant, color: PALETTE.white},

  howTo: {
    alignSelf: 'stretch',
    backgroundColor: PALETTE.backgroundElevated,
    borderRadius: RADIUS.card,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  howToTitle: {...TYPOGRAPHY.labelMd, color: PALETTE.white},
  howToText: {...TYPOGRAPHY.caption, color: PALETTE.panel},
});

export default GetReadyOverlay;
