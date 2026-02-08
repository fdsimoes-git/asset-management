import UIKit
import Capacitor
import WebKit

class CustomViewController: CAPBridgeViewController, WKNavigationDelegate {

    private var customNavigationDelegate: SSLNavigationDelegate?

    override func viewDidLoad() {
        super.viewDidLoad()
        customNavigationDelegate = SSLNavigationDelegate(originalDelegate: webView?.navigationDelegate)
        webView?.navigationDelegate = customNavigationDelegate
    }
}

class SSLNavigationDelegate: NSObject, WKNavigationDelegate {

    private weak var originalDelegate: WKNavigationDelegate?

    init(originalDelegate: WKNavigationDelegate?) {
        self.originalDelegate = originalDelegate
        super.init()
    }

    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                 completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let serverTrust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        originalDelegate?.webView?(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler) ?? decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        originalDelegate?.webView?(webView, didStartProvisionalNavigation: navigation)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        originalDelegate?.webView?(webView, didFinish: navigation)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        originalDelegate?.webView?(webView, didFail: navigation, withError: error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        originalDelegate?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
    }
}
