import SwiftUI

@main
struct MeetingNotesApp: App {
    @State private var appState = AppState()
    @State private var overlayController = OverlayWindowController()

    var body: some Scene {
        MenuBarExtra("MeetingNotes", systemImage: appState.isRecording ? "mic.fill" : "mic") {
            MenuBarView(appState: appState, overlayController: overlayController)
                .frame(width: 360, height: 480)
        }
        .menuBarExtraStyle(.window)

        Window("Meeting Summary", id: "summary") {
            if let session = appState.currentSession ?? appState.pastSessions.first {
                MeetingSummaryView(session: session)
            } else {
                ContentUnavailableView("No Meeting", systemImage: "doc.text",
                                       description: Text("Start a meeting to see the summary here."))
            }
        }

        Settings {
            SettingsView(appState: appState)
        }
    }
}
