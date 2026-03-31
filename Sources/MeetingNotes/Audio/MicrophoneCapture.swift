import Foundation
import AVFoundation

/// Captures audio from the system microphone using AVAudioEngine.
final class MicrophoneCapture {
    private let audioEngine = AVAudioEngine()
    private var onAudioBuffer: ((AVAudioPCMBuffer) -> Void)?

    /// Start capturing microphone audio.
    /// - Parameter onBuffer: Callback receiving audio PCM buffers.
    func startCapture(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws {
        self.onAudioBuffer = onBuffer

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        // Install a tap to receive audio buffers
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.onAudioBuffer?(buffer)
        }

        audioEngine.prepare()
        try audioEngine.start()
    }

    func stopCapture() {
        audioEngine.inputNode.removeTap(onBus: 0)
        audioEngine.stop()
    }

    var isRunning: Bool {
        audioEngine.isRunning
    }
}
