//
//  AppDelegate.swift
//  iOS-App-v2
//
//  Created by 内海徹生 on 2020/05/19.
//  Copyright © 2020 内海徹生. All rights reserved.
//

import UIKit
import SafariServices

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    
    var window: UIWindow?
    
    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        print("Universal Links!")
        if userActivity.activityType == NSUserActivityTypeBrowsingWeb {
            print(userActivity.webpageURL!)
            
            // ViewControllerの取得
            let vc:ViewController? = UIApplication.shared.keyWindow?.rootViewController as? ViewController
            
            if userActivity.webpageURL!.lastPathComponent == "complete" { // 決済実行
                // URLパラメタのパース
                var urlParams = Dictionary<String, String>.init()
                for param in userActivity.webpageURL!.query!.components(separatedBy: "&") {
                    let kv = param.components(separatedBy: "=")
                    urlParams[kv[0]] = kv[1].removingPercentEncoding
                }
                
                // ViewControllerにパラメタを設定
                vc?.webviewParams = (vc?.token)! + "&" + urlParams["compToken"]!
            } else if userActivity.webpageURL!.lastPathComponent == "cancel" { // キャンセル
                // 必要に応じて実装する.
            }

            // SFSafariViewConrollerの取得(表示されていた場合のみ)
            let sfsv = vc?.presentedViewController
            
            // SFSafariViewのclose (この後、ViewController#viewDidAppearに処理が移る)
            (sfsv as? SFSafariViewController)?.dismiss(animated: false, completion: nil)
        }
        return true
    }
    
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }
}
