package com.posedetectiongame

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeMap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.pose.PoseDetection
import com.google.mlkit.vision.pose.PoseDetector
import com.google.mlkit.vision.pose.PoseLandmark
import com.google.mlkit.vision.pose.accurate.AccuratePoseDetectorOptions

class MLKitPoseDetectionModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val poseDetector: PoseDetector by lazy {
        val options = AccuratePoseDetectorOptions.Builder()
            .setDetectorMode(AccuratePoseDetectorOptions.SINGLE_IMAGE_MODE)
            .build()
        PoseDetection.getClient(options)
    }

    override fun getName(): String = "MLKitPoseDetection"

    @ReactMethod
    fun detectPose(imageBase64: String, promise: Promise) {
        try {
            val imageBytes = Base64.decode(imageBase64, Base64.DEFAULT)
            val bitmap: Bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
                ?: return promise.reject("DECODE_ERROR", "Failed to decode base64 image")

            val inputImage = InputImage.fromBitmap(bitmap, 0)

            poseDetector.process(inputImage)
                .addOnSuccessListener { pose ->
                    val landmarksMap = WritableNativeMap()

                    val landmarks = pose.allPoseLandmarks
                    if (landmarks.isEmpty()) {
                        return@addOnSuccessListener promise.resolve(null)
                    }

                    for (landmark in landmarks) {
                        val landmarkMap = WritableNativeMap()
                        landmarkMap.putDouble("x", landmark.position3D.x.toDouble())
                        landmarkMap.putDouble("y", landmark.position3D.y.toDouble())
                        landmarkMap.putDouble("z", landmark.position3D.z.toDouble())
                        landmarkMap.putDouble("inFrameLikelihood", landmark.inFrameLikelihood.toDouble())
                        landmarksMap.putMap(landmarkTypeToKey(landmark.landmarkType), landmarkMap)
                    }

                    promise.resolve(landmarksMap)
                }
                .addOnFailureListener { e ->
                    promise.reject("DETECTION_ERROR", e.message ?: "Pose detection failed", e)
                }
        } catch (e: IllegalArgumentException) {
            promise.reject("INVALID_INPUT", "Invalid base64 string: ${e.message}", e)
        } catch (e: Exception) {
            promise.reject("UNEXPECTED_ERROR", e.message ?: "Unexpected error", e)
        }
    }

    private fun landmarkTypeToKey(type: Int): String = when (type) {
        PoseLandmark.NOSE              -> "nose"
        PoseLandmark.LEFT_EYE_INNER   -> "leftEyeInner"
        PoseLandmark.LEFT_EYE         -> "leftEye"
        PoseLandmark.LEFT_EYE_OUTER   -> "leftEyeOuter"
        PoseLandmark.RIGHT_EYE_INNER  -> "rightEyeInner"
        PoseLandmark.RIGHT_EYE        -> "rightEye"
        PoseLandmark.RIGHT_EYE_OUTER  -> "rightEyeOuter"
        PoseLandmark.LEFT_EAR         -> "leftEar"
        PoseLandmark.RIGHT_EAR        -> "rightEar"
        PoseLandmark.LEFT_MOUTH       -> "leftMouth"
        PoseLandmark.RIGHT_MOUTH      -> "rightMouth"
        PoseLandmark.LEFT_SHOULDER    -> "leftShoulder"
        PoseLandmark.RIGHT_SHOULDER   -> "rightShoulder"
        PoseLandmark.LEFT_ELBOW       -> "leftElbow"
        PoseLandmark.RIGHT_ELBOW      -> "rightElbow"
        PoseLandmark.LEFT_WRIST       -> "leftWrist"
        PoseLandmark.RIGHT_WRIST      -> "rightWrist"
        PoseLandmark.LEFT_PINKY       -> "leftPinky"
        PoseLandmark.RIGHT_PINKY      -> "rightPinky"
        PoseLandmark.LEFT_INDEX       -> "leftIndex"
        PoseLandmark.RIGHT_INDEX      -> "rightIndex"
        PoseLandmark.LEFT_THUMB       -> "leftThumb"
        PoseLandmark.RIGHT_THUMB      -> "rightThumb"
        PoseLandmark.LEFT_HIP         -> "leftHip"
        PoseLandmark.RIGHT_HIP        -> "rightHip"
        PoseLandmark.LEFT_KNEE        -> "leftKnee"
        PoseLandmark.RIGHT_KNEE       -> "rightKnee"
        PoseLandmark.LEFT_ANKLE       -> "leftAnkle"
        PoseLandmark.RIGHT_ANKLE      -> "rightAnkle"
        PoseLandmark.LEFT_HEEL        -> "leftHeel"
        PoseLandmark.RIGHT_HEEL       -> "rightHeel"
        PoseLandmark.LEFT_FOOT_INDEX  -> "leftFootIndex"
        PoseLandmark.RIGHT_FOOT_INDEX -> "rightFootIndex"
        else                          -> "unknown_$type"
    }
}
