// Route3 Control — native macOS shell for the Route3 control center.
//
// Ownership model (see docs/ARCHITECTURE.md): the app attaches to a healthy
// server at http://127.0.0.1:<port>. Only if none is running does it start
// `node control-center/server.js` itself; quitting stops ONLY a server this
// app started, never an independent one.

import AppKit
import WebKit

enum RuntimeEnvironment {
    static func versionOrder(_ left: String, _ right: String) -> Bool {
        left.compare(right, options: .numeric) == .orderedDescending
    }

    static func childPath(environment: [String: String], home: String, node: String? = nil) -> String {
        var paths = node.map { [URL(fileURLWithPath: $0).deletingLastPathComponent().path] } ?? []
        paths += (environment["PATH"] ?? "").split(separator: ":").map(String.init)
        paths += ["\(home)/.local/bin", "\(home)/.kimi-code/bin", "\(home)/.bun/bin",
                  "\(home)/.cargo/bin", "\(home)/.npm-global/bin", "/opt/homebrew/bin",
                  "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        let nvm = environment["NVM_DIR"] ?? "\(home)/.nvm"
        let versionsRoot = URL(fileURLWithPath: nvm).appendingPathComponent("versions/node")
        let versions = ((try? FileManager.default.contentsOfDirectory(atPath: versionsRoot.path)) ?? []).sorted(by: versionOrder)
        paths += versions.map { versionsRoot.appendingPathComponent($0).appendingPathComponent("bin").path }
        var seen = Set<String>()
        return paths.filter { $0.hasPrefix("/") && seen.insert($0).inserted }.joined(separator: ":")
    }
}

enum PanelIdentity {
    static func isHealthy(data: Data?, response: URLResponse?, error: Error?) -> Bool {
        guard error == nil, (response as? HTTPURLResponse)?.statusCode == 200,
              let data, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return object["service"] as? String == "route3-control-center"
    }

    static func isLocal(_ url: URL, port: Int) -> Bool {
        url.scheme == "http" && url.host == "127.0.0.1" && url.port == port && url.user == nil && url.password == nil
    }

    static func isExternalWeb(_ url: URL) -> Bool {
        ["http", "https"].contains(url.scheme?.lowercased() ?? "") && url.host != nil && url.user == nil && url.password == nil
    }
}

if CommandLine.arguments.contains("--self-test") {
    let path = RuntimeEnvironment.childPath(environment: ["PATH": "/usr/bin:/bin:relative:/usr/bin"], home: "/test-home", node: "/selected/bin/node").split(separator: ":").map(String.init)
    precondition(path.first == "/selected/bin")
    precondition(path.contains("/test-home/.local/bin") && path.contains("/test-home/.kimi-code/bin") && path.contains("/opt/homebrew/bin"))
    precondition(path.count == Set(path).count && !path.contains("relative"))
    precondition(["v9.0.0", "v22.1.0", "v20.19.0"].sorted(by: RuntimeEnvironment.versionOrder).first == "v22.1.0")
    let url = URL(string: "http://127.0.0.1:43173/api/health")!
    let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
    precondition(PanelIdentity.isHealthy(data: Data(#"{"service":"route3-control-center"}"#.utf8), response: response, error: nil))
    precondition(!PanelIdentity.isHealthy(data: Data(#"{"service":"unrelated"}"#.utf8), response: response, error: nil))
    precondition(!PanelIdentity.isHealthy(data: Data("OK".utf8), response: response, error: nil))
    precondition(PanelIdentity.isLocal(url, port: 43173))
    precondition(!PanelIdentity.isLocal(URL(string: "http://127.0.0.1:8000")!, port: 43173))
    precondition(!PanelIdentity.isExternalWeb(URL(string: "file:///etc/passwd")!))
    precondition(!PanelIdentity.isExternalWeb(URL(string: "javascript:alert(1)")!))
    precondition(PanelIdentity.isExternalWeb(URL(string: "https://example.com")!))
    print("Native self-check passed: Finder PATH, numeric NVM order, server identity, navigation confinement.")
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
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
        webView.uiDelegate = self
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

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.absoluteString == "about:blank" || PanelIdentity.isLocal(url, port: server.port) {
            decisionHandler(.allow)
        } else {
            // Only explicit user link clicks may leave the panel, in the system browser.
            if navigationAction.navigationType == .linkActivated && PanelIdentity.isExternalWeb(url) {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if PanelIdentity.isLocal(url, port: server.port) { webView.load(URLRequest(url: url)) }
        else if navigationAction.navigationType == .linkActivated && PanelIdentity.isExternalWeb(url) { NSWorkspace.shared.open(url) }
        return nil
    }

    private func renderStatus(_ line: String, healthy: Bool) {
        statusField.stringValue = line
        statusField.textColor = healthy ? NSColor.systemGreen : NSColor.systemRed
        restartButton.isEnabled = server.ownsServer || !server.isHealthy
    }

    // MARK: - Actions

    @objc private func openInBrowser() {
        guard server.isHealthy else { server.ensureRunning(); return }
        NSWorkspace.shared.open(panelURL)
    }

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
    private var checkingHealth = false
    private var healthGeneration = 0
    private var stopping = false
    private var restartAfterStop = false
    private let logQueue = DispatchQueue(label: "az.itinnovations.route3.log")
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
        guard !stopping, force || !isHealthy else { return }
        checkHealth(allowStart: true)
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
        restartAfterStop = true
        stopOwnedServer()
    }

    func stopOwnedServer() {
        guard let process = ownedProcess, !stopping else { return }
        stopping = true
        isHealthy = false
        healthGeneration += 1
        checkingHealth = false
        status("Local server: stopping…", healthy: false)
        // Keep ownership until the termination handler runs. A restart cannot bind
        // a replacement while the previous Node process is still shutting down.
        if process.isRunning { process.terminate() }
    }

    private func startOwnedServer() {
        guard ownedProcess == nil, !stopping else { return }
        guard let script = serverScript else {
            status("Route3 server script was not found. Reinstall with route3-skill install.", healthy: false)
            return
        }
        guard let node = discoverNode() else {
            status("Node.js was not found. Install Node 18+ (Homebrew or nvm) and reopen this app.", healthy: false)
            return
        }
        startupAttempts += 1
        prepareLog()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [script.path, "--port", String(port), "--workspace", workspace]
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = RuntimeEnvironment.childPath(environment: environment, home: NSHomeDirectory(), node: node)
        environment["ROUTE3_PORT"] = String(port)
        environment["ROUTE3_WORKSPACE"] = workspace
        process.environment = environment
        process.currentDirectoryURL = URL(fileURLWithPath: workspace)
        pipeOutput(process)
        process.terminationHandler = { [weak self] finished in
            DispatchQueue.main.async { [weak self] in
                guard let self, self.ownedProcess === finished else { return }
                self.ownedProcess = nil
                self.ownsServer = false
                self.isHealthy = false
                self.stopping = false
                self.healthGeneration += 1
                self.checkingHealth = false
                let restart = self.restartAfterStop
                self.restartAfterStop = false
                self.status("Local server: stopped. Use Restart Local Server.", healthy: false)
                if restart { self.checkHealth(allowStart: true) }
            }
        }
        do {
            try process.run()
        } catch {
            process.terminationHandler = nil
            status("Node could not start the server: \(error.localizedDescription)", healthy: false)
            return
        }
        ownedProcess = process
        ownsServer = true
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
        logQueue.async { [weak self] in
            try? self?.logHandle?.write(contentsOf: data)
        }
    }

    private func discoverNode() -> String? {
        let path = RuntimeEnvironment.childPath(environment: ProcessInfo.processInfo.environment, home: NSHomeDirectory())
        for directory in path.split(separator: ":") {
            let candidate = URL(fileURLWithPath: String(directory)).appendingPathComponent("node")
            if FileManager.default.isExecutableFile(atPath: candidate.path) { return candidate.path }
        }
        return nil
    }

    private func checkHealth(allowStart: Bool = false) {
        precondition(Thread.isMainThread)
        guard !checkingHealth, !stopping else { return }
        checkingHealth = true
        let generation = healthGeneration
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/api/health")!)
        request.timeoutInterval = 3
        request.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            let healthy = PanelIdentity.isHealthy(data: data, response: response, error: error)
            let refused = (error as? URLError)?.code == .cannotConnectToHost
            DispatchQueue.main.async { [weak self] in
                guard let self, generation == self.healthGeneration else { return }
                self.checkingHealth = false
                guard !self.stopping else { return }
                let becameHealthy = healthy && !self.isHealthy
                self.isHealthy = healthy
                if healthy {
                    self.status("Local server: running\(self.ownsServer ? " (started by this app)" : " (external)") · workspace \(self.workspace)", healthy: true)
                    if becameHealthy { self.onHealthy?() }
                } else if response != nil {
                    self.status("Port \(self.port) is occupied by an unverified service. Route3 will not attach or stop it.", healthy: false)
                } else if refused && self.ownedProcess == nil && (allowStart || self.startupAttempts == 0) {
                    self.startOwnedServer()
                } else if self.ownedProcess == nil {
                    self.status("Local server: not responding on port \(self.port). Use Restart Local Server.", healthy: false)
                } else {
                    self.status("Local server: starting…", healthy: false)
                }
            }
        }.resume()
    }
}
