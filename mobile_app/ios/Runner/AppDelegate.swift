import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  private var receiptChannel: FlutterMethodChannel?
  private var receiptResult: FlutterResult?
  private var receiptDirectory: URL?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let controller = FlutterViewController(project: nil, initialRoute: nil, nibName: nil, bundle: nil)
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = controller
    self.window = window
    window.makeKeyAndVisible()

    GeneratedPluginRegistrant.register(with: self)
    receiptChannel = FlutterMethodChannel(
      name: "com.urbanblade.mobile/receipts", binaryMessenger: controller.binaryMessenger)
    receiptChannel?.setMethodCallHandler { [weak self] call, result in
      guard let self else {
        result(FlutterError(code: "closed", message: "Receipt export was closed.", details: nil))
        return
      }
      guard call.method == "savePdf" else {
        result(FlutterMethodNotImplemented)
        return
      }
      self.saveReceipt(call.arguments, result: result)
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  private func saveReceipt(_ arguments: Any?, result: @escaping FlutterResult) {
    guard receiptResult == nil else {
      result(FlutterError(code: "busy", message: "A receipt is already being saved.", details: nil))
      return
    }
    guard let arguments = arguments as? [String: Any],
      let bytes = arguments["bytes"] as? FlutterStandardTypedData,
      bytes.data.starts(with: Data("%PDF-".utf8)),
      let filename = arguments["filename"] as? String,
      !filename.isEmpty,
      (filename as NSString).lastPathComponent == filename,
      filename.lowercased().hasSuffix(".pdf"),
      var presenter = window?.rootViewController
    else {
      result(FlutterError(code: "invalid", message: "Receipt data is missing.", details: nil))
      return
    }
    while let presented = presenter.presentedViewController {
      presenter = presented
    }
    guard presenter.viewIfLoaded?.window != nil, !presenter.isBeingDismissed else {
      result(FlutterError(code: "unavailable", message: "Could not open the save dialog.", details: nil))
      return
    }

    receiptResult = result
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("UrbanBlade-receipt-\(UUID().uuidString)", isDirectory: true)
    receiptDirectory = directory
    let file = directory.appendingPathComponent(filename)
    let content = bytes.data
    DispatchQueue.global(qos: .utility).async { [weak self, weak presenter] in
      do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try content.write(to: file, options: .atomic)
        DispatchQueue.main.async {
          guard let self else { return }
          guard let presenter, presenter.viewIfLoaded?.window != nil,
            !presenter.isBeingDismissed, presenter.presentedViewController == nil
          else {
            self.finishReceipt(FlutterError(
              code: "unavailable", message: "Could not open the save dialog.", details: nil))
            return
          }
          let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
          picker.delegate = self
          picker.modalPresentationStyle = .formSheet
          presenter.present(picker, animated: true)
          picker.presentationController?.delegate = self
        }
      } catch {
        DispatchQueue.main.async {
          self?.finishReceipt(FlutterError(
            code: "save_failed", message: "Could not prepare the receipt. Please try again.", details: nil))
        }
      }
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finishReceipt(!urls.isEmpty)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finishReceipt(false)
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finishReceipt(false)
  }

  private func finishReceipt(_ value: Any) {
    let result = receiptResult
    receiptResult = nil
    if let directory = receiptDirectory {
      try? FileManager.default.removeItem(at: directory)
    }
    receiptDirectory = nil
    result?(value)
  }
}
