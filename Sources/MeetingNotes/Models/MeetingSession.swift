import Foundation

/// Represents a complete meeting session with transcript and metadata.
@Observable
final class MeetingSession {
    var title: String
    let startTime: Date
    var endTime: Date?
    var entries: [TranscriptEntry] = []
    var summary: MeetingSummary?
    var isActive: Bool = true

    init(title: String = "Meeting", startTime: Date = Date()) {
        self.title = title
        self.startTime = startTime
    }

    func addEntry(_ entry: TranscriptEntry) {
        entries.append(entry)
    }

    func updateLastEntry(english: String, isFinal: Bool, source: TranscriptEntry.AudioSource) {
        if let lastIndex = entries.lastIndex(where: { $0.source == source && !$0.isFinal }) {
            entries[lastIndex].englishText = english
            entries[lastIndex].isFinal = isFinal
        } else {
            let entry = TranscriptEntry(englishText: english, isFinal: isFinal, source: source)
            entries.append(entry)
        }
    }

    func endMeeting() {
        endTime = Date()
        isActive = false
    }

    /// Full English transcript as a single string for summary generation.
    var fullTranscript: String {
        entries
            .filter { $0.isFinal }
            .map { "[\($0.source == .user ? "Me" : "Speaker")]: \($0.englishText)" }
            .joined(separator: "\n")
    }

    var duration: TimeInterval {
        (endTime ?? Date()).timeIntervalSince(startTime)
    }

    var formattedDuration: String {
        let minutes = Int(duration) / 60
        let seconds = Int(duration) % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

struct MeetingSummary: Codable {
    let englishSummary: String
    let chineseSummary: String
    let keyDecisions: [String]
    let actionItems: [String]
    let topicsDiscussed: [String]
}
