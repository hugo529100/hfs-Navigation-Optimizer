exports.version = 1.5
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
    minFilesThreshold: {
        label: "Minimum files threshold",
        type: "number",
        min: 0,
        max: 999,
        default: 25,
        helper: "Folders with fewer files than this will not save scroll position, so they always scroll to top. Set to 0 to always save."
    }
}

exports.frontend_js = "main.js"