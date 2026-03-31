import SwiftUI

/// Displays the post-meeting summary with bilingual content.
struct MeetingSummaryView: View {
    let session: MeetingSession
    @State private var selectedTab = 0

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading) {
                    Text(session.title)
                        .font(.title2.bold())
                    Text("Duration: \(session.formattedDuration) · \(session.entries.count) segments")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()

                if session.summary != nil {
                    Button("Copy Summary") {
                        copySummaryToClipboard()
                    }
                    .buttonStyle(.bordered)

                    Button("Export") {
                        exportSummary()
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding()

            Divider()

            // Tab bar
            Picker("View", selection: $selectedTab) {
                Text("Summary / 摘要").tag(0)
                Text("Full Transcript").tag(1)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.top, 8)

            // Content
            if selectedTab == 0 {
                summaryTab
            } else {
                transcriptTab
            }
        }
        .frame(minWidth: 600, minHeight: 400)
    }

    // MARK: - Summary Tab

    private var summaryTab: some View {
        ScrollView {
            if let summary = session.summary {
                VStack(alignment: .leading, spacing: 20) {
                    // English Summary
                    summarySection(title: "English Summary", content: summary.englishSummary)

                    // Chinese Summary
                    summarySection(title: "中文摘要", content: summary.chineseSummary)

                    // Key Decisions
                    if !summary.keyDecisions.isEmpty {
                        bulletSection(title: "Key Decisions / 关键决定", items: summary.keyDecisions, icon: "checkmark.seal.fill", color: .green)
                    }

                    // Action Items
                    if !summary.actionItems.isEmpty {
                        bulletSection(title: "Action Items / 待办事项", items: summary.actionItems, icon: "checklist", color: .orange)
                    }

                    // Topics
                    if !summary.topicsDiscussed.isEmpty {
                        bulletSection(title: "Topics Discussed / 讨论话题", items: summary.topicsDiscussed, icon: "bubble.left.and.bubble.right.fill", color: .blue)
                    }
                }
                .padding()
            } else if session.isActive {
                ContentUnavailableView(
                    "Meeting in Progress",
                    systemImage: "waveform",
                    description: Text("Summary will be generated when the meeting ends.")
                )
                .padding(.top, 40)
            } else {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Generating summary...")
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 40)
            }
        }
    }

    private func summarySection(title: String, content: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            Text(content)
                .font(.body)
                .textSelection(.enabled)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 10))
    }

    private func bulletSection(title: String, items: [String], icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: icon)
                .font(.headline)
                .foregroundStyle(color)

            ForEach(items, id: \.self) { item in
                HStack(alignment: .top, spacing: 8) {
                    Text("•")
                        .foregroundStyle(color)
                    Text(item)
                        .textSelection(.enabled)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Transcript Tab

    private var transcriptTab: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                ForEach(session.entries) { entry in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: entry.source == .user ? "person.fill" : "person.wave.2.fill")
                            .foregroundStyle(entry.source == .user ? .green : speakerColor(for: entry.speakerLabel))
                            .frame(width: 20)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.speakerLabel)
                                .font(.caption.bold())
                                .foregroundStyle(entry.source == .user ? .green : speakerColor(for: entry.speakerLabel))

                            Text(entry.englishText)
                                .textSelection(.enabled)

                            if let chinese = entry.chineseText {
                                Text(chinese)
                                    .foregroundStyle(.blue)
                                    .font(.callout)
                                    .textSelection(.enabled)
                            }
                        }

                        Spacer()

                        Text(entry.timestamp, style: .time)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 4)

                    Divider()
                }
            }
            .padding()
        }
    }

    // MARK: - Actions

    private func copySummaryToClipboard() {
        guard let summary = session.summary else { return }
        let text = """
            Meeting Summary - \(session.title)
            Duration: \(session.formattedDuration)

            \(summary.englishSummary)

            中文摘要:
            \(summary.chineseSummary)

            Key Decisions:
            \(summary.keyDecisions.map { "• \($0)" }.joined(separator: "\n"))

            Action Items:
            \(summary.actionItems.map { "• \($0)" }.joined(separator: "\n"))
            """
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    private func exportSummary() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.plainText]
        panel.nameFieldStringValue = "\(session.title)_summary.txt"

        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            guard let summary = session.summary else { return }

            let content = """
                Meeting: \(session.title)
                Date: \(session.startTime.formatted())
                Duration: \(session.formattedDuration)

                ===== English Summary =====
                \(summary.englishSummary)

                ===== 中文摘要 =====
                \(summary.chineseSummary)

                ===== Key Decisions / 关键决定 =====
                \(summary.keyDecisions.map { "• \($0)" }.joined(separator: "\n"))

                ===== Action Items / 待办事项 =====
                \(summary.actionItems.map { "• \($0)" }.joined(separator: "\n"))

                ===== Topics / 话题 =====
                \(summary.topicsDiscussed.map { "• \($0)" }.joined(separator: "\n"))

                ===== Full Transcript =====
                \(session.fullTranscript)
                """

            try? content.write(to: url, atomically: true, encoding: .utf8)
        }
    }

    // MARK: - Speaker Colors

    private static let speakerColors: [Color] = [.blue, .purple, .orange, .pink, .teal, .indigo, .mint, .brown]

    private func speakerColor(for label: String) -> Color {
        // Extract speaker number from label like "Speaker 1", "Speaker 2"
        if let number = label.split(separator: " ").last.flatMap({ Int($0) }) {
            return Self.speakerColors[(number - 1) % Self.speakerColors.count]
        }
        return .secondary
    }
}
