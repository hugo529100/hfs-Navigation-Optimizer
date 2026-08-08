exports.version = 1.0
exports.apiRequired = 8.87
exports.repo = "Hug3O/Navigation-Optimizer"
exports.description = "Navigation Optimizer: Scroll position memory + Gesture navigation for HFS"

exports.config = {
    enableScrollRemember: {
        label: "Enable Scroll Position Memory",
        type: "boolean",
        default: true,
        helper: "When disabled, all scroll position memory features will be turned off"
    },
    enableGestureNavigation: {
        label: "Enable Gesture Navigation",
        type: "boolean",
        default: true,
        helper: "When disabled, touch gestures and backspace navigation will be turned off"
    },
    scrollExpireMinutes: {
        label: "Scroll Memory Expiration (minutes)",
        type: "number",
        min: 0,
        max: 1440,
        default: 10,
        helper: "Records older than this will be removed. Set to 0 for no expiration."
    }
}

exports.frontend_js = "main.js"