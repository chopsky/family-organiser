import WidgetKit
import SwiftUI

@main
struct HousemaitWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        AskWidget()
        if #available(iOS 16.1, *) {
            NextUpLiveActivity()
        }
    }
}
