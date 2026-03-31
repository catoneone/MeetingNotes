import SwiftUI

/// The main menu bar popup view with meeting controls and transcript display.
struct MenuBarView: View {
    @Bindable var appState: AppState
    var overlayController: OverlayWindowController

    @State private var showSettings = false
    @State private var showSummary = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            headerSection

            Divider()

            if appState.isRecording {
                // Active meeting view
                activeMeetingView
            } else {
                // Idle view
                idleMeetingView
            }

            Divider()

            // Bottom controls
            bottomControls
        }
        .padding(0)
    }

    // MARK: - Header

    private var headerSection: some View {
        HStack {
            Image(systemName: appState.isRecording ? "record.circle.fill" : "mic.slash")
                .foregroundStyle(appState.isRecording ? .red : .secondary)
                .symbolEffect(.pulse, isActive: appState.isRecording)

            Text(appState.isRecording ? "Recording..." : "MeetingNotes")
                .font(.headline)

            Spacer()

            if appState.isRecording {
                Text(appState.currentSession?.formattedDuration ?? "00:00")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: - Active Meeting

    private var activeMeetingView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    // Current subtitle
                    if !appState.currentEnglishText.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(appState.currentEnglishText)
                                .font(.system(size: 14))
                                .foregroundStyle(.primary)

                            if !appState.currentChineseText.isEmpty {
                                Text(appState.currentChineseText)
                                    .font(.system(size: 13))
                                    .foregroundStyle(.blue)
                            }
                        }
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                    }

                    // AI Suggestion
                    if let suggestion = appState.latestSuggestion {
                        suggestionCard(suggestion)
                    }

                    // Transcript history
                    if let session = appState.currentSession {
                        ForEach(session.entries.suffix(20)) { entry in
                            transcriptRow(entry)
                        }
                    }
                }
                .padding(12)
            }
        }
        .frame(maxHeight: .infinity)
    }

    private func suggestionCard(_ suggestion: AISuggestion) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: "lightbulb.fill")
                    .foregroundStyle(.yellow)
                Text("Suggested Response")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
            }

            Text(suggestion.englishSuggestion)
                .font(.system(size: 13))
                .foregroundStyle(.primary)

            Text(suggestion.chineseSuggestion)
                .font(.system(size: 12))
                .foregroundStyle(.orange)

            Button("Copy English") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(suggestion.englishSuggestion, forType: .string)
            }
            .buttonStyle(.borderless)
            .font(.caption)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.yellow.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(.yellow.opacity(0.3), lineWidth: 1)
        )
    }

    private func transcriptRow(_ entry: TranscriptEntry) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: entry.source == .user ? "person.fill" : "speaker.wave.2.fill")
                    .font(.caption2)
                    .foregroundStyle(entry.source == .user ? .green : .secondary)

                Text(entry.source == .user ? "Me" : "Speaker")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                if !entry.isFinal {
                    ProgressView()
                        .controlSize(.mini)
                }
            }

            Text(entry.englishText)
                .font(.system(size: 12))
                .foregroundStyle(entry.isFinal ? .primary : .secondary)

            if let chinese = entry.chineseText {
                Text(chinese)
                    .font(.system(size: 11))
                    .foregroundStyle(.blue.opacity(0.8))
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: - Idle View

    private var idleMeetingView: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "waveform.circle")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)

            Text("Ready to assist your meeting")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Text("准备辅助您的会议")
                .font(.caption)
                .foregroundStyle(.tertiary)

            // Show past sessions
            if !appState.pastSessions.isEmpty {
                Divider()
                VStack(alignment: .leading, spacing: 4) {
                    Text("Recent Meetings")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)

                    ForEach(appState.pastSessions.prefix(3), id: \.startTime) { session in
                        HStack {
                            Text(session.title)
                                .font(.caption)
                            Spacer()
                            Text(session.formattedDuration)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.horizontal, 12)
            }

            Spacer()
        }
        .frame(maxHeight: .infinity)
    }

    // MARK: - Bottom Controls

    private var bottomControls: some View {
        VStack(spacing: 8) {
            // Error display
            if let error = appState.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 12)
            }

            HStack {
                // Start/Stop button
                Button(action: {
                    if appState.isRecording {
                        appState.stopMeeting()
                        overlayController.hideOverlay()
                    } else {
                        appState.startMeeting()
                        overlayController.showOverlay(appState: appState)
                    }
                }) {
                    Label(
                        appState.isRecording ? "End Meeting" : "Start Meeting",
                        systemImage: appState.isRecording ? "stop.circle.fill" : "play.circle.fill"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(appState.isRecording ? .red : .accentColor)

                // Toggle overlay
                if appState.isRecording {
                    Button(action: {
                        appState.showOverlay.toggle()
                        if appState.showOverlay {
                            overlayController.showOverlay(appState: appState)
                        } else {
                            overlayController.hideOverlay()
                        }
                    }) {
                        Image(systemName: appState.showOverlay ? "rectangle.on.rectangle.slash" : "rectangle.on.rectangle")
                    }
                    .help(appState.showOverlay ? "Hide Overlay" : "Show Overlay")
                }

                // Settings
                Button(action: {
                    if #available(macOS 14.0, *) {
                        NSApp.activate()
                    }
                    NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
                }) {
                    Image(systemName: "gear")
                }

                // Quit
                Button(action: {
                    if appState.isRecording {
                        appState.stopMeeting()
                    }
                    NSApplication.shared.terminate(nil)
                }) {
                    Image(systemName: "power")
                }
                .help("Quit MeetingNotes")
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
        .padding(.top, 8)
    }
}
