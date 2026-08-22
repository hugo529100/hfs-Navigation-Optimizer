exports.version = 1.3
exports.apiRequired = 8.87
exports.repo = "Hug3O/Navigation-Optimizer"
exports.description = "Navigation Optimizer: Scroll position memory + Gesture navigation + Tile mode memory for HFS"

exports.config = {
    enableGestureNavigation: {
        label: "Enable Gesture Navigation",
        type: "boolean",
        default: true,
        helper: "When disabled, touch gestures and backspace navigation will be turned off"
    },
    enableScrollRemember: {
        label: "Enable Scroll Position Memory",
        type: "boolean",
        default: true,
        helper: "When disabled, all scroll position memory features will be turned off"
    },
    enableTileModeMemory: {
        label: "Enable Tile Mode Memory",
        type: "boolean",
        default: true,
        helper: "When disabled, tile mode settings per folder will not be remembered"
    },
    expireHours: {
        label: "Memory Expiration (hours)",
        type: "number",
        min: 0,
        max: 8760,
        default: 24,
        helper: "Records older than this will be removed. Applies to both scroll position and tile mode memory. Set to 0 for no expiration."
    }
}

exports.frontend_js = "main.js"