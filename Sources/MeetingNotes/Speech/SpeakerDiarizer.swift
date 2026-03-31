import Foundation
import AVFoundation
import Accelerate

/// Local speaker diarization using audio energy and voice embedding clustering.
///
/// Strategy:
/// 1. Detect voice activity (VAD) by audio energy level
/// 2. Extract simple spectral features (MFCC-like) for each speech segment
/// 3. Cluster features to assign speaker labels (Speaker 1, Speaker 2, etc.)
/// 4. The microphone channel is always "Me", system audio speakers are clustered
final class SpeakerDiarizer {
    /// Represents a detected speaker
    struct Speaker: Hashable {
        let id: Int
        let label: String  // "Speaker 1", "Speaker 2", etc.
    }

    /// A voice segment with speaker assignment
    struct DiarizedSegment {
        let speaker: Speaker
        let startTime: TimeInterval
        let endTime: TimeInterval
    }

    // MARK: - Configuration

    /// Minimum energy threshold to consider as speech (vs silence)
    private let energyThreshold: Float = 0.01
    /// Window size in samples for feature extraction (25ms at 16kHz)
    private let windowSize: Int = 400
    /// Maximum number of speakers to detect
    private let maxSpeakers: Int = 8
    /// Similarity threshold for same-speaker detection (0-1, higher = stricter)
    private let similarityThreshold: Float = 0.75

    // MARK: - State

    private var speakerEmbeddings: [[Float]] = []  // Centroid embeddings per speaker
    private var speakerLabels: [Speaker] = []
    private var currentSpeaker: Speaker?
    private var segmentBuffer: [Float] = []
    private var silenceFrameCount: Int = 0
    private let silenceThreshold: Int = 10  // ~250ms of silence triggers speaker change check

    /// Callback when speaker changes: (speaker label)
    var onSpeakerChange: ((Speaker) -> Void)?

    // MARK: - Public API

    /// Process an audio buffer from the system audio stream.
    /// Returns the detected speaker for this audio segment.
    @discardableResult
    func processBuffer(_ buffer: AVAudioPCMBuffer) -> Speaker? {
        guard let channelData = buffer.floatChannelData?[0] else { return currentSpeaker }
        let frameCount = Int(buffer.frameLength)

        // Calculate RMS energy
        let energy = rmsEnergy(channelData, count: frameCount)

        if energy > energyThreshold {
            // Voice activity detected - accumulate samples
            let samples = Array(UnsafeBufferPointer(start: channelData, count: frameCount))
            segmentBuffer.append(contentsOf: samples)
            silenceFrameCount = 0
        } else {
            silenceFrameCount += 1

            // After enough silence, process the accumulated segment
            if silenceFrameCount >= silenceThreshold && !segmentBuffer.isEmpty {
                let speaker = identifySpeaker(from: segmentBuffer)
                segmentBuffer.removeAll(keepingCapacity: true)

                if speaker != currentSpeaker {
                    currentSpeaker = speaker
                    onSpeakerChange?(speaker)
                }
            }
        }

        return currentSpeaker
    }

    /// Reset all speaker data (call when starting a new meeting).
    func reset() {
        speakerEmbeddings.removeAll()
        speakerLabels.removeAll()
        currentSpeaker = nil
        segmentBuffer.removeAll()
        silenceFrameCount = 0
    }

    /// Get all detected speakers so far.
    var detectedSpeakers: [Speaker] {
        speakerLabels
    }

    // MARK: - Speaker Identification

    private func identifySpeaker(from samples: [Float]) -> Speaker {
        let embedding = extractEmbedding(from: samples)

        // Compare with known speakers
        var bestMatch: Int = -1
        var bestSimilarity: Float = 0

        for (index, centroid) in speakerEmbeddings.enumerated() {
            let similarity = cosineSimilarity(embedding, centroid)
            if similarity > bestSimilarity {
                bestSimilarity = similarity
                bestMatch = index
            }
        }

        if bestSimilarity >= similarityThreshold && bestMatch >= 0 {
            // Known speaker - update centroid with running average
            updateCentroid(at: bestMatch, with: embedding)
            return speakerLabels[bestMatch]
        } else if speakerLabels.count < maxSpeakers {
            // New speaker
            let newSpeaker = Speaker(id: speakerLabels.count + 1, label: "Speaker \(speakerLabels.count + 1)")
            speakerLabels.append(newSpeaker)
            speakerEmbeddings.append(embedding)
            return newSpeaker
        } else {
            // Max speakers reached, assign to closest match
            return bestMatch >= 0 ? speakerLabels[bestMatch] : speakerLabels[0]
        }
    }

    // MARK: - Feature Extraction

    /// Extract a simple spectral embedding from audio samples.
    /// Uses energy in frequency bands as a compact voice signature.
    private func extractEmbedding(from samples: [Float]) -> [Float] {
        let fftSize = 512
        let numBands = 24  // Number of frequency bands (mel-like)

        // Take multiple windows and average their spectral features
        var aggregatedBands = [Float](repeating: 0, count: numBands)
        var windowCount = 0

        var i = 0
        while i + fftSize <= samples.count {
            let window = Array(samples[i..<(i + fftSize)])
            let bands = spectralBands(window, numBands: numBands)

            for j in 0..<numBands {
                aggregatedBands[j] += bands[j]
            }
            windowCount += 1
            i += fftSize / 2  // 50% overlap
        }

        // Average and normalize
        if windowCount > 0 {
            for j in 0..<numBands {
                aggregatedBands[j] /= Float(windowCount)
            }
        }

        return normalize(aggregatedBands)
    }

    /// Compute energy in frequency bands using simple DFT magnitude.
    private func spectralBands(_ samples: [Float], numBands: Int) -> [Float] {
        let n = samples.count

        // Apply Hann window
        var windowed = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let hannValue = 0.5 * (1.0 - cos(2.0 * Float.pi * Float(i) / Float(n - 1)))
            windowed[i] = samples[i] * hannValue
        }

        // Simple DFT magnitude (using Accelerate for real FFT)
        let halfN = n / 2
        var magnitudes = [Float](repeating: 0, count: halfN)

        // Use vDSP for FFT
        let log2n = vDSP_Length(log2(Float(n)))
        guard let fftSetup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else {
            return [Float](repeating: 0, count: numBands)
        }
        defer { vDSP_destroy_fftsetup(fftSetup) }

        var realPart = [Float](repeating: 0, count: halfN)
        var imagPart = [Float](repeating: 0, count: halfN)

        // Pack input for real FFT
        windowed.withUnsafeBufferPointer { ptr in
            ptr.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { complexPtr in
                var splitComplex = DSPSplitComplex(realp: &realPart, imagp: &imagPart)
                vDSP_ctoz(complexPtr, 2, &splitComplex, 1, vDSP_Length(halfN))
                vDSP_fft_zrip(fftSetup, &splitComplex, 1, log2n, FFTDirection(FFT_FORWARD))

                // Compute magnitudes
                for i in 0..<halfN {
                    magnitudes[i] = sqrt(realPart[i] * realPart[i] + imagPart[i] * imagPart[i])
                }
            }
        }

        // Group into bands (roughly mel-spaced by using exponential spacing)
        var bands = [Float](repeating: 0, count: numBands)
        for band in 0..<numBands {
            let lowBin = Int(Float(halfN) * pow(Float(band) / Float(numBands), 1.5))
            let highBin = Int(Float(halfN) * pow(Float(band + 1) / Float(numBands), 1.5))
            let clampedLow = min(lowBin, halfN - 1)
            let clampedHigh = min(max(highBin, clampedLow + 1), halfN)

            var sum: Float = 0
            for i in clampedLow..<clampedHigh {
                sum += magnitudes[i]
            }
            bands[band] = sum / Float(max(clampedHigh - clampedLow, 1))
        }

        return bands
    }

    // MARK: - Utilities

    private func rmsEnergy(_ data: UnsafePointer<Float>, count: Int) -> Float {
        var meanSquare: Float = 0
        vDSP_measqv(data, 1, &meanSquare, vDSP_Length(count))
        return sqrt(meanSquare)
    }

    private func cosineSimilarity(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count, !a.isEmpty else { return 0 }

        var dotProduct: Float = 0
        var normA: Float = 0
        var normB: Float = 0

        vDSP_dotpr(a, 1, b, 1, &dotProduct, vDSP_Length(a.count))
        vDSP_dotpr(a, 1, a, 1, &normA, vDSP_Length(a.count))
        vDSP_dotpr(b, 1, b, 1, &normB, vDSP_Length(b.count))

        let denom = sqrt(normA) * sqrt(normB)
        return denom > 0 ? dotProduct / denom : 0
    }

    private func normalize(_ vector: [Float]) -> [Float] {
        var norm: Float = 0
        vDSP_dotpr(vector, 1, vector, 1, &norm, vDSP_Length(vector.count))
        norm = sqrt(norm)

        guard norm > 0 else { return vector }
        return vector.map { $0 / norm }
    }

    private func updateCentroid(at index: Int, with embedding: [Float]) {
        // Running average: centroid = 0.9 * old + 0.1 * new
        let alpha: Float = 0.1
        for i in 0..<speakerEmbeddings[index].count {
            speakerEmbeddings[index][i] = (1 - alpha) * speakerEmbeddings[index][i] + alpha * embedding[i]
        }
        speakerEmbeddings[index] = normalize(speakerEmbeddings[index])
    }
}
