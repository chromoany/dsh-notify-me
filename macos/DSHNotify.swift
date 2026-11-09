// DSH Notify — tiny macOS notifier used by dsh-notify-me's host half.
//
// The DSH Desktop page cannot reliably raise a macOS system notification from
// the Electron renderer, so the host spawns this helper instead:
//
//   DSH Notify.app/Contents/MacOS/dsh-notify --title T --body B
//       [--sound] [--session ID] [--id ID] [--click-file PATH] [--open URL]
//   DSH Notify.app/Contents/MacOS/dsh-notify --remove ID
//
// It posts one UNUserNotification and exits. Clicking the notification later
// relaunches the app through LaunchServices; the delegate then records the
// session id in --click-file (the page reads it to switch conversations) and
// opens --open (default dsh://open, which brings the DSH window forward).
// --id names that notification so --remove ID can withdraw it again (the page
// does that when the user is back at the page or the auto-dismiss timer fires).

import Cocoa
import UserNotifications

func parseArgs() -> [String: String] {
    var out: [String: String] = [:]
    let argv = Array(CommandLine.arguments.dropFirst())
    var i = 0
    while i < argv.count {
        let key = argv[i]
        if key.hasPrefix("--") {
            let name = String(key.dropFirst(2))
            if i + 1 < argv.count && !argv[i + 1].hasPrefix("--") {
                out[name] = argv[i + 1]
                i += 2
                continue
            }
            out[name] = "1"
        }
        i += 1
    }
    return out
}

final class Delegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = parseArgs()
        if let removeId = args["remove"], !removeId.isEmpty {
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [removeId])
            print("OK")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(0) }
            return
        }
        guard let title = args["title"] else {
            // Launched by a notification click (or by hand): wait for the
            // click callback, then leave.
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { exit(0) }
            return
        }
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, error in
            guard granted else {
                print("ERROR=not-authorized \(error?.localizedDescription ?? "")")
                exit(2)
            }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = args["body"] ?? ""
            if args["sound"] != nil { content.sound = .default }
            var info: [String: String] = ["open": args["open"] ?? "dsh://open"]
            if let s = args["session"] { info["sessionId"] = s }
            if let f = args["click-file"] { info["clickFile"] = f }
            content.userInfo = info
            // The page tracks this identifier so it can withdraw the alert later.
            let identifier = args["id"].flatMap { $0.isEmpty ? nil : $0 } ?? UUID().uuidString
            let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
            center.add(request) { error in
                if let error = error {
                    print("ERROR=\(error.localizedDescription)")
                    exit(1)
                }
                print("OK")
                exit(0)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
            print("ERROR=timeout")
            exit(3)
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if let file = info["clickFile"] as? String, let sid = info["sessionId"] as? String {
            let payload: [String: Any] = ["sessionId": sid, "at": Int(Date().timeIntervalSince1970 * 1000)]
            if let data = try? JSONSerialization.data(withJSONObject: payload) {
                try? data.write(to: URL(fileURLWithPath: file))
            }
        }
        if let raw = info["open"] as? String, let url = URL(string: raw) {
            NSWorkspace.shared.open(url)
        }
        completionHandler()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
    }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
