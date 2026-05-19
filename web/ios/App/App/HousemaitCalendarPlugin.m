/*
 Capacitor plugin registration glue.

 Capacitor's iOS bridge looks for these CAP_PLUGIN macros at runtime
 to discover plugins written in Swift. The macros expand into Obj-C
 categories that the bridge can iterate via the Objective-C runtime —
 which Swift alone can't expose. Hence the .m file alongside the .swift.

 Plugin name on the JS side must match `Plugins.HousemaitCalendar`,
 which is the first argument to CAP_PLUGIN.
 */

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(HousemaitCalendarPlugin, "HousemaitCalendar",
    CAP_PLUGIN_METHOD(getAuthorizationStatus, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(requestAccess, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(listCalendars, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getEvents, CAPPluginReturnPromise);
)
