// Route3 Control — native macOS shell for the Route3 control center.
//
// Ownership model (see docs/ARCHITECTURE.md): the app attaches to a healthy
// server at http://127.0.0.1:<port>. Only if none is running does it start
// `node control-center/server.js` itself; quitting stops ONLY a server this
// app started, never an independent one.

import AppKit
import WebKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusField: NSTextField!
    private var restartButton: NSButton!
    private var server: ServerController!

    var panelURL: URL { URL(string: "http://127.0.0.1:\(server.port)/")! }

    func applicationDidFinishLaunching(_ notification: Notification) {
        server = ServerController()
        server.onState = { [weak self] line, healthy in self?.renderStatus(line, healthy: healthy) }
        server.onHealthy = { [weak self] in self?.loadPanel() }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 840),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Route3 Control"
        window.minSize = NSSize(width: 980, height: 640)
        window.center()

        let content = NSView()
        window.contentView = content

        webView = WKWebView(frame: .zero)
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(webView)

        let bar = NSBox()
        bar.boxType = .custom
        bar.fillColor = NSColor.controlBackgroundColor
        bar.borderWidth = 0
        bar.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(bar)

        statusField = NSTextField(labelWithString: "Local server: checking…")
        statusField.font = .systemFont(ofSize: 12, weight: .medium)
        statusField.lineBreakMode = .byTruncatingMiddle
        statusField.maximumNumberOfLines = 1
        statusField.cell?.truncatesLastVisibleLine = true
        statusField.cell?.wraps = false
        statusField.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(statusField)

        let openButton = NSButton(title: "Open in Browser", target: self, action: #selector(openInBrowser))
        openButton.bezelStyle = .rounded
        openButton.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(openButton)

        restartButton = NSButton(title: "Restart Local Server", target: self, action: #selector(restartServer))
        restartButton.bezelStyle = .rounded
        restartButton.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(restartButton)

        let workspaceButton = NSButton(title: "Choose Project Folder…", target: self, action: #selector(chooseWorkspace))
        workspaceButton.bezelStyle = .rounded
        workspaceButton.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(workspaceButton)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: content.topAnchor),
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: bar.topAnchor),
            bar.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            bar.heightAnchor.constraint(equalToConstant: 52),
            statusField.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 16),
            statusField.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            workspaceButton.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -16),
            workspaceButton.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            restartButton.trailingAnchor.constraint(equalTo: workspaceButton.leadingAnchor, constant: -12),
            restartButton.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            openButton.trailingAnchor.constraint(equalTo: restartButton.leadingAnchor, constant: -12),
            openButton.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            statusField.trailingAnchor.constraint(lessThanOrEqualTo: openButton.leadingAnchor, constant: -16),
        ])

        window.makeKeyAndOrderFront(nil)
        buildMenu()
        showPlaceholder("Route3 control center starting…")
        server.startMonitoring()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        server.stopOwnedServer()   // never touches an independently running server
        return .terminateNow
    }

    // MARK: - Panel lifecycle

    private func loadPanel() { webView.load(URLRequest(url: panelURL)) }

    private func showPlaceholder(_ message: String) {
        webView.loadHTMLString("""
        <html><head><meta charset="utf-8"><style>
        body{font:-apple-system 15px/1.6;display:grid;place-items:center;height:100vh;margin:0;
             color:#666;background:#f5f6f8;text-align:center}
        </style></head><body><div>\(message)</div></body></html>
        """, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showPlaceholder("Control center is unreachable. The status bar below shows the server state; it reloads automatically once the server responds.")
    }

    private func renderStatus(_ line: String, healthy: Bool) {
        statusField.stringValue = line
        statusField.textColor = healthy ? NSColor.systemGreen : NSColor.systemRed
        restartButton.isEnabled = server.ownsServer || !server.isHealthy
    }

    // MARK: - Actions

    @objc private func openInBrowser() { NSWorkspace.shared.open(panelURL) }

    @objc private func restartServer() {
        if server.ownsServer {
            server.restartOwnedServer()
        } else {
            server.ensureRunning(force: true)
        }
        showPlaceholder("Reconnecting to Route3 control center…")
    }

    @objc private func chooseWorkspace() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.directoryURL = URL(fileURLWithPath: server.workspace)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        server.setWorkspace(url.path)
    }

    @objc private func reloadPanel() {
        server.isHealthy ? loadPanel() : server.ensureRunning()
    }

    @objc private func showLog() {
        NSWorkspace.shared.activateFileViewerSelecting([ServerController.logURL])
    }

    // MARK: - Menu

    private func buildMenu() {
        let main = NSMenu()

        let appMenu = NSMenu()
        let appName = ProcessInfo.processInfo.processName
        appMenu.addItem(withTitle: "About \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let appItem = NSMenuItem()
        appItem.submenu = appMenu
        main.addItem(appItem)

        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "Open in Browser", action: #selector(openInBrowser), keyEquivalent: "b")
        fileMenu.addItem(withTitle: "Reload Panel", action: #selector(reloadPanel), keyEquivalent: "r")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Choose Project Folder…", action: #selector(chooseWorkspace), keyEquivalent: "O")
        let fileItem = NSMenuItem()
        fileItem.submenu = fileMenu
        main.addItem(fileItem)

        let serverMenu = NSMenu(title: "Server")
        serverMenu.addItem(withTitle: "Restart Local Server", action: #selector(restartServer), keyEquivalent: "")
        serverMenu.addItem(withTitle: "Show Server Log in Finder", action: #selector(showLog), keyEquivalent: "")
        let serverItem = NSMenuItem()
        serverItem.submenu = serverMenu
        main.addItem(serverItem)

        NSApplication.shared.mainMenu = main
    }
}

// MARK: - Server ownership

final class ServerController: NSObject {
    static var logURL: URL {
        FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Logs/route3-control.log")
    }

    let port = Int(Bundle.main.object(forInfoDictionaryKey: "ROUTE3Port") as? String ?? "") ?? 43173
    private(set) var ownsServer = false
    private(set) var isHealthy = false
    private var ownedProcess: Process?
    private var healthTimer: Timer?
    private var logHandle: FileHandle?
    private var startupAttempts = 0
    var onState: ((String, Bool) -> Void)?
    var onHealthy: (() -> Void)?

    var workspace: String {
        get { UserDefaults.standard.string(forKey: "route3Workspace") ?? NSHomeDirectory() }
        set {
            UserDefaults.standard.set(newValue, forKey: "route3Workspace")
            restartOwnedServer()
        }
    }

    private var serverScript: URL? {
        var candidates: [URL] = []
        if let built = Bundle.main.object(forInfoDictionaryKey: "ROUTE3ServerJSPath") as? String, !built.isEmpty {
            candidates.append(URL(fileURLWithPath: built))
        }
        let installed = NSHomeDirectory() + "/.local/share/route3/control-center/server.js"
        candidates.append(URL(fileURLWithPath: installed))
        let relative = Bundle.main.bundleURL
            .deletingLastPathComponent()   // build/
            .deletingLastPathComponent()   // mac/
            .deletingLastPathComponent()   // control-center/
            .appendingPathComponent("server.js")
        candidates.append(relative)
        for url in candidates {
            var isDirectory: ObjCBool = false
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), !isDirectory.boolValue { return url }
        }
        return nil
    }

    private func status(_ line: String, healthy: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.onState?(line, healthy)
        }
    }

    func startMonitoring() {
        checkHealth()
        healthTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.checkHealth()
        }
    }

    func ensureRunning(force: Bool = false) {
        guard force || !isHealthy else { return }
        if !isHealthy { startOwnedServer() }
    }

    func setWorkspace(_ path: String) {
        if ownsServer {
            workspace = path   // setter restarts the owned server
        } else {
            let alert = NSAlert()
            alert.messageText = "The control server was started outside this app."
            alert.informativeText = "Its workspace stays as configured there. Stop that server and use Restart Local Server to run one with workspace \(path)."
            alert.runModal()
        }
    }

    func restartOwnedServer() {
        guard ownsServer else { return }
        stopOwnedServer()
        startOwnedServer()
    }

    func stopOwnedServer() {
        guard let process = ownedProcess else { return }
        ownedProcess = nil
        ownsServer = false
        process.interrupt()   // SIGTERM-like delivery; node stops its own children
        DispatchQueue.global().asyncAfter(deadline: .now() + 5) {
            if process.isRunning { process.terminate() }
        }
        status("Local server: stopping…", healthy: false)
    }

    private func startOwnedServer() {
        guard ownedProcess == nil else { return }
        guard let script = serverScript else {
            status("Route3 server script was not found. Reinstall with route3-skill install.", healthy: false)
            return
        }
        guard let node = discoverNode() else {
            status("Node.js was not found. Install Node 18+ (Homebrew or nvm) and reopen this app.", healthy: false)
            return
        }
        prepareLog()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [script.path, "--port", String(port), "--workspace", workspace]
        var environment = ProcessInfo.processInfo.environment
        environment["ROUTE3_PORT"] = String(port)
        environment["ROUTE3_WORKSPACE"] = workspace
        process.environment = environment
        process.currentDirectoryURL = URL(fileURLWithPath: workspace)
        pipeOutput(process)
        do {
            try process.run()
        } catch {
            status("Node could not start the server: \(error.localizedDescription)", healthy: false)
            return
        }
        ownedProcess = process
        ownsServer = true
        startupAttempts += 1
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async { [weak self] in
                guard let self, self.ownedProcess === process else { return }
                self.ownedProcess = nil
                self.ownsServer = false
                self.status("Local server: stopped. Use Restart Local Server.", healthy: false)
            }
        }
        status("Local server: starting (owned by this app)…", healthy: false)
    }

    private func pipeOutput(_ process: Process) {
        let out = Pipe()
        process.standardOutput = out
        process.standardError = out
        let handle = out.fileHandleForReading
        handle.readabilityHandler = { [weak self] file in
            let data = file.availableData
            if data.isEmpty { file.readabilityHandler = nil; return }
            self?.appendLog(data)
        }
    }

    private func prepareLog() {
        let url = Self.logURL
        let manager = FileManager.default
        try? manager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, size > 1_000_000 {
            try? manager.moveItem(at: url, to: url.appendingPathExtension("old"))
        }
        if !manager.fileExists(atPath: url.path) { manager.createFile(atPath: url.path, contents: nil) }
        logHandle = try? FileHandle(forWritingTo: url)
        logHandle?.seekToEndOfFile()
        appendLog(Data("\n--- launched \(Date()) — workspace \(workspace) ---\n".utf8))
    }

    private func appendLog(_ data: Data) {
        DispatchQueue.global().async { [weak self] in
            try? self?.logHandle?.write(contentsOf: data)
        }
    }

    private func discoverNode() -> String? {
        var seen = Set<String>()
        var candidates: [String] = []
        let path = ProcessInfo.processInfo.environment["PATH"] ?? ""
        candidates += path.split(separator: ":").map(String.init)
        candidates += ["/opt/homebrew/bin", "/usr/local/bin"]
        for directory in candidates where !seen.contains(directory) {
            seen.insert(directory)
            let candidate = URL(fileURLWithPath: directory).appendingPathComponent("node")
            if FileManager.default.isExecutableFile(atPath: candidate.path) { return candidate.path }
        }
        // Finder-launched apps miss nvm's PATH; enumerate its version directories.
        let nvm = NSHomeDirectory() + "/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvm).sorted(by: >) {
            for version in versions {
                let candidate = URL(fileURLWithPath: nvm).appendingPathComponent(version).appendingPathComponent("bin/node")
                if FileManager.default.isExecutableFile(atPath: candidate.path) { return candidate.path }
            }
        }
        return nil
    }

    private func checkHealth() {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/api/health")!)
        request.timeoutInterval = 3
        let task = URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            guard let self else { return }
            let healthy = error == nil && (response as? HTTPURLResponse)?.statusCode == 200
            let becameHealthy = healthy && !self.isHealthy
            self.isHealthy = healthy
            if healthy {
                self.status("Local server: running\(self.ownsServer ? " (started by this app)" : " (external)") · workspace \(self.workspace)", healthy: true)
                if becameHealthy { DispatchQueue.main.async { [weak self] in self?.onHealthy?() } }
            } else {
                if self.ownedProcess == nil && self.startupAttempts == 0 {
                    // No server anywhere: adopt ownership instead of staring at a dead port.
                    DispatchQueue.main.async { self.startOwnedServer() }
                } else if self.ownedProcess == nil {
                    self.status("Local server: not responding on port \(self.port).", healthy: false)
                } else {
                    self.status("Local server: starting…", healthy: false)
                }
            }
        }
        task.resume()
    }
}
