exports.version = 1.0
exports.apiRequired = 8.87
exports.repo = "Hug3O/Scroll-position-Remember"
exports.description = "Remember scroll position for every folder."

exports.config = {
    expireMinutes: {
        label: "Expiration time (minutes)",
        type: "number",
        min: 0,
        max: 1440,
        default: 10,
        helper: "Records older than this will be removed. Set to 0 for no expiration."
    },
    maxRetries: {
        label: "Restore retry attempts",
        type: "number",
        min: 1,
        max: 20,
        default: 8,
        helper: "Number of attempts to restore scroll position after page load."
    },
    retryInterval: {
        label: "Retry interval (milliseconds)",
        type: "number",
        min: 50,
        max: 500,
        default: 100,
        helper: "Time between each retry attempt."
    }
}

exports.frontend_js = "main.js"