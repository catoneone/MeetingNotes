// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MeetingNotes",
    platforms: [
        .macOS(.v14)
    ],
    targets: [
        .executableTarget(
            name: "MeetingNotes",
            path: "Sources/MeetingNotes",
            linkerSettings: [
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("Speech"),
            ]
        )
    ]
)
