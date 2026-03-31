import Foundation
import ScreenCaptureKit
import AVFoundation

/// Captures system audio from meeting applications using ScreenCaptureKit.
final class SystemAudioCapture: NSObject, @unchecked Sendable {
    private var stream: SCStream?
    private var onAudioBuffer: ((AVAudioPCMBuffer) -> Void)?

    /// Start capturing system audio.
    /// - Parameter onBuffer: Callback receiving audio PCM buffers.
    func startCapture(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) async throws {
        self.onAudioBuffer = onBuffer

        // Get shareable content (all windows/displays)
        let availableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

        // Use the main display for audio capture
        guard let display = availableContent.displays.first else {
            throw AudioCaptureError.noDisplayFound
        }

        // Create a content filter for the display (captures all audio output)
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])

        // Configure stream for audio only
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true  // Don't capture our own app's audio
        config.sampleRate = 16000  // 16kHz is good for speech recognition
        config.channelCount = 1    // Mono for speech
        // Minimize video capture since we only need audio
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)  // 1 FPS minimum

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        self.stream = stream

        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: .global(qos: .userInteractive))
        try await stream.startCapture()
    }

    func stopCapture() {
        Task {
            try? await stream?.stopCapture()
            stream = nil
        }
    }
}

// MARK: - SCStreamDelegate
extension SystemAudioCapture: SCStreamDelegate {
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("[SystemAudioCapture] Stream stopped with error: \(error.localizedDescription)")
    }
}

// MARK: - SCStreamOutput
extension SystemAudioCapture: SCStreamOutput {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }

        // Convert CMSampleBuffer to AVAudioPCMBuffer
        guard let pcmBuffer = sampleBuffer.toAudioPCMBuffer() else { return }
        onAudioBuffer?(pcmBuffer)
    }
}

// MARK: - CMSampleBuffer Extension
extension CMSampleBuffer {
    func toAudioPCMBuffer() -> AVAudioPCMBuffer? {
        guard let formatDescription = formatDescription,
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
            return nil
        }

        guard let audioFormat = AVAudioFormat(streamDescription: asbd) else {
            return nil
        }

        let frameCount = CMSampleBufferGetNumSamples(self)
        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: audioFormat, frameCapacity: AVAudioFrameCount(frameCount)) else {
            return nil
        }
        pcmBuffer.frameLength = AVAudioFrameCount(frameCount)

        guard let blockBuffer = CMSampleBufferGetDataBuffer(self) else {
            return nil
        }

        let length = CMBlockBufferGetDataLength(blockBuffer)
        var dataPointer: UnsafeMutablePointer<Int8>?
        CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: nil, dataPointerOut: &dataPointer)

        guard let srcData = dataPointer, let dstData = pcmBuffer.floatChannelData else {
            return nil
        }

        // Copy audio data
        memcpy(dstData[0], srcData, length)
        return pcmBuffer
    }
}

enum AudioCaptureError: LocalizedError {
    case noDisplayFound
    case noMicrophoneAccess
    case noScreenRecordingPermission

    var errorDescription: String? {
        switch self {
        case .noDisplayFound:
            return "No display found for audio capture."
        case .noMicrophoneAccess:
            return "Microphone access not granted. Please enable in System Settings > Privacy & Security > Microphone."
        case .noScreenRecordingPermission:
            return "Screen recording permission not granted. Please enable in System Settings > Privacy & Security > Screen Recording."
        }
    }
}
