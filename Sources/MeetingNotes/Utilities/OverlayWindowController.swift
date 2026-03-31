import SwiftUI
import AppKit

/// Manages the floating overlay window for subtitles.
/// Uses NSPanel for always-on-top, non-activating behavior.
@Observable
final class OverlayWindowController {
    private var overlayPanel: NSPanel?

    /// Show the subtitle overlay at the bottom of the screen.
    func showOverlay(appState: AppState) {
        if overlayPanel != nil {
            overlayPanel?.orderFront(nil)
            return
        }

        guard let screen = NSScreen.main else { return }

        let panelWidth: CGFloat = 720
        let panelHeight: CGFloat = 160

        // Position at bottom center of screen
        let x = (screen.visibleFrame.width - panelWidth) / 2 + screen.visibleFrame.origin.x
        let y = screen.visibleFrame.origin.y + 60  // 60pt from bottom

        let panel = NSPanel(
            contentRect: NSRect(x: x, y: y, width: panelWidth, height: panelHeight),
            styleMask: [.nonactivatingPanel, .hudWindow, .utilityWindow],
            backing: .buffered,
            defer: false
        )

        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.titlebarAppearsTransparent = true
        panel.titleVisibility = .hidden

        // Allow the panel to be visible over fullscreen apps
        panel.hidesOnDeactivate = false

        let hostingView = NSHostingView(rootView: SubtitleOverlayView(appState: appState))
        hostingView.frame = panel.contentView?.bounds ?? .zero
        hostingView.autoresizingMask = [.width, .height]
        panel.contentView = hostingView

        panel.orderFront(nil)
        overlayPanel = panel
    }

    /// Hide the subtitle overlay.
    func hideOverlay() {
        overlayPanel?.orderOut(nil)
        overlayPanel = nil
    }

    /// Toggle overlay visibility.
    func toggleOverlay(appState: AppState) {
        if overlayPanel?.isVisible == true {
            hideOverlay()
        } else {
            showOverlay(appState: appState)
        }
    }
}
