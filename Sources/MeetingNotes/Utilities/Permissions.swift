import Foundation
import AVFoundation
import Speech
import ScreenCaptureKit

/// Helper for requesting and checking system permissions.
enum Permissions {
    // MARK: - Microphone

    static func requestMicrophoneAccess() async -> Bool {
        await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    static var hasMicrophoneAccess: Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    // MARK: - Speech Recognition

    static func requestSpeechRecognitionAccess() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    static var hasSpeechRecognitionAccess: Bool {
        SFSpeechRecognizer.authorizationStatus() == .authorized
    }

    // MARK: - Screen Recording (for system audio)

    /// Check if screen recording permission is available by attempting to get shareable content.
    static func checkScreenRecordingAccess() async -> Bool {
        do {
            _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            return true
        } catch {
            return false
        }
    }

    // MARK: - Request All

    /// Request all required permissions. Returns a list of missing permissions.
    static func requestAllPermissions() async -> [String] {
        var missing: [String] = []

        let micAccess = await requestMicrophoneAccess()
        if !micAccess {
            missing.append("Microphone")
        }

        let speechAccess = await requestSpeechRecognitionAccess()
        if speechAccess != .authorized {
            missing.append("Speech Recognition")
        }

        let screenAccess = await checkScreenRecordingAccess()
        if !screenAccess {
            missing.append("Screen Recording (for system audio)")
        }

        return missing
    }
}
