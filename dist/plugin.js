exports.version = 1.5
exports.apiRequired = 8.87
exports.repo = "Hug3O/Scroll-position-Remember"
exports.description = "Remember scroll position for every folder with swipe gesture and Backspace key navigation support."

exports.config = {
    expireMinutes: {
        label: "Expiration time (minutes)",
        type: "number",
        min: 0,
        max: 1440,
        default: 10,
        helper: "Records older than this will be removed. Set to 0 for no expiration."
    }
}

exports.frontend_js = "main.js"