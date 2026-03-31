import SwiftUI

/// Floating overlay view that displays subtitles, translation, and AI suggestions.
struct SubtitleOverlayView: View {
    @Bindable var appState: AppState
    @State private var isHovered = false

    var body: some View {
        VStack(spacing: 6) {
            // English subtitle
            if !appState.currentEnglishText.isEmpty {
                Text(appState.currentEnglishText)
                    .font(.system(size: appState.subtitleFontSize, weight: .medium))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .shadow(color: .black.opacity(0.8), radius: 2, x: 0, y: 1)
            }

            // Chinese translation
            if !appState.currentChineseText.isEmpty {
                Text(appState.currentChineseText)
                    .font(.system(size: appState.subtitleFontSize - 2, weight: .regular))
                    .foregroundStyle(.cyan)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .shadow(color: .black.opacity(0.8), radius: 2, x: 0, y: 1)
            }

            // AI Suggestion (compact)
            if let suggestion = appState.latestSuggestion, isHovered {
                Divider()
                    .background(.white.opacity(0.3))

                VStack(spacing: 4) {
                    HStack {
                        Image(systemName: "lightbulb.fill")
                            .foregroundStyle(.yellow)
                            .font(.caption)
                        Text("Suggested Reply:")
                            .font(.caption)
                            .foregroundStyle(.yellow)
                        Spacer()
                    }

                    Text(suggestion.englishSuggestion)
                        .font(.system(size: 13))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.leading)

                    Text(suggestion.chineseSuggestion)
                        .font(.system(size: 12))
                        .foregroundStyle(.orange)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .frame(maxWidth: 700)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.black.opacity(appState.overlayOpacity))
        )
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                isHovered = hovering
            }
        }
    }
}
