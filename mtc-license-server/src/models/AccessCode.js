const { mongoose } = require('../db');

// One "code" is one license key you hand to a user. Everything about how that
// user's session will behave (how long it lasts, how many devices/times it can
// be redeemed, which tool features it unlocks) lives here, and you edit it
// from the admin panel - no code changes needed to grant or change access.
const accessCodeSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, index: true },
    note: { type: String, default: '' }, // e.g. "Ahmed - paid Nov" - for your own bookkeeping
    active: { type: Boolean, default: true },

    // How long a session created from this code stays valid, from the moment
    // it's redeemed (not from when the code was created).
    durationHours: { type: Number, default: 24 },

    // How many times this code can be redeemed into a (new) session in total.
    // Set to 0 for unlimited.
    maxUses: { type: Number, default: 1 },
    usesCount: { type: Number, default: 0 },

    // Which parts of the tool this code's sessions are allowed to use. The
    // userscript checks these flags after login and only arms the matching
    // features; add a key here and a matching check in the userscript to gate
    // any future feature the same way.
    permissions: {
        lines: { type: Boolean, default: true },
        pins: { type: Boolean, default: true },
        fpsControl: { type: Boolean, default: true },
        colors: { type: Boolean, default: true },
        macros: { type: Boolean, default: true },
        alerts: { type: Boolean, default: true },
        profiles: { type: Boolean, default: true },
        clipRecorder: { type: Boolean, default: true },
        packetRecorder: { type: Boolean, default: true },
    },

    createdAt: { type: Date, default: Date.now },
    createdBy: { type: String, default: 'admin' },
}, { versionKey: false });

module.exports = mongoose.model('AccessCode', accessCodeSchema);
