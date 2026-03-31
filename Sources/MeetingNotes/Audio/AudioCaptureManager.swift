import Foundation
import AVFoundation

/// Coordinates system audio and microphone capture.
final class AudioCaptureManager {
    private let systemCapture = SystemAudioCapture()
    private let micCapture = MicrophoneCapture()

    /// Called when a system audio buffer is available.
    var onSystemAudioBuffer: ((AVAudioPCMBuffer) -> Void)?
    /// Called when a microphone audio buffer is available.
    var onMicrophoneBuffer: ((AVAudioPCMBuffer) -> Void)?

    /// Start both system audio and microphone capture.
    func startCapture() async throws {
        // Start system audio capture (requires screen recording permission)
        try await systemCapture.startCapture { [weak self] buffer in
            self?.onSystemAudioBuffer?(buffer)
        }

        // Start microphone capture (requires microphone permission)
        try micCapture.startCapture { [weak self] buffer in
            self?.onMicrophoneBuffer?(buffer)
        }
    }

    /// Stop all audio capture.
    func stopCapture() {
        systemCapture.stopCapture()
        micCapture.stopCapture()
    }
}
