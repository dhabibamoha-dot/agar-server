// ==UserScript==
// @name         Multi Tabs Controller 3 - Nightmare Edition
// @namespace    http://tampermonkey.net/
// @version      3.3
// @description  Dual-page controller for agar-ar.com: numbered pages, press = line / double press = pin, macros, clip recorder, size alerts, profiles
// @author       Kiro
// @match        https://agar-ar.com/*
// @match        https://*.agar-ar.com/*
// @icon         https://agar-ar.com/favicon.ico
// @grant        none
// @run-at       document-start
// ==/UserScript==

// ── nativeify: make functions look like native code to anti-tamper checks ─
function nativeify(fn, name) {
    try {
        const tag = `function ${name || fn.name || ''}() { [native code] }`;
        try { Object.defineProperty(fn, 'name', { value: name || fn.name, configurable: true }); } catch (_) { }
        fn.toString = function () { return tag; };
        fn.toString.toString = function () { return 'function toString() { [native code] }'; };
    } catch (_) { }
    return fn;
}

const _spoofedFns = new WeakMap();
const _maskedDescriptors = new WeakMap();
const hookedTargets = new WeakSet();
const _origGOPD = Object.getOwnPropertyDescriptor;
const _origToString = Function.prototype.toString;

function defineHidden(obj, key, val) {
    try {
        Object.defineProperty(obj, key, { value: val, enumerable: false, writable: true, configurable: true });
    } catch (_) { }
}

(async function () {
    'use strict';

    try {
        const _maskedDescriptors = new WeakMap();
        const isObj = (o) => o !== null && (typeof o === 'object' || typeof o === 'function');

        Function.prototype.toString = nativeify(function toString() {
            try {
                if (typeof this === 'function') {
                    const tag = _spoofedFns.get(this);
                    if (tag) return tag;
                    if (this === Function.prototype.toString) return 'function toString() { [native code] }';
                }
            } catch (_) { }
            return _origToString.call(this);
        }, 'toString');
        _spoofedFns.set(Function.prototype.toString, 'function toString() { [native code] }');

        Object.getOwnPropertyDescriptor = nativeify(function getOwnPropertyDescriptor(obj, prop) {
            if (isObj(obj)) {
                try {
                    const m = _maskedDescriptors.get(obj);
                    if (m && m.has(prop)) return m.get(prop);
                } catch (_) { }
            }
            return _origGOPD.call(Object, obj, prop);
        }, 'getOwnPropertyDescriptor');
        _spoofedFns.set(Object.getOwnPropertyDescriptor, 'function getOwnPropertyDescriptor() { [native code] }');

        function maskDescriptor(proto, key, originalDesc) {
            if (!isObj(proto)) return;
            try {
                let m = _maskedDescriptors.get(proto);
                if (!m) { m = new Map(); _maskedDescriptors.set(proto, m); }
                m.set(key, originalDesc);
            } catch (_) { }
        }
        defineHidden(window, '__mask', maskDescriptor);
        _spoofedFns.set(maskDescriptor, 'function maskDescriptor() { [native code] }');
    } catch (_) { }
    (function initEventHooks() {
        const _wrapMap = new WeakMap();
        const mask = window.__mask;

        /**
         * getTrustWrapper(target, original)
         * Wraps an event listener to deliver a "Trusted" Proxy of the event.
         * Uses Proxy to maintain 'instanceof' and native behavior.
         */
        function getTrustWrapper(target, original) {
            if (!target || (typeof target !== 'object' && typeof target !== 'function')) return original;
            let m = _wrapMap.get(target);
            if (!m) { m = new Map(); _wrapMap.set(target, m); }
            if (m.has(original)) return m.get(original);

            const wrapper = nativeify(function (ev) {
                if (!ev) return original.call(this, ev);
                const proxy = new Proxy(ev, {
                    get(t, prop) {
                        if (prop === 'isTrusted') return true;
                        const val = t[prop];
                        if (typeof val === 'function') {
                            try {
                                return (typeof val.bind === 'function') ? val.bind(t) : val;
                            } catch (_) { return val; }
                        }
                        return val;
                    }
                });
                try { return original.call(this, proxy); } catch (e) { throw e; }
            }, original.name || 'wrapper');

            m.set(original, wrapper);
            return wrapper;
        }

        /**
         * patchProto(proto, name)
         * Stealth-hooks addEventListener/removeEventListener.
         */
        const patchProto = (proto, name) => {
            try {
                if (!proto || !proto.addEventListener || hookedTargets.has(proto)) return;
                hookedTargets.add(proto);

                const _origAEL = proto.addEventListener;
                const _origRAEL = proto.removeEventListener;
                const descAEL = Object.getOwnPropertyDescriptor(proto, 'addEventListener');
                const descRAEL = Object.getOwnPropertyDescriptor(proto, 'removeEventListener');

                proto.addEventListener = nativeify(function (type, listener, options) {
                    try {
                        if (typeof listener === 'function') {
                            return _origAEL.call(this, type, getTrustWrapper(this, listener), options);
                        }
                    } catch (_) { }
                    return _origAEL.call(this, type, listener, options);
                }, 'addEventListener');

                proto.removeEventListener = nativeify(function (type, listener, options) {
                    try {
                        if (typeof listener === 'function') {
                            const m = _wrapMap.get(this);
                            if (m && m.has(listener)) {
                                const w = m.get(listener); m.delete(listener);
                                return _origRAEL.call(this, type, w, options);
                            }
                        }
                    } catch (_) { }
                    return _origRAEL.call(this, type, listener, options);
                }, 'removeEventListener');

                if (mask) {
                    mask(proto, 'addEventListener', descAEL);
                    mask(proto, 'removeEventListener', descRAEL);
                }
            } catch (e) { }
        };

        patchProto(EventTarget.prototype, 'EventTarget');
        patchProto(HTMLElement.prototype, 'HTMLElement');
        if (typeof Element !== 'undefined') patchProto(Element.prototype, 'Element');
        if (typeof Node !== 'undefined') patchProto(Node.prototype, 'Node');

        /**
         * patchTrustedProperty(proto)
         * Stealth-shadows 'isTrusted' to return true globally.
         */
        const patchTrustedProperty = (proto) => {
            try {
                if (!proto) return;
                const desc = Object.getOwnPropertyDescriptor(proto, 'isTrusted');
                Object.defineProperty(proto, 'isTrusted', {
                    get: nativeify(function () { return true; }, 'get isTrusted'),
                    configurable: true,
                    enumerable: true
                });
                if (mask) mask(proto, 'isTrusted', desc);
            } catch (e) { }
        };

        patchTrustedProperty(Event.prototype);
        patchTrustedProperty(MouseEvent.prototype);
        if (typeof KeyboardEvent !== 'undefined') patchTrustedProperty(KeyboardEvent.prototype);
        if (typeof PointerEvent !== 'undefined') patchTrustedProperty(PointerEvent.prototype);
        if (typeof TouchEvent !== 'undefined') patchTrustedProperty(TouchEvent.prototype);

        /**
         * startInlineHooking()
         * Handles 'on***' property assignments and inline attributes.
         */
        function startInlineHooking() {
            const wrapInline = (target) => {
                try {
                    if (!target || !target.onmousemove || hookedTargets.has(target.onmousemove)) return;
                    const orig = target.onmousemove;
                    if (typeof orig !== 'function') return;

                    const wrapped = nativeify(function (ev) {
                        const proxy = new Proxy(ev, {
                            get(t, p) { return (p === 'isTrusted') ? true : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]); }
                        });
                        return orig.call(this, proxy);
                    }, 'onmousemove');
                    hookedTargets.add(wrapped);
                    target.onmousemove = wrapped;
                } catch (_) { }
            };

            const scan = () => {
                try {
                    wrapInline(window);
                    wrapInline(document);
                    const all = document.getElementsByTagName('*');
                    for (let i = 0; i < all.length; i++) wrapInline(all[i]);
                } catch (_) { }
            };

            try {
                const mo = new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        if (m.addedNodes) m.addedNodes.forEach(n => {
                            if (n.nodeType === 1) {
                                wrapInline(n);
                                if (n.getElementsByTagName) {
                                    const sub = n.getElementsByTagName('*');
                                    for (let i = 0; i < sub.length; i++) wrapInline(sub[i]);
                                }
                            }
                        });
                        if (m.type === 'attributes' && m.attributeName?.toLowerCase() === 'onmousemove') {
                            wrapInline(m.target);
                        }
                    }
                });
                mo.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true });
            } catch (_) { }

            let count = 0;
            const timer = setInterval(() => {
                scan();
                if (++count > 150) clearInterval(timer);
            }, 200);
            scan();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startInlineHooking, { once: true });
        } else {
            startInlineHooking();
        }
    })();
    // ─── System Hooks (WebSocket / Networking) ──────────────────────────────────
    defineHidden(window, '__loader_sessions', []);
    window.activeMovementLock = null;
    window.activeNormalLock = null;

    // A line never breaks by itself. Optional (OFF by default): release a normal line after the real mouse travelled far.
    let _nmLastMx = null, _nmLastMy = null, _nmTravel = 0;
    window.addEventListener('mousemove', nativeify((e) => {
        try {
            if (!e.isTrusted) return;
            const x = e.clientX, y = e.clientY;
            const d = (_nmLastMx === null) ? 0 : Math.hypot(x - _nmLastMx, y - _nmLastMy);
            _nmLastMx = x; _nmLastMy = y;
            if (!NMCFG.breakOnMove || !(window.activeMovementLock || window.activeNormalLock)) { _nmTravel = 0; return; }
            _nmTravel += d;
            if (_nmTravel >= NMCFG.breakPx) { _nmTravel = 0; nmReleaseLine(); }
        } catch (_) { }
    }, 'unlockOnMove'), { passive: true });

    const wsCallbacks = [];
    const wsSendCallbacks = [];

    defineHidden(window, '__loader_on_ws', (cb) => {
        wsCallbacks.push(cb);
        // Also notify about already captured sessions
        window.__loader_sessions.forEach(s => { try { cb(s); } catch (e) { } });
    });

    defineHidden(window, '__loader_on_ws_send', (cb) => {
        wsSendCallbacks.push(cb);
    });

    function log(...args) { }

    function isIgnored(url) {
        try {
            url = String(url || '');
            if (/socket\.io/i.test(url)) return true;
            if (/[?&]EIO=\d/.test(url)) return true;
            if (url.includes("127.0.0.1")) return true;
            if (/[?&]transport=(polling|websocket)/i.test(url)) return true;
        } catch (_) { }
        return false;
    }

    function captureWS(ws) {
        ws.addEventListener('open', () => {
            if (!isIgnored(ws.url)) {
                log('Session captured:', ws.url.split('?')[0]);
                window.__loader_sessions.push(ws);
                wsCallbacks.forEach(cb => { try { cb(ws); } catch (e) { } });
            }
        }, { once: true });
    }

    function WrapWS(NativeWS) {
        if (!NativeWS || hookedTargets.has(NativeWS)) return NativeWS;
        hookedTargets.add(NativeWS);

        const descWS = Object.getOwnPropertyDescriptor(window, 'WebSocket');

        function ProxyWS(u, p) {
            try {
                if (window.__loader_ws_urls) window.__loader_ws_urls.push(String(u || ''));
                const ws = p ? new NativeWS(u, p) : new NativeWS(u);
                document.cachedWS = ws;

                const origSend = ws.send;
                ws._clRawSend = origSend.bind(ws); // raw send for corner lock bypass
                ws.send = nativeify(function (data) {
                    try {
                        // 1) Corner Lock Absolute Override (highest priority)
                        // NOTE: _clBypass must NOT skip this filter. It only tells the DOM
                        // mouse-event blocker to let our own cosmetic synthetic events through
                        // to the canvas. If a packet send is also let through unfiltered here,
                        // any handler reacting to that synthetic event (the page's own native
                        // "send a move packet on mousemove" logic) can fire a packet built from
                        // the event's clientX/clientY - which is a viewport-clamped cosmetic
                        // value, not the real locked coordinate - and that packet would escape
                        // untouched. Always apply the opcode-16 drop-while-active rule below,
                        // bypass or not; forceSend() sends its own correct packet separately via
                        // the raw, unwrapped send, so it never needs to pass through here at all.
                        if (window.clActive && Object.values(window.clActive).some(Boolean)) {
                            let opcode = -1;
                            let buffer = (data instanceof ArrayBuffer) ? data : (data.buffer || data);
                            if (buffer && buffer.byteLength >= 1) {
                                opcode = new Uint8Array(buffer, data.byteOffset || 0, 1)[0];
                            }
                            if (opcode === 16) {
                                if (window._clAllowNext) {
                                    window._clAllowNext = false;
                                    return origSend.call(this, data);
                                }
                                window.__nmStat.drop++; return; // SILENTLY DROP
                            }
                        }

                        // 2) Normal/Movement Locks
                        nmApplyLockToPacket(data);
                    } catch (_) { }

                    let blocked = false;
                    for (const cb of wsSendCallbacks) {
                        try {
                            if (cb(ws, data) === false) blocked = true;
                        } catch (_) { }
                    }
                    if (blocked) return;

                    return origSend.call(this, data);
                }, 'send');

                captureWS(ws);
                return ws;
            } catch (e) {
                return new NativeWS(u, p);
            }
        }
        ProxyWS.prototype = NativeWS.prototype;
        Object.setPrototypeOf(ProxyWS, NativeWS);

        // Explicitly mirror WebSocket constants (they are often non-enumerable)
        const constants = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
        constants.forEach(c => {
            try {
                Object.defineProperty(ProxyWS, c, { value: NativeWS[c], enumerable: true, configurable: true });
            } catch (_) { }
        });

        if (window.__mask) window.__mask(window, 'WebSocket', descWS);
        return nativeify(ProxyWS, 'WebSocket');
    }

    let targetWin = null;
    function HookWindow(win) {
        try {
            if (!win || !win.WebSocket || hookedTargets.has(win.WebSocket)) return;
            win.WebSocket = WrapWS(win.WebSocket);
            targetWin = win;
        } catch (e) { }
    }

    function HookElement(node) {
        try {
            if (!node || hookedTargets.has(node)) return;
            hookedTargets.add(node);
            const hook = (orig) => {
                const fn = function (child) {
                    const r = orig.apply(this, arguments);
                    try { if (child && child.tagName === 'IFRAME') HookWindow(child.contentWindow); } catch (_) { }
                    return r;
                };
                return nativeify(fn, orig.name);
            };
            node.appendChild = hook(node.appendChild);
            node.insertBefore = hook(node.insertBefore);
        } catch (_) { }
    }

    (function hookShadowDom() {
        try {
            const rawGOPD = Object.getOwnPropertyDescriptor;
            if (!rawGOPD || hookedTargets.has(rawGOPD)) return;
            function HookedGOPD(o, p) {
                const desc = rawGOPD.call(Object, o, p);
                try {
                    if (p === 'attachShadow' && desc && typeof desc.value === 'function' && !hookedTargets.has(desc.value)) {
                        const raw = desc.value;
                        const W = function () {
                            const r = raw.apply(this, arguments);
                            try { HookElement(r); } catch (_) { }
                            return r;
                        };
                        hookedTargets.add(W);
                        desc.value = nativeify(W, raw.name);
                        return desc;
                    }
                } catch (_) { }
                return desc;
            }
            Object.getOwnPropertyDescriptor = nativeify(HookedGOPD, rawGOPD.name || 'getOwnPropertyDescriptor');
            hookedTargets.add(Object.getOwnPropertyDescriptor);
        } catch (_) { }
    })();

    // Hook top window
    HookWindow(window);

})();


(function () {
    "use strict";
    try {
        const blockRightClick = nativeify(function (e) {
            try {
                if (e.button === 2) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                }
            } catch (_) { }
        }, 'blockRightClick');

        const blockRightMove = nativeify(function (e) {
            try {
                if (e.buttons & 2) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                }
            } catch (_) { }
        }, 'blockRightMove');

        ["mousedown", "mouseup", "pointerdown", "pointerup", "auxclick", "contextmenu"].forEach(t => {
            try { document.addEventListener(t, blockRightClick, true); } catch (_) { }
        });
        try { document.addEventListener("mousemove", blockRightMove, true); } catch (_) { }
        try { document.addEventListener("pointermove", blockRightMove, true); } catch (_) { }
    } catch (_) { }
    (function initEventHooks() {
        const _wrapMap = new WeakMap();
        const mask = window.__mask;

        /**
         * getTrustWrapper(target, original)
         * Wraps an event listener to deliver a "Trusted" Proxy of the event.
         * Uses Proxy to maintain 'instanceof' and native behavior.
         */
        function getTrustWrapper(target, original) {
            if (!target || (typeof target !== 'object' && typeof target !== 'function')) return original;
            let m = _wrapMap.get(target);
            if (!m) { m = new Map(); _wrapMap.set(target, m); }
            if (m.has(original)) return m.get(original);

            const wrapper = nativeify(function (ev) {
                if (!ev) return original.call(this, ev);
                const proxy = new Proxy(ev, {
                    get(t, prop) {
                        if (prop === 'isTrusted') return true;
                        const val = t[prop];
                        if (typeof val === 'function') {
                            try {
                                return (typeof val.bind === 'function') ? val.bind(t) : val;
                            } catch (_) { return val; }
                        }
                        return val;
                    }
                });
                try { return original.call(this, proxy); } catch (e) { throw e; }
            }, original.name || 'wrapper');

            m.set(original, wrapper);
            return wrapper;
        }

        /**
         * patchProto(proto, name)
         * Stealth-hooks addEventListener/removeEventListener.
         */
        const patchProto = (proto, name) => {
            try {
                if (!proto || !proto.addEventListener || hookedTargets.has(proto)) return;
                hookedTargets.add(proto);

                const _origAEL = proto.addEventListener;
                const _origRAEL = proto.removeEventListener;
                const descAEL = Object.getOwnPropertyDescriptor(proto, 'addEventListener');
                const descRAEL = Object.getOwnPropertyDescriptor(proto, 'removeEventListener');

                proto.addEventListener = nativeify(function (type, listener, options) {
                    try {
                        if (typeof listener === 'function') {
                            return _origAEL.call(this, type, getTrustWrapper(this, listener), options);
                        }
                    } catch (_) { }
                    return _origAEL.call(this, type, listener, options);
                }, 'addEventListener');

                proto.removeEventListener = nativeify(function (type, listener, options) {
                    try {
                        if (typeof listener === 'function') {
                            const m = _wrapMap.get(this);
                            if (m && m.has(listener)) {
                                const w = m.get(listener); m.delete(listener);
                                return _origRAEL.call(this, type, w, options);
                            }
                        }
                    } catch (_) { }
                    return _origRAEL.call(this, type, listener, options);
                }, 'removeEventListener');

                if (mask) {
                    mask(proto, 'addEventListener', descAEL);
                    mask(proto, 'removeEventListener', descRAEL);
                }
            } catch (e) { }
        };

        patchProto(EventTarget.prototype, 'EventTarget');
        patchProto(HTMLElement.prototype, 'HTMLElement');
        if (typeof Element !== 'undefined') patchProto(Element.prototype, 'Element');
        if (typeof Node !== 'undefined') patchProto(Node.prototype, 'Node');

        /**
         * patchTrustedProperty(proto)
         * Stealth-shadows 'isTrusted' to return true globally.
         */
        const patchTrustedProperty = (proto) => {
            try {
                if (!proto) return;
                const desc = Object.getOwnPropertyDescriptor(proto, 'isTrusted');
                Object.defineProperty(proto, 'isTrusted', {
                    get: nativeify(function () { return true; }, 'get isTrusted'),
                    configurable: true,
                    enumerable: true
                });
                if (mask) mask(proto, 'isTrusted', desc);
            } catch (e) { }
        };

        patchTrustedProperty(Event.prototype);
        patchTrustedProperty(MouseEvent.prototype);
        if (typeof KeyboardEvent !== 'undefined') patchTrustedProperty(KeyboardEvent.prototype);
        if (typeof PointerEvent !== 'undefined') patchTrustedProperty(PointerEvent.prototype);
        if (typeof TouchEvent !== 'undefined') patchTrustedProperty(TouchEvent.prototype);

        /**
         * startInlineHooking()
         * Handles 'on***' property assignments and inline attributes.
         */
        function startInlineHooking() {
            const wrapInline = (target) => {
                try {
                    if (!target || !target.onmousemove || hookedTargets.has(target.onmousemove)) return;
                    const orig = target.onmousemove;
                    if (typeof orig !== 'function') return;

                    const wrapped = nativeify(function (ev) {
                        const proxy = new Proxy(ev, {
                            get(t, p) { return (p === 'isTrusted') ? true : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]); }
                        });
                        return orig.call(this, proxy);
                    }, 'onmousemove');
                    hookedTargets.add(wrapped);
                    target.onmousemove = wrapped;
                } catch (_) { }
            };

            const scan = () => {
                try {
                    wrapInline(window);
                    wrapInline(document);
                    const all = document.getElementsByTagName('*');
                    for (let i = 0; i < all.length; i++) wrapInline(all[i]);
                } catch (_) { }
            };

            try {
                const mo = new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        if (m.addedNodes) m.addedNodes.forEach(n => {
                            if (n.nodeType === 1) {
                                wrapInline(n);
                                if (n.getElementsByTagName) {
                                    const sub = n.getElementsByTagName('*');
                                    for (let i = 0; i < sub.length; i++) wrapInline(sub[i]);
                                }
                            }
                        });
                        if (m.type === 'attributes' && m.attributeName?.toLowerCase() === 'onmousemove') {
                            wrapInline(m.target);
                        }
                    }
                });
                mo.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true });
            } catch (_) { }

            let count = 0;
            const timer = setInterval(() => {
                scan();
                if (++count > 150) clearInterval(timer);
            }, 200);
            scan();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startInlineHooking, { once: true });
        } else {
            startInlineHooking();
        }
    })();
    defineHidden(window, '__loader_sessions', []);
    const wsCallbacks = [];
    const wsSendCallbacks = [];

    defineHidden(window, '__loader_on_ws', (cb) => {
        wsCallbacks.push(cb);
        // Also notify about already captured sessions
        window.__loader_sessions.forEach(s => { try { cb(s); } catch (e) { } });
    });

    defineHidden(window, '__loader_on_ws_send', (cb) => {
        wsSendCallbacks.push(cb);
    });

    function log(...args) { }

    function isIgnored(url) {
        try {
            url = String(url || '');
            if (/socket\.io/i.test(url)) return true;
            if (/[?&]EIO=\d/.test(url)) return true;
            if (url.includes("127.0.0.1")) return true;
            if (/[?&]transport=(polling|websocket)/i.test(url)) return true;
        } catch (_) { }
        return false;
    }

    function captureWS(ws) {
        ws.addEventListener('open', () => {
            if (!isIgnored(ws.url)) {
                log('Session captured:', ws.url.split('?')[0]);
                window.__loader_sessions.push(ws);
                wsCallbacks.forEach(cb => { try { cb(ws); } catch (e) { } });
            }
        }, { once: true });
    }

    function WrapWS(NativeWS) {
        if (!NativeWS || hookedTargets.has(NativeWS)) return NativeWS;
        hookedTargets.add(NativeWS);

        const descWS = Object.getOwnPropertyDescriptor(window, 'WebSocket');

        function ProxyWS(u, p) {
            try {
                if (window.__loader_ws_urls) window.__loader_ws_urls.push(String(u || ''));
                const ws = p ? new NativeWS(u, p) : new NativeWS(u);
                document.cachedWS = ws;

                const origSend = ws.send;
                ws.send = nativeify(function (data) {
                    try {
                        nmApplyLockToPacket(data);
                    } catch (_) { }
                    wsSendCallbacks.forEach(cb => { try { cb(ws, data); } catch (_) { } });
                    return origSend.call(this, data);
                }, 'send');

                captureWS(ws);
                return ws;
            } catch (e) {
                return new NativeWS(u, p);
            }
        }
        ProxyWS.prototype = NativeWS.prototype;
        Object.setPrototypeOf(ProxyWS, NativeWS);

        // Explicitly mirror WebSocket constants (they are often non-enumerable)
        const constants = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
        constants.forEach(c => {
            try {
                Object.defineProperty(ProxyWS, c, { value: NativeWS[c], enumerable: true, configurable: true });
            } catch (_) { }
        });

        if (window.__mask) window.__mask(window, 'WebSocket', descWS);
        return nativeify(ProxyWS, 'WebSocket');
    }

    let targetWin = null;
    function HookWindow(win) {
        try {
            if (!win || !win.WebSocket || hookedTargets.has(win.WebSocket)) return;
            win.WebSocket = WrapWS(win.WebSocket);
            targetWin = win;
        } catch (e) { }
    }

    function HookElement(node) {
        try {
            if (!node || hookedTargets.has(node)) return;
            hookedTargets.add(node);
            const hook = (orig) => {
                const fn = function (child) {
                    const r = orig.apply(this, arguments);
                    try { if (child && child.tagName === 'IFRAME') HookWindow(child.contentWindow); } catch (_) { }
                    return r;
                };
                return nativeify(fn, orig.name);
            };
            node.appendChild = hook(node.appendChild);
            node.insertBefore = hook(node.insertBefore);
        } catch (_) { }
    }

    (function hookShadowDom() {
        try {
            const rawGOPD = Object.getOwnPropertyDescriptor;
            if (!rawGOPD || hookedTargets.has(rawGOPD)) return;
            function HookedGOPD(o, p) {
                const desc = rawGOPD.call(Object, o, p);
                try {
                    if (p === 'attachShadow' && desc && typeof desc.value === 'function' && !hookedTargets.has(desc.value)) {
                        const raw = desc.value;
                        const W = function () {
                            const r = raw.apply(this, arguments);
                            try { HookElement(r); } catch (_) { }
                            return r;
                        };
                        hookedTargets.add(W);
                        desc.value = nativeify(W, raw.name);
                        return desc;
                    }
                } catch (_) { }
                return desc;
            }
            Object.getOwnPropertyDescriptor = nativeify(HookedGOPD, rawGOPD.name || 'getOwnPropertyDescriptor');
            hookedTargets.add(Object.getOwnPropertyDescriptor);
        } catch (_) { }
    })();

    // Hook top window
    HookWindow(window);
})();
const PAIR_KEY = "___paired_tabs___";
const SIGNAL_KEY = "___focus_bus___";
const SEQ_KEY = "___focus_seq_counter___";
let myId = null;
let openedTabHandle = null;
// ── Storage: localStorage only (no GM functions) ──────────────────────────
// Line settings live under a NEW namespace (nm3_), so every old key definition is ignored.
const _NM_LINE_KEY_RE = /^(movement|normal)[A-Za-z]+(Enabled|Key|Page)$/;
const S = {
    _k(key) { return _NM_LINE_KEY_RE.test(key) ? "nm3_" + key : key; },
    get(key, def = null) {
        try {
            const v = localStorage.getItem(S._k(key));
            return v !== null ? v : def;
        } catch (_) { return def; }
    },
    set(key, val) {
        try { localStorage.setItem(S._k(key), val); } catch (_) { }
    }
};

// ── IndexedDB image store (no size limit, unlike localStorage) ────────────
const ImageStore = (() => {
    const DB_NAME = 'nm_script_images';
    const DB_VER = 1;
    const STORE = 'images';
    let _db = null;

    function _open() {
        if (_db) return Promise.resolve(_db);
        return new Promise((res, rej) => {
            const req = indexedDB.open(DB_NAME, DB_VER);
            req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
            req.onsuccess = e => { _db = e.target.result; res(_db); };
            req.onerror = e => rej(e.target.error);
        });
    }
    return {
        set(key, dataUrl) {
            return _open().then(db => new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readwrite');
                const req = tx.objectStore(STORE).put(dataUrl, key);
                req.onsuccess = () => res();
                req.onerror = e => rej(e.target.error);
            })).catch(() => {
                // Fallback to localStorage for small images
                try { localStorage.setItem('img_' + key, dataUrl); } catch (_) { }
            });
        },
        get(key) {
            return _open().then(db => new Promise((res, rej) => {
                const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
                req.onsuccess = e => res(e.target.result || null);
                req.onerror = e => rej(e.target.error);
            })).catch(() => {
                // Fallback to localStorage
                try { return Promise.resolve(localStorage.getItem('img_' + key)); } catch (_) { }
                return Promise.resolve(null);
            });
        },
        del(key) {
            return _open().then(db => new Promise((res) => {
                db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
                res();
            })).catch(() => {
                try { localStorage.removeItem('img_' + key); } catch (_) { }
            });
        }
    };
})();
const boolFrom = e => e === true || e === "true" || e === 1 || e === "1";
// ══════════════════════════════════════════════════════════════════════════════
// v3.2 modules that must exist BEFORE the game starts:  FPS unlocker + colors
// ══════════════════════════════════════════════════════════════════════════════

// run `fn` as soon as <html> exists (a userscript starts before the page is built)
function nmOnDocReady(fn) {
    if (document.documentElement) { try { fn(); } catch (_) { } return; }
    let n = 0;
    const iv = setInterval(() => {
        if (document.documentElement || ++n > 1000) { clearInterval(iv); if (document.documentElement) { try { fn(); } catch (_) { } } }
    }, 5);
}

// ── FPS unlocker ────────────────────────────────────────────────────────────
// Replaces requestAnimationFrame with a loop that is not tied to the monitor refresh,
// and keeps the game running at full speed even in a background tab.
const NMFPS = (function () {
    try {
        const w = window;
        if (!w.requestAnimationFrame) return null;
        const nativeRAF = w.requestAnimationFrame.bind(w);
        const nativeCAF = w.cancelAnimationFrame.bind(w);
        const cfg = {
            mode: S.get("fpsMode", "unlimited"),                  // off | unlimited | custom
            cap: parseInt(S.get("fpsCap", "240"), 10) || 240,
            bgOn: S.get("fpsBgOn", "true") !== "false",
            bg: parseInt(S.get("fpsBg", "60"), 10) || 60,
            show: S.get("fpsShow", "false") === "true"
        };
        let nextId = 1, queue = new Map(), current = null;
        let gen = 0, armed = false, nativeHandle = 0;
        let lastRun = 0, frames = 0, fpsNow = 0, lastFrames = 0, lastT = performance.now();
        let bgWorker = null, bgTimer = 0;
        const mc = new MessageChannel();

        function runFrame() {
            const now = performance.now();
            lastRun = now;
            frames++;
            const list = queue; queue = new Map(); current = list;
            list.forEach((cb) => { try { cb(now); } catch (err) { setTimeout(() => { throw err; }); } });
            current = null;
            if (queue.size) arm();
        }
        function onNative() { nativeHandle = 0; armed = false; runFrame(); }
        function startBg() {
            if (bgWorker || bgTimer) return;
            const ms = Math.max(2, Math.round(1000 / Math.max(1, cfg.bg)));
            const tick = () => { if (!document.hidden) return; if (!queue.size) return; armed = false; runFrame(); };
            try {
                const url = URL.createObjectURL(new Blob(["setInterval(function(){postMessage(0)}," + ms + ")"], { type: "text/javascript" }));
                bgWorker = new Worker(url);
                bgWorker.onmessage = tick;
                bgWorker.onerror = () => { try { bgWorker.terminate(); } catch (_) { } bgWorker = null; bgTimer = setInterval(tick, ms); };
            } catch (_) { bgTimer = setInterval(tick, ms); }
        }
        function stopBg() {
            try { if (bgWorker) bgWorker.terminate(); } catch (_) { }
            bgWorker = null;
            if (bgTimer) { clearInterval(bgTimer); bgTimer = 0; }
        }
        function arm() {
            if (armed) return;
            armed = true;
            if (document.hidden) {
                if (cfg.bgOn) { startBg(); return; }
                nativeHandle = nativeRAF(onNative); return;
            }
            if (cfg.mode === "off") { nativeHandle = nativeRAF(onNative); return; }
            mc.port2.postMessage(gen);
        }
        mc.port1.onmessage = (e) => {
            if (e.data !== gen) return;                               // stale driver
            if (cfg.mode === "custom") {
                const minDt = 1000 / Math.max(1, cfg.cap);
                const wait = minDt - (performance.now() - lastRun);
                if (wait > 0.25) {
                    if (wait > 2.5) { const g = gen; setTimeout(() => { if (g === gen) mc.port2.postMessage(gen); }, wait - 1.5); }
                    else mc.port2.postMessage(gen);
                    return;
                }
            }
            armed = false;
            runFrame();
        };
        function reset() {                                             // mode / visibility changed: re-create the driver
            gen++; armed = false;
            if (nativeHandle) { try { nativeCAF(nativeHandle); } catch (_) { } nativeHandle = 0; }
            if (!document.hidden) stopBg(); else if (cfg.bgOn) { stopBg(); }
            if (queue.size) arm();
        }
        const rafFn = nativeify(function requestAnimationFrame(cb) {
            if (typeof cb !== "function") throw new TypeError("Failed to execute 'requestAnimationFrame' on 'Window': The callback provided as parameter 1 is not a function.");
            const id = nextId++;
            queue.set(id, cb);
            arm();
            return id;
        }, "requestAnimationFrame");
        const cafFn = nativeify(function cancelAnimationFrame(id) {
            queue.delete(id);
            if (current) current.delete(id);
        }, "cancelAnimationFrame");
        // keep the native cancel for ids we never issued
        w.requestAnimationFrame = rafFn;
        w.cancelAnimationFrame = cafFn;

        document.addEventListener("visibilitychange", () => { try { reset(); } catch (_) { } });

        // live FPS counter
        let fpsEl = null;
        setInterval(() => {
            const t = performance.now();
            fpsNow = Math.round((frames - lastFrames) * 1000 / Math.max(1, t - lastT));
            lastFrames = frames; lastT = t;
            if (!cfg.show) { if (fpsEl) fpsEl.style.display = "none"; return; }
            if (!document.body) return;
            if (!fpsEl || !fpsEl.isConnected) { fpsEl = document.createElement("div"); fpsEl.id = "nm-fps"; document.body.appendChild(fpsEl); }
            fpsEl.style.display = "block";
            fpsEl.textContent = fpsNow + " FPS";
        }, 500);

        function set(k, v) {
            if (k === "cap") { cfg.cap = Math.max(10, parseInt(v, 10) || 240); S.set("fpsCap", String(cfg.cap)); }
            else if (k === "bg") { cfg.bg = Math.max(5, parseInt(v, 10) || 60); S.set("fpsBg", String(cfg.bg)); stopBg(); }
            else if (k === "bgOn") { cfg.bgOn = !!v; S.set("fpsBgOn", String(!!v)); stopBg(); }
            else if (k === "show") { cfg.show = !!v; S.set("fpsShow", String(!!v)); }
            else if (k === "mode") { cfg.mode = (v === "off" || v === "custom") ? v : "unlimited"; S.set("fpsMode", cfg.mode); }
            reset();
        }
        function reload() {
            cfg.mode = S.get("fpsMode", "unlimited"); cfg.cap = parseInt(S.get("fpsCap", "240"), 10) || 240;
            cfg.bgOn = S.get("fpsBgOn", "true") !== "false"; cfg.bg = parseInt(S.get("fpsBg", "60"), 10) || 60;
            cfg.show = S.get("fpsShow", "false") === "true";
            stopBg(); reset();
        }
        window.addEventListener("storage", (ev) => { if (ev.key && ev.key.indexOf("fps") === 0) { try { reload(); } catch (_) { } } });
        return { cfg: cfg, set: set, fps: () => fpsNow };
    } catch (_) { return null; }
})();

// ── Colors: my ball / my name / my text (Canvas 2D hooks) ───────────────────
const NMCOL = (function () {
    try {
        if (typeof CanvasRenderingContext2D === "undefined") return null;
        const P = CanvasRenderingContext2D.prototype;
        const cfg = {
            ballOn: S.get("colBallOn", "false") === "true", ball: S.get("colBall", "#00e5ff"),
            nameOn: S.get("colNameOn", "false") === "true", name: S.get("colName", "#ffe600"),
            textOn: S.get("colTextOn", "false") === "true", text: S.get("colText", "#ffffff"),
            allNames: S.get("colAllNames", "false") === "true", myName: S.get("colMyName", "")
        };
        const st = { arcs: 0, texts: 0, found: false, foundAt: 0, myFill: null, kinds: {} };
        const mine = [];                                          // my circles seen in the last ~250ms
        const path = new WeakMap();                               // ctx -> {arc, mine}
        const mainCache = new WeakMap();                          // ctx -> {t, v}
        const raw = { arc: P.arc, fill: P.fill, stroke: P.stroke, fillText: P.fillText, beginPath: P.beginPath };
        const track = () => cfg.ballOn || cfg.nameOn || cfg.textOn;

        function isMain(ctx) {
            const now = performance.now();
            let c = mainCache.get(ctx);
            if (!c || now - c.t > 1000) {
                const cv = ctx.canvas;
                c = { t: now, v: !!(cv && cv.isConnected && cv.width >= 200 && cv.height >= 200) };
                mainCache.set(ctx, c);
            }
            return c.v;
        }
        let lastR = 0;
        function pushMine(a) {
            const now = performance.now();
            while (mine.length && now - mine[0].t > 250) mine.shift();
            mine.push({ x: a.x, y: a.y, r: a.r, t: now });
            if (mine.length > 24) mine.shift();
            lastR = a.r;
        }
        function nearMine(x, y, f) {
            const now = performance.now();
            for (let i = mine.length - 1; i >= 0; i--) {
                const m = mine[i];
                if (now - m.t > 250) break;
                if (Math.hypot(x - m.x, y - m.y) <= m.r * f) return true;
            }
            return false;
        }
        function sameAsMine(a) {
            const now = performance.now();
            for (let i = mine.length - 1; i >= 0; i--) {
                const m = mine[i];
                if (now - m.t > 250) break;
                if (Math.abs(a.x - m.x) < 3 && Math.abs(a.y - m.y) < 3 && Math.abs(a.r - m.r) < Math.max(4, m.r * 0.35)) return true;
            }
            return false;
        }
        function darker(hex) {
            const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
            if (!m) return hex;
            const n = parseInt(m[1], 16);
            const r = Math.round(((n >> 16) & 255) * 0.72), g = Math.round(((n >> 8) & 255) * 0.72), b = Math.round((n & 255) * 0.72);
            return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        }

        P.beginPath = nativeify(function beginPath() {
            const s = path.get(this);
            if (s) { s.arc = null; s.mine = false; }
            return raw.beginPath.apply(this, arguments);
        }, "beginPath");

        P.arc = nativeify(function arc(x, y, r, a0, a1) {
            try {
                if (track() && r > 0 && (a1 - a0) >= 6.2) {
                    const m = this.getTransform();
                    const sr = r * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
                    if (sr >= 5) {
                        let s = path.get(this);
                        if (!s) { s = { arc: null, mine: false }; path.set(this, s); }
                        s.arc = { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, r: sr };
                        s.mine = false;
                    }
                }
            } catch (_) { }
            return raw.arc.apply(this, arguments);
        }, "arc");

        P.fill = nativeify(function fill() {
            try {
                const s = path.get(this);
                if (s && s.arc && track() && isMain(this)) {
                    const a = s.arc, c = this.canvas, fs = this.fillStyle, now = performance.now();
                    let isMine = false;
                    if (typeof fs === "string") {
                        if (Math.hypot(a.x - c.width / 2, a.y - c.height / 2) <= a.r + 6) { isMine = true; st.myFill = fs; st.foundAt = now; }
                        else if (st.myFill && fs === st.myFill && now - st.foundAt < 4000) isMine = true;
                    }
                    st.arcs++;
                    if (isMine) {
                        st.found = true; pushMine(a); s.mine = true;
                        if (cfg.ballOn) {
                            const prev = this.fillStyle;
                            this.fillStyle = cfg.ball;
                            try { return raw.fill.apply(this, arguments); } finally { this.fillStyle = prev; }
                        }
                    }
                }
            } catch (_) { }
            return raw.fill.apply(this, arguments);
        }, "fill");

        P.stroke = nativeify(function stroke() {
            try {
                const s = path.get(this);
                if (cfg.ballOn && s && s.arc && isMain(this) && (s.mine || sameAsMine(s.arc))) {
                    const prev = this.strokeStyle;
                    this.strokeStyle = darker(cfg.ball);
                    try { return raw.stroke.apply(this, arguments); } finally { this.strokeStyle = prev; }
                }
            } catch (_) { }
            return raw.stroke.apply(this, arguments);
        }, "stroke");

        function textColorFor(ctx, text, x, y) {
            if (!(cfg.nameOn || cfg.textOn)) return null;
            const s = String(text).trim();
            if (!s) return null;
            st.texts++;
            const numeric = /^[0-9][0-9.,]*[kKmM]?$/.test(s);
            let onMine = false;
            if (isMain(ctx)) {
                const m = ctx.getTransform();
                onMine = nearMine(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f, 1.15);
            }
            if (numeric) return (cfg.textOn && onMine) ? cfg.text : null;
            const isMy = !!cfg.myName && s.toLowerCase() === cfg.myName.trim().toLowerCase();
            if (cfg.nameOn && (isMy || onMine || cfg.allNames)) return cfg.name;
            return null;
        }
        P.fillText = nativeify(function fillText(text, x, y) {
            let col = null;
            try { col = textColorFor(this, text, x, y); } catch (_) { }
            if (col) {
                const prev = this.fillStyle;
                this.fillStyle = col;
                try { return raw.fillText.apply(this, arguments); } finally { this.fillStyle = prev; }
            }
            return raw.fillText.apply(this, arguments);
        }, "fillText");

        try {
            const rawGC = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = nativeify(function getContext(type) {
                try { st.kinds[type] = (st.kinds[type] || 0) + 1; } catch (_) { }
                return rawGC.apply(this, arguments);
            }, "getContext");
        } catch (_) { }

        const KEYS = { ballOn: "colBallOn", ball: "colBall", nameOn: "colNameOn", name: "colName", textOn: "colTextOn", text: "colText", allNames: "colAllNames", myName: "colMyName" };
        function set(k, v) {
            if (!(k in KEYS)) return;
            cfg[k] = v;
            S.set(KEYS[k], typeof v === "boolean" ? String(v) : v);
        }
        window.addEventListener("storage", (ev) => {
            try {
                Object.keys(KEYS).forEach(k => {
                    if (ev.key === KEYS[k]) {
                        if (typeof cfg[k] === "boolean") cfg[k] = ev.newValue === "true"; else cfg[k] = ev.newValue || "";
                    }
                });
            } catch (_) { }
        });
        let pa = 0, pt = 0, pT = performance.now(), rateA = 0, rateT = 0;
        setInterval(() => {
            const t = performance.now(), dt = Math.max(0.2, (t - pT) / 1000);
            rateA = Math.round((st.arcs - pa) / dt); rateT = Math.round((st.texts - pt) / dt);
            pa = st.arcs; pt = st.texts; pT = t;
            if (performance.now() - st.foundAt > 2500) st.found = false;
        }, 500);
        return { cfg: cfg, set: set, radius: () => lastR, diag: () => ({ kinds: st.kinds, arcsPerSec: rateA, textsPerSec: rateT, found: st.found, myFill: st.myFill }) };
    } catch (_) { return null; }
})();

function ensureMyTabId() {
    return new Promise(resolve => {
        // Fresh id per page load. (sessionStorage is COPIED into tabs opened with window.open,
        // which used to hand both pages the very same id.)
        if (!myId) myId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        resolve({ id: myId });
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// v3.2 core: page numbering · line / pin engine · fresh key system · skip screen
// ══════════════════════════════════════════════════════════════════════════════
const NMCFG = {
    dblMs: parseInt(S.get("nmDblMs", "700"), 10) || 700,           // two presses inside this window = PIN
    breakOnMove: S.get("nmBreakOnMove", "false") === "true",       // OFF by default: a line never breaks by itself
    breakPx: parseInt(S.get("nmBreakPx", "300"), 10) || 300,
    diag: S.get("nmDiag", "false") === "true"
};
const NM_PAGE_STALE_MS = 20000;
const NM_ALL_DIRS = ["Right", "Left", "Up", "Down", "TopLeft", "TopRight", "BottomLeft", "BottomRight"];
window.__nmStat = { rew: 0, drop: 0, forced: 0, key: "", act: "", x: 0, y: 0 };

// ── Ticker that is NOT throttled when the tab is in the background ───────────
function nmTicker(fn, ms) {
    try {
        const url = URL.createObjectURL(new Blob(
            ["var t=setInterval(function(){postMessage(0)}," + ms + ");onmessage=function(e){if(e.data==='stop')clearInterval(t)};"],
            { type: "text/javascript" }));
        const w = new Worker(url);
        let fell = false;
        const fallback = () => { if (fell) return; fell = true; try { w.terminate(); } catch (_) { } setInterval(fn, ms); };
        w.onmessage = () => { try { fn(); } catch (_) { } };
        w.onerror = fallback;
        return w;
    } catch (_) { setInterval(fn, ms); return null; }
}

// ── Page numbering (1 / 2) ───────────────────────────────────────────────────
let myPage = 0;
const _pageChangeCbs = [];
function nmPageKey(n) { return "___nm_page_" + n + "___"; }
function nmReadPage(n) {
    try { const r = JSON.parse(localStorage.getItem(nmPageKey(n)) || "null"); return (r && typeof r === "object") ? r : null; } catch (_) { return null; }
}
function nmPageFree(n) {
    const r = nmReadPage(n);
    return !r || r.id === myId || (Date.now() - r.ts) > NM_PAGE_STALE_MS;
}
function nmWritePage(n) { try { localStorage.setItem(nmPageKey(n), JSON.stringify({ id: myId, ts: Date.now() })); } catch (_) { } }
function nmSetPage(n) {
    if (n === myPage) return;
    myPage = n;
    try { sessionStorage.setItem("__nm_page_num__", String(n)); } catch (_) { }
    _pageChangeCbs.forEach(cb => { try { cb(n); } catch (_) { } });
}
function nmClaimPage() {
    if (!myId) myId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    let want = 0;
    const m = String(location.hash || "").match(/[#&?]nmpage=(\d+)/i);
    if (m) want = parseInt(m[1], 10) || 0;
    if (!want) { try { want = parseInt(sessionStorage.getItem("__nm_page_num__") || "0", 10) || 0; } catch (_) { } }
    let n = 0;
    if (want > 0 && want < 10 && nmPageFree(want)) n = want;
    else { for (let i = 1; i < 10; i++) { if (nmPageFree(i)) { n = i; break; } } }
    if (!n) n = 1;
    nmWritePage(n);
    nmSetPage(n);
    setTimeout(nmBeat, 250);
}
function nmBeat() {
    try {
        if (!myPage) return;
        const r = nmReadPage(myPage);
        if (r && r.id !== myId && (Date.now() - r.ts) < NM_PAGE_STALE_MS) {
            for (let i = 1; i < 10; i++) { if (nmPageFree(i)) { nmWritePage(i); nmSetPage(i); return; } }
            return;
        }
        nmWritePage(myPage);
    } catch (_) { }
}
function nmOtherPage() { return myPage === 1 ? 2 : 1; }
function nmOtherPageAlive() {
    const r = nmReadPage(nmOtherPage());
    return !!r && r.id !== myId && (Date.now() - r.ts) < NM_PAGE_STALE_MS;
}
// every cross-page message carries from/to so the two pages never act on each other's own commands
function nmPostToOther(payload) {
    try { actionChannel.postMessage(Object.assign({}, payload, { from: myPage, to: nmOtherPage() })); } catch (_) { }
}
function nmPageLabel(v) {
    if (v === "current") return "هذه الصفحة (" + (myPage || 1) + ")";
    if (v === "opposite") return "الصفحة " + nmOtherPage();
    if (v === "both") return "الصفحتين";
    return v;
}
function nmRefreshPageLabels() {
    try {
        document.querySelectorAll(".nm-mini-select[id$='PageSelect'], .nm-action-page").forEach(sel => {
            Array.from(sel.options).forEach(o => { o.textContent = nmPageLabel(o.value); });
        });
    } catch (_) { }
}
let _pageUIBound = false;
function nmBindPageUI() {
    const apply = () => {
        try {
            const b = document.getElementById("nm-page-badge"); if (b) b.textContent = String(myPage || 1);
            const c = document.getElementById("nm-page-chip-num"); if (c) c.textContent = String(myPage || 1);
            nmRefreshPageLabels();
        } catch (_) { }
    };
    if (!_pageUIBound) { _pageUIBound = true; _pageChangeCbs.push(apply); }
    apply();
}
function nmToast(msg) {
    try {
        const t = document.createElement("div");
        t.className = "nm-toast"; t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => { try { t.classList.add("out"); } catch (_) { } }, 2600);
        setTimeout(() => { try { t.remove(); } catch (_) { } }, 3100);
    } catch (_) { }
}
function nmOpenOtherPage() {
    try {
        if (openedTabHandle && !openedTabHandle.closed) {
            try { openedTabHandle.focus(); } catch (_) { }
            nmToast("الصفحة " + nmOtherPage() + " مفتوحة بالفعل");
            return;
        }
        if (nmOtherPageAlive()) { nmToast("الصفحة " + nmOtherPage() + " مفتوحة بالفعل"); return; }
        if (window.openPairedTab) gmOppositeTabHandle = window.openPairedTab(location.origin + "/");
    } catch (_) { }
}

// ── Lock engine: coordinates + packet rewriting ─────────────────────────────
function nmLockCoords() {
    if (window.activeMovementLock) {
        const cfg = MOUSE_MOVE_COORDS[window.activeMovementLock];
        return cfg ? { x: cfg.x(window.innerWidth), y: cfg.y(window.innerHeight) } : null;
    }
    if (window.activeNormalLock) return getNormalLineCoords(window.activeNormalLock);
    return null;
}
// rewrites the game's own mouse packet (opcode 16, 13 bytes) in place so it can never pull the line away
function nmApplyLockToPacket(data) {
    try {
        if (!(window.activeMovementLock || window.activeNormalLock)) return;
        let dv = null;
        if (data instanceof ArrayBuffer) dv = new DataView(data);
        else if (data && data.buffer instanceof ArrayBuffer) dv = new DataView(data.buffer, data.byteOffset || 0, data.byteLength);
        if (!dv || dv.byteLength !== 13 || dv.getUint8(0) !== 16) return;
        const c = nmLockCoords();
        if (!c) return;
        dv.setInt32(1, c.x, true);
        dv.setInt32(5, c.y, true);
        window.__nmStat.rew++; window.__nmStat.x = c.x; window.__nmStat.y = c.y;
    } catch (_) { }
}

// ── Line state machine ───────────────────────────────────────────────────────
//   1 press  = LINE  (strong, never breaks by itself, no mouse movement can pull it away)
//   2 quick presses = PIN (absolute: mouse events blocked + the game's own packets dropped)
//   next press = OFF
const _lineSeq = {};
function nmCornerReleaseAll() { try { if (window.__nmCorner) window.__nmCorner.releaseAll(); } catch (_) { } }
function nmReleaseLine() {
    window.activeMovementLock = null;
    window.activeNormalLock = null;
    window.nmLinePinned = false;
}
function nmReleaseAll() {
    nmReleaseLine();
    nmCornerReleaseAll();
    NM_ALL_DIRS.forEach(d => { _lineSeq[d] = null; });
    nmRefreshLineUI();
}
// A plain line no longer depends only on rewriting the game's own outgoing
// packets - it also actively RESENDS the locked direction on its own clock.
// This keeps it holding through anything that could briefly change or delay
// the game's own packet stream (e.g. splitting), instead of waiting for the
// game to send the next one.
let _nmLineTickerStarted = false;
function nmEnsureLineTicker() {
    if (_nmLineTickerStarted) return;
    _nmLineTickerStarted = true;
    nmTicker(() => {
        try {
            if (window.nmLinePinned) return;                 // pins are handled by __nmCorner already
            if (!(window.activeMovementLock || window.activeNormalLock)) return;
            const c = nmLockCoords();
            if (c) sendMovePacket(c.x, c.y);
        } catch (_) { }
    }, 45);
}
function nmStartLine(dir, pinned) {
    nmEnsureLineTicker();
    nmCornerReleaseAll();
    window.activeNormalLock = null;
    window.activeMovementLock = dir;
    window.nmLinePinned = !!pinned;
    window.nmLineSince = Date.now();
    window.nmLineTravel = 0;
    try { const c = nmLockCoords(); if (c) sendMovePacket(c.x, c.y); } catch (_) { }
}
function nmLineState(dir) {
    try {
        if (window.__nmCorner && window.__nmCorner.isActive(dir)) return "pin";
        if (window.activeMovementLock === dir) return "line";
    } catch (_) { }
    return "off";
}
function nmLinePress(dir, ts) {
    ts = ts || Date.now();
    const st = nmLineState(dir);
    const seq = _lineSeq[dir];
    if (st === "line" && seq && seq.activated && (ts - seq.ts) <= NMCFG.dblMs) {
        _lineSeq[dir] = null;
        if (window.__nmCorner) { nmReleaseLine(); window.__nmCorner.activate(dir); }
        else nmStartLine(dir, true);
        window.__nmStat.act = dir + " · pin";
        return "pin";
    }
    if (st === "off") {
        nmStartLine(dir, false);
        _lineSeq[dir] = { ts: ts, activated: true };
        window.__nmStat.act = dir + " · line";
        return "line";
    }
    nmCornerReleaseAll();
    if (window.activeMovementLock === dir) nmReleaseLine();
    _lineSeq[dir] = { ts: ts, activated: false };
    window.__nmStat.act = dir + " · off";
    return "off";
}

// ── Live line state in the panel + HUD on the game screen ────────────────────
let _hudEl = null, _hudKey = "";
function nmRefreshLineUI() {
    try {
        const states = {};
        for (let i = 0; i < NM_ALL_DIRS.length; i++) states[NM_ALL_DIRS[i]] = nmLineState(NM_ALL_DIRS[i]);
        document.querySelectorAll(".nm-line-state").forEach(el => {
            const st = states[el.getAttribute("data-dir")] || "off";
            if (el.getAttribute("data-st") !== st) {
                el.setAttribute("data-st", st);
                el.className = "nm-line-state nm-st-" + st;
                el.textContent = st === "pin" ? "📌 مثبت" : (st === "line" ? "لاين" : "—");
            }
        });
        const act = NM_ALL_DIRS.filter(d => states[d] !== "off");
        const key = myPage + "|" + act.map(d => d + states[d]).join(",");
        if (key === _hudKey) return;
        if (!act.length) { if (_hudEl) _hudEl.style.display = "none"; _hudKey = key; return; }
        if (!_hudEl || !_hudEl.isConnected) {
            if (!document.body) return;
            _hudEl = document.createElement("div");
            _hudEl.id = "nm-hud";
            document.body.appendChild(_hudEl);
        }
        _hudEl.style.display = "flex";
        _hudEl.innerHTML = act.map(d =>
            '<span class="nm-hud-tag nm-hud-' + states[d] + '">صفحة ' + myPage + ' · ' + getDirectionLabel(d) +
            (states[d] === "pin" ? ' · 📌 مثبت' : ' · لاين') + '</span>').join("");
        _hudKey = key;
    } catch (_) { }
}

// ── Fresh key system: ONE key = ONE owner (lines, release key, customizations) ─
let nmReleaseKey = S.get("nmReleaseKey", "None") || "None";
function nmKeyLabel(code) {
    try { return (typeof _codeToDisplay !== "undefined" && _codeToDisplay[code]) || String(code).replace(/^Key|^Digit/, ""); } catch (_) { return String(code); }
}
function nmOwnerLabel(o) {
    if (o.type === "line") return getDirectionLabel(o.id.replace("movement", ""));
    if (o.type === "release") return "فك كل اللاينات";
    if (o.type === "cust") return "تخصيص: " + ((customizations[o.idx] && customizations[o.idx].name) || "");
    return "";
}
function nmAllOwners() {
    const out = [];
    try {
        NM_ALL_DIRS.forEach(d => { const vb = "movement" + d; if (_lineVarMap[vb]) out.push({ type: "line", id: vb, key: _lineVarMap[vb].getKey() }); });
        out.push({ type: "release", key: nmReleaseKey });
        customizations.forEach((c, i) => out.push({ type: "cust", idx: i, key: c.shortcut }));
    } catch (_) { }
    return out;
}
function nmSameOwner(a, b) {
    return !!a && !!b && a.type === b.type && (a.id === b.id) && (a.idx === b.idx);
}
function nmWriteOwnerKey(o, code) {
    try {
        if (o.type === "line") { _lineVarMap[o.id].setKey(code); S.set(o.id + "Key", code); }
        else if (o.type === "release") { nmReleaseKey = code; S.set("nmReleaseKey", code); }
        else if (o.type === "cust" && customizations[o.idx]) {
            customizations[o.idx].shortcut = code;
            S.set("customizations", JSON.stringify(customizations));
            try { settingsChannel.postMessage({ type: "update_customizations", data: customizations }); } catch (_) { }
        }
    } catch (_) { }
}
// give `code` to `owner`; every other owner that had it loses it (and the player is told)
function nmClaimKey(code, owner) {
    try {
        if (!code || code === "None") return;
        const lost = [];
        nmAllOwners().forEach(o => {
            if (nmSameOwner(o, owner)) return;
            if (o.key === code) { nmWriteOwnerKey(o, "None"); lost.push(nmOwnerLabel(o)); }
        });
        if (lost.length) nmToast("الزر " + nmKeyLabel(code) + " اتنقل من: " + lost.join("، ") + " (زر واحد = أمر واحد)");
        nmRefreshKeyUI();
    } catch (_) { }
}
function nmDedupeKeys() {
    try {
        const seen = {}; let n = 0;
        nmAllOwners().forEach(o => {
            const k = o.key;
            if (!k || k === "None") return;
            if (seen[k]) { nmWriteOwnerKey(o, "None"); n++; } else seen[k] = true;
        });
        if (n) nmToast("اتشال " + n + " تداخل في المفاتيح - اضبطها من جديد");
        nmRefreshKeyUI();
    } catch (_) { }
}
function nmRefreshKeyUI() {
    try {
        updateMovementUIElements();
        const rb = document.getElementById("nmReleaseKeyBox");
        if (rb) rb.textContent = nmReleaseKey !== "None" ? nmKeyLabel(nmReleaseKey) : "";
        updateCustomizationsUI();
    } catch (_) { }
}
function nmClearAllKeys() {
    try {
        nmAllOwners().forEach(o => { if (o.key && o.key !== "None") nmWriteOwnerKey(o, "None"); });
        nmRefreshKeyUI();
        nmToast("اتمسحت كل المفاتيح - ابدأ ضبط جديد");
    } catch (_) { }
}
function nmSetLineKey(varBase, code) {
    // assigning a key also switches the line ON, so it works right away
    try {
        const en = _lineVarMap[varBase];
        if (!en) return;
        nmClaimKey(code, { type: "line", id: varBase });
        en.setKey(code); S.set(varBase + "Key", code);
        if (code !== "None" && !en.get()) { en.set(true); S.set(varBase + "Enabled", "true"); }
        try { settingsChannel.postMessage({ type: "update_movement_settings", data: getAllDirections() }); } catch (_) { }
        nmRefreshKeyUI();
    } catch (_) { }
}

// ── Guided key setup: press the key for each action, one by one ─────────────
let _setupRun = null;
function nmGuidedSetup() {
    try {
        if (_setupRun) return;
        _stopRec();
        const steps = NM_ALL_DIRS.map(d => ({ owner: { type: "line", id: "movement" + d }, label: getDirectionLabel(d) }));
        steps.push({ owner: { type: "release" }, label: "فك كل اللاينات (زر الطوارئ)" });
        let i = 0;
        const ov = document.createElement("div");
        ov.id = "nm-setup-overlay";
        document.body.appendChild(ov);
        window.__nmSetupActive = true;
        const draw = () => {
            const s = steps[i];
            ov.innerHTML = '<div class="nm-setup-card"><div class="nm-setup-step">' + (i + 1) + ' / ' + steps.length + '</div>' +
                '<div class="nm-setup-title">اضغط الزر الخاص بـ</div><div class="nm-setup-name">' + s.label + '</div>' +
                '<div class="nm-setup-help">Esc = تخطي · Backspace = بدون زر · أي زر تاني = تعيين</div></div>';
        };
        const finish = () => {
            window.removeEventListener("keydown", onKey, true);
            window.__nmSetupActive = false; _setupRun = null;
            try { ov.remove(); } catch (_) { }
            nmRefreshKeyUI();
            nmToast("تم ضبط المفاتيح");
        };
        const onKey = (ev) => {
            try {
                ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
                if (ev.repeat) return;
                const s = steps[i];
                if (ev.code === "Escape") { /* skip */ }
                else if (ev.code === "Backspace" || ev.code === "Delete") {
                    if (s.owner.type === "line") nmSetLineKey(s.owner.id, "None"); else nmWriteOwnerKey(s.owner, "None");
                } else {
                    if (s.owner.type === "line") nmSetLineKey(s.owner.id, ev.code);
                    else { nmClaimKey(ev.code, s.owner); nmWriteOwnerKey(s.owner, ev.code); }
                }
                i++;
                if (i >= steps.length) finish(); else draw();
            } catch (_) { finish(); }
        };
        window.addEventListener("keydown", onKey, true);
        _setupRun = { stop: finish };
        draw();
    } catch (_) { window.__nmSetupActive = false; _setupRun = null; }
}

// ── Debug box (optional) ─────────────────────────────────────────────────────
let _diagEl = null, _diagPrev = { rew: 0, drop: 0, forced: 0 }, _diagT = 0;
function nmDiagTick() {
    try {
        if (!NMCFG.diag) { if (_diagEl) _diagEl.style.display = "none"; return; }
        if (!document.body) return;
        if (!_diagEl || !_diagEl.isConnected) { _diagEl = document.createElement("div"); _diagEl.id = "nm-diag"; document.body.appendChild(_diagEl); }
        const s = window.__nmStat, now = Date.now(), dt = Math.max(0.2, (now - _diagT) / 1000);
        const r = Math.round((s.rew - _diagPrev.rew) / dt), d = Math.round((s.drop - _diagPrev.drop) / dt), f = Math.round((s.forced - _diagPrev.forced) / dt);
        _diagPrev = { rew: s.rew, drop: s.drop, forced: s.forced }; _diagT = now;
        _diagEl.style.display = "block";
        _diagEl.textContent = "صفحة " + myPage + " | آخر زر: " + (s.key || "-") + " | آخر أمر: " + (s.act || "-") +
            " | إحداثيات: " + s.x + "," + s.y + " | معاد كتابته/ث: " + r + " | مُسقَط/ث: " + d + " | مُجبَر/ث: " + f;
    } catch (_) { }
}

// ── Skip the "نتيجة الجولة / الإستمرار" screen as if it never existed ───────
let _skipOn = true;
try { _skipOn = S.get("skipResults", "true") !== "false"; } catch (_) { }
let _skipSeenAt = 0, _skipLastClick = 0, _skipGaveUp = false, _skipClassUsed = false;
function nmSkipEnabled() { return _skipOn; }
function nmSetSkip(v) {
    _skipOn = !!v;
    S.set("skipResults", _skipOn ? "true" : "false");
    nmSkipTick();
}
function nmNorm(s) {
    return String(s || "").replace(/[ً-ٟـ]/g, "").replace(/[إأآ]/g, "ا").replace(/\s+/g, " ").trim();
}
function nmFindResultsPopup() {
    const ps = document.getElementById("playscore");
    if (!ps) return null;
    const group = ps.closest(".form-group") || ps.parentElement;
    const inner = group && group.parentElement;           // the results panel itself
    if (!inner) return null;
    let btn = null;
    const btns = inner.querySelectorAll("button");
    for (let i = 0; i < btns.length; i++) { if (nmNorm(btns[i].textContent).indexOf("الاستمرار") !== -1) { btn = btns[i]; break; } }
    if (!btn && btns.length === 1) btn = btns[0];
    return { box: inner, btn: btn };
}
function nmPopupShown(box) {
    try {
        if (!box || !box.isConnected) return false;
        const cs = getComputedStyle(box);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        let el = box;
        for (let i = 0; i < 5 && el && el !== document.body; i++, el = el.parentElement) {
            if (el.style && el.style.opacity === "0") return false;
        }
        return true;
    } catch (_) { return false; }
}
function nmClearSkipClass() {
    const hid = document.querySelectorAll(".nm-skip-hide");
    for (let i = 0; i < hid.length; i++) hid[i].classList.remove("nm-skip-hide");
    _skipClassUsed = false;
}
function nmSkipTick() {
    try {
        if (!_skipOn) { if (_skipClassUsed) nmClearSkipClass(); return; }
        const f = nmFindResultsPopup();
        if (!f || !f.box || !f.btn || !nmPopupShown(f.box)) {
            if (_skipClassUsed) nmClearSkipClass();
            _skipSeenAt = 0; _skipGaveUp = false;
            return;
        }
        const now = Date.now();
        if (!_skipSeenAt) _skipSeenAt = now;
        if (_skipGaveUp) return;
        if (now - _skipSeenAt > 2500) {           // could not dismiss it: show it so the player is never stuck
            _skipGaveUp = true;
            nmClearSkipClass();
            return;
        }
        f.box.classList.add("nm-skip-hide");
        const par = f.box.parentElement;
        if (par && par !== document.body && par.children.length === 1 && !par.querySelector("canvas")) par.classList.add("nm-skip-hide");
        _skipClassUsed = true;
        if (!f.btn.disabled && now - _skipLastClick > 250) {
            _skipLastClick = now;
            f.btn.click();
        }
    } catch (_) { }
}
function nmSkipInit() {
    try {
        const st = document.createElement("style");
        st.textContent = ".nm-skip-hide{position:fixed!important;left:-99999px!important;top:-99999px!important;opacity:0!important;pointer-events:none!important}";
        (document.head || document.documentElement).appendChild(st);
        new MutationObserver(() => nmSkipTick()).observe(document.documentElement,
            { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
        setInterval(nmSkipTick, 200);
        window.addEventListener("storage", ev => {
            if (ev.key === "skipResults") { _skipOn = ev.newValue !== "false"; nmSkipTick(); }
        });
    } catch (_) { }
}

// ── Panel toggle (shared by every way of opening the panel) ─────────────────
let _nmTogT = 0, _nmSyncedPanel = null;
function nmGetPanel() { return document.querySelector(".nm-menu-container") || document.getElementById("controlPanel"); }
// The panel's visibility is forced with inline !important styles that follow the `show` class,
// so page CSS / a missing stylesheet / a running animation can never keep it hidden.
function nmSyncPanel(panel) {
    try {
        const on = panel.classList.contains("show");
        const set = (k, v) => panel.style.setProperty(k, v, "important");
        if (on) { set("display", "flex"); set("visibility", "visible"); set("opacity", "1"); set("pointer-events", "auto"); set("position", "fixed"); }
        else set("display", "none");
    } catch (_) { }
}
function nmWatchPanel(panel) {
    try {
        if (!panel || _nmSyncedPanel === panel) return;
        _nmSyncedPanel = panel;
        new MutationObserver(() => nmSyncPanel(panel)).observe(panel, { attributes: true, attributeFilter: ["class"] });
        nmSyncPanel(panel);
    } catch (_) { }
}
function nmPanelState() {
    try {
        const p = nmGetPanel(), c = document.getElementById("nm-floating-circle");
        const cs = p && getComputedStyle(p), pr = p && p.getBoundingClientRect(), cr = c && c.getBoundingClientRect();
        let cover = null;
        if (cr) { const el = document.elementFromPoint(cr.x + cr.width / 2, cr.y + cr.height / 2); cover = el ? (el.tagName + (el.id ? "#" + el.id : "") + (el.className && el.className.baseVal === undefined ? "." + String(el.className).split(" ")[0] : "")) : null; }
        return {
            panels: document.querySelectorAll(".nm-menu-container").length, panelsById: document.querySelectorAll("#controlPanel").length,
            show: !!p && p.classList.contains("show"), display: cs && cs.display, visibility: cs && cs.visibility, opacity: cs && cs.opacity, z: cs && cs.zIndex,
            panelRect: pr && [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)],
            iconRect: cr && [Math.round(cr.x), Math.round(cr.y), Math.round(cr.width), Math.round(cr.height)],
            elementOnTopOfIcon: cover, viewport: [innerWidth, innerHeight], page: myPage
        };
    } catch (e) { return { error: String(e) }; }
}
function nmTogglePanel() {
    try {
        const now = Date.now();
        if (now - _nmTogT < 350) return;                   // the icon has several click paths: only one may act
        _nmTogT = now;
        let panel = nmGetPanel();
        if (!panel) {                                      // the panel was never built / got removed: build it again
            try { createControlPanel(); nmInitV32UI(); } catch (e) { try { console.error("[MTC 3.2] تعذر بناء اللوحة", e); } catch (_) { } }
            panel = nmGetPanel();
            if (!panel) { nmToast("اللوحة مش اتبنت - شوف الـ Console"); return; }
        }
        nmWatchPanel(panel);
        if (panel.classList.contains("show")) { panel.classList.remove("show"); }
        else {
            const circle = document.getElementById("nm-floating-circle");
            const cr = circle ? circle.getBoundingClientRect() : { left: 30, bottom: 90, top: 30 };
            const W = 680, H = 600, m = 12;
            let top = cr.bottom + m;
            if (top + H > window.innerHeight) top = Math.max(m, cr.top - H - m);
            let left = cr.left;
            if (left + W > window.innerWidth) left = Math.max(m, window.innerWidth - W - m);
            panel.style.top = top + "px"; panel.style.left = left + "px";
            panel.classList.add("show");
        }
        nmSyncPanel(panel);
        try { console.log("[MTC 3.2] اللوحة " + (panel.classList.contains("show") ? "اتفتحت" : "اتقفلت"), JSON.stringify(nmPanelState())); } catch (_) { }
    } catch (e) { try { console.error("[MTC 3.2] toggle failed", e); } catch (_) { } }
}
// handy from the Console:  __MTC.open()   /   __MTC.state()
try { Object.defineProperty(window, "__MTC", { value: { open: nmTogglePanel, state: () => { const s = nmPanelState(); console.log(JSON.stringify(s)); return s; } }, configurable: true }); } catch (_) { }
// Registered at document-start on `window` in the capture phase => they run BEFORE the game's handlers,
// so a game that swallows mouse events can no longer stop the icon from working.
(function nmOpenFallbacks() {
    try {
        let sx = null, sy = 0;
        const inC = (t) => { try { return !!(t && t.closest && t.closest("#nm-floating-circle")); } catch (_) { return false; } };
        window.addEventListener("mousedown", (e) => { if (e.button === 0 && inC(e.target)) { sx = e.clientX; sy = e.clientY; try { console.log("[MTC 3.2] ضغطة على الأيقونة"); } catch (_) { } } else sx = null; }, true);
        window.addEventListener("mouseup", (e) => {
            if (sx !== null && inC(e.target) && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) nmTogglePanel();
            sx = null;
        }, true);
        // keyboard way in, works even if something covers the icon:  Ctrl + Shift + M
        window.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.shiftKey && e.code === "KeyM") { e.preventDefault(); e.stopPropagation(); nmTogglePanel(); }
        }, true);
    } catch (_) { }
})();

// ── boot ─────────────────────────────────────────────────────────────────────
try { console.log("[MTC 3.2] السكريبت اشتغل"); } catch (_) { }
try { nmClaimPage(); } catch (_) { }
try { nmTicker(nmBeat, 2000); } catch (_) { }
try {
    window.addEventListener("pagehide", () => {
        try { const r = nmReadPage(myPage); if (r && r.id === myId) localStorage.removeItem(nmPageKey(myPage)); } catch (_) { }
    });
} catch (_) { }
nmOnDocReady(nmSkipInit);
setInterval(nmRefreshLineUI, 250);
setInterval(nmDiagTick, 400);

// ══════════════════════════════════════════════════════════════════════════════
// v3.2 UI: extra css, new panes (Performance / Colors) and wiring
// ══════════════════════════════════════════════════════════════════════════════
nmOnDocReady(function nmInjectExtraCss() {
    const st = document.createElement("style");
    st.id = "nm-style-v32";
    st.textContent = "/* \u2500\u2500 v3.2 extras \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n#nm-tab-lines .nm-lines-container{height:auto}\n#nm-tab-lines .nm-lines-column{overflow:visible}\n#nm-tab-lines .nm-line-row{flex:none;min-height:40px}\n.nm-lines-toolbar{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:10px}\n.nm-chip-btn{padding:7px 14px;font-size:12px;font-weight:700;color:var(--text-light);cursor:pointer;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;transition:all .2s}\n.nm-chip-btn:hover{background:rgba(var(--primary-rgb),.22);border-color:var(--primary-red);transform:translateY(-1px)}\n.nm-chip-btn.primary{background:linear-gradient(135deg,var(--primary-red),var(--primary-dark));border-color:rgba(255,255,255,.18);box-shadow:0 4px 14px rgba(var(--primary-rgb),.35)}\n.nm-release-row{margin-top:6px;padding-top:10px;border-top:1px dashed rgba(255,255,255,.12)!important}\n.nm-line-extra{min-width:62px;text-align:center;font-size:10px;color:var(--text-dim)}\n.nm-opts{display:flex;flex-direction:column;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06)}\n.nm-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--text-light);min-height:32px}\n.nm-opt>span:first-child{flex:1}\n.nm-card{display:flex;flex-direction:column;gap:10px;padding:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px}\n.nm-card-title{font-size:15px;font-weight:800;color:var(--primary-red);padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.06)}\n.nm-note{font-size:11px;line-height:1.7;color:var(--text-dim);opacity:.85}\n.nm-live{font-size:13px;color:var(--text-light)}\n.nm-live b{color:var(--primary-red);font-size:18px}\n.nm-color-row{display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.05);border-radius:10px}\n.nm-color-name{flex:1;font-size:13px;font-weight:700;color:var(--text-light)}\n.nm-color-row input[type=color]{width:40px;height:30px;padding:0;border:2px solid rgba(255,255,255,.2);border-radius:8px;background:none;cursor:pointer}\n.nm-swatches{display:flex;gap:5px}\n.nm-swatch{width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.25);cursor:pointer;padding:0;transition:transform .15s}\n.nm-swatch:hover{transform:scale(1.25)}\n.nm-diag-line{font-size:11px;line-height:1.7;padding:8px 10px;color:var(--text-dim);background:rgba(0,0,0,.3);border-radius:8px;border:1px dashed rgba(255,255,255,.1)}\n.nm-diag-line b{color:var(--text-light)}\n#nm-fps{position:fixed;top:8px;right:8px;z-index:2147482400;padding:3px 10px;font:700 13px/1.4 Consolas,monospace;color:#7CFF7C;background:rgba(0,0,0,.55);border-radius:8px;pointer-events:none;display:none}\n#nm-diag{position:fixed;bottom:8px;left:8px;right:8px;z-index:2147482400;padding:6px 12px;font:600 12px/1.5 Consolas,monospace;color:#eee;background:rgba(0,0,0,.72);border:1px solid rgba(255,255,255,.18);border-radius:8px;pointer-events:none;display:none;direction:rtl;text-align:right}\n#nm-setup-overlay{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;background:rgba(5,5,10,.82);backdrop-filter:blur(6px)}\n.nm-setup-card{min-width:320px;padding:28px 36px;text-align:center;direction:rtl;background:var(--menu-bg);border:1px solid var(--primary-red);border-radius:20px;box-shadow:0 0 50px rgba(var(--primary-rgb),.45)}\n.nm-setup-step{font-size:12px;color:var(--text-dim);margin-bottom:8px}\n.nm-setup-title{font-size:14px;color:var(--text-dim)}\n.nm-setup-name{margin:10px 0 14px;font-size:26px;font-weight:900;color:var(--text-light);text-shadow:0 0 18px rgba(var(--primary-rgb),.8)}\n.nm-setup-help{font-size:11px;color:var(--text-dim)}\n#nm-tab-perf,#nm-tab-colors{color:var(--text-light)}\n.nm-opts .nm-dark-input.mini,.nm-opt .nm-dark-input.mini{width:70px}\n#nm-floating-circle{z-index:2147483600!important}\n.nm-menu-container{z-index:2147483500!important}\n.nm-rec-list{max-height:230px;overflow:auto;margin:0;padding:8px;direction:ltr;text-align:left;font:11px/1.55 Consolas,monospace;color:#cfe8ff;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.08);border-radius:8px;white-space:pre-wrap;word-break:break-all}\n#nm-tab-rec,#nm-tab-adv{color:var(--text-light)}\n.nm-macro-list{display:flex;flex-direction:column;gap:6px;max-height:190px;overflow:auto}\n.nm-macro-row{display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.06);border-radius:10px}\n.nm-macro-name{flex:1;font-size:12px;font-weight:700;color:var(--text-light)}\n.nm-macro-name small{font-weight:500;color:var(--text-dim)}\n.nm-chip-btn.mini{padding:4px 9px;font-size:11px}\n.nm-key-box.mini{width:46px;height:26px;font-size:10px}\n/* \u2500\u2500 v3.3: a bit more \"\u062c\u0628\u0627\u0631\" \u2014 glowing accents, animated gradient header \u2500\u2500 */\n.nm-card-title{position:relative}\n.nm-card-title::after{content:\"\";position:absolute;left:0;bottom:-1px;width:38px;height:2px;background:linear-gradient(90deg,var(--primary-red),transparent);box-shadow:0 0 8px var(--primary-red)}\n.nm-chip-btn.primary{background-size:200% 200%;animation:nmGradShift 4s ease infinite}\n@keyframes nmGradShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}\n#nm-floating-circle{animation:nmFabPulse 3s ease-in-out infinite}\n@keyframes nmFabPulse{0%,100%{box-shadow:0 4px 18px rgba(0,0,0,.5),0 0 0 rgba(var(--primary-rgb),0)}50%{box-shadow:0 4px 18px rgba(0,0,0,.5),0 0 18px rgba(var(--primary-rgb),.55)}}\n";
    (document.head || document.documentElement).appendChild(st);
});

function nmPerfPaneHTML() {
    return `
          <div id="nm-tab-perf" class="nm-tab-pane" dir="rtl">
            <div class="nm-card">
              <div class="nm-card-title">⚡ فتح الفريمات</div>
              <div class="nm-opt"><span>الوضع</span>
                <select id="nm-fpsMode" class="nm-mini-select" style="width:190px">
                  <option value="unlimited">بلا حد (أقصى قوة الجهاز)</option>
                  <option value="custom">حد مخصص</option>
                  <option value="off">طبيعي (بدون تعديل)</option>
                </select>
              </div>
              <div class="nm-opt" id="nm-fpsCapRow"><span>الحد الأقصى (FPS)</span><input type="number" id="nm-fpsCap" class="nm-dark-input mini" min="30" max="2000" step="10"></div>
              <div class="nm-opt"><span>الصفحة في الخلفية تفضل شغالة بدون تجميد</span>
                <label class="nm-toggle-switch"><input type="checkbox" id="nm-fpsBgOn"><span class="nm-slider"></span></label></div>
              <div class="nm-opt" id="nm-fpsBgRow"><span>فريمات الصفحة الخلفية</span><input type="number" id="nm-fpsBg" class="nm-dark-input mini" min="10" max="240" step="5"></div>
              <div class="nm-opt"><span>عداد FPS على الشاشة</span>
                <label class="nm-toggle-switch"><input type="checkbox" id="nm-fpsShow"><span class="nm-slider"></span></label></div>
              <div class="nm-live">الآن: <b id="nm-fpsLive">0</b> FPS</div>
              <div class="nm-note">الوضع "بلا حد" بيشغّل منطق ورسم اللعبة بأقصى سرعة من غير ما ينتظر تحديث الشاشة. الشاشة نفسها مش هتعرض أكتر من معدل تحديثها (Hz)؛ لفك ده كمان شغّل Chrome بالخيارين <span dir="ltr">--disable-frame-rate-limit --disable-gpu-vsync</span>. لو العداد فضل 0 يبقى اللعبة مش بتستخدم requestAnimationFrame. لو الحركة بقت سريعة زيادة اختار "حد مخصص".</div>
            </div>
          </div>`;
}

function nmRecPaneHTML() {
    return `
          <div id="nm-tab-rec" class="nm-tab-pane" dir="rtl">
            <div class="nm-card">
              <div class="nm-card-title">🔬 مسجّل الحزم</div>
              <div class="nm-note">بيسجّل اللي صفحتك بتبعته للسيرفر. شغّل التسجيل، اعمل الأمر اللي عايزه في اللعبة مرة واحدة (ميوت، لوحة الأدمن...) بالطريقة اللي اللعبة بتديهالك، بعدين اضغط "نسخ الكل" وابعت النص لـ Claude.</div>
              <div class="nm-opt"><span>تسجيل اللي بيتبعت للسيرفر</span><label class="nm-toggle-switch"><input type="checkbox" id="nm-recOn"><span class="nm-slider"></span></label></div>
              <div class="nm-opt"><span>إخفاء حزم الماوس</span><label class="nm-toggle-switch"><input type="checkbox" id="nm-recHideMouse"><span class="nm-slider"></span></label></div>
              <div class="nm-lines-toolbar">
                <button class="nm-chip-btn primary" id="nm-recCopy">📋 نسخ الكل</button>
                <button class="nm-chip-btn" id="nm-recClear">🗑 مسح</button>
              </div>
              <div class="nm-live">اتسجّل: <b id="nm-recCount">0</b> حزمة</div>
              <pre id="nm-recList" class="nm-rec-list"></pre>
            </div>
          </div>`;
}

function nmAdvPaneHTML() {
    return `
          <div id="nm-tab-adv" class="nm-tab-pane" dir="rtl">
            <div class="nm-card">
              <div class="nm-card-title">🎬 المسجّل الحركي</div>
              <div class="nm-note">سجّل سلسلة ضغطات مفاتيح حقيقية بتوقيتها الحقيقي، واربطها بمفتاح واحد يشغّلها تاني زي ما سجّلتها بالظبط.</div>
              <div class="nm-lines-toolbar">
                <input type="text" id="nm-macroName" class="nm-dark-input" placeholder="اسم الماكرو" style="max-width:150px">
                <button class="nm-chip-btn primary" id="nm-macroRecBtn">⏺ تسجيل</button>
              </div>
              <div class="nm-live" id="nm-macroRecLive" style="display:none">بيسجّل «<b id="nm-macroRecName"></b>»: <b id="nm-macroRecCount">0</b> ضغطة — اضغط "إيقاف" لما تخلص</div>
              <div id="nm-macroList" class="nm-macro-list"></div>
            </div>
            <div class="nm-card">
              <div class="nm-card-title">🔔 تنبيهات الحجم</div>
              <div class="nm-note">صوت وفلاش على الشاشة لما كرتك تكبر فجأة (نجحت في أكل حاجة كبيرة) أو تصغر فجأة (خطر).</div>
              <div class="nm-opt"><span>تفعيل التنبيهات</span><label class="nm-toggle-switch"><input type="checkbox" id="nm-alOn"><span class="nm-slider"></span></label></div>
              <div class="nm-opt"><span>صوت التنبيه</span><label class="nm-toggle-switch"><input type="checkbox" id="nm-alSound"><span class="nm-slider"></span></label></div>
              <div class="nm-opt"><span>نسبة الزيادة المفاجئة (%)</span><input type="number" id="nm-alGrow" class="nm-dark-input mini" min="5" max="100" step="1"></div>
              <div class="nm-opt"><span>نسبة النقصان المفاجئ (%)</span><input type="number" id="nm-alShrink" class="nm-dark-input mini" min="5" max="100" step="1"></div>
              <div class="nm-lines-toolbar"><button class="nm-chip-btn" id="nm-alTest">🔊 جرّب الصوت</button></div>
            </div>
            <div class="nm-card">
              <div class="nm-card-title">📹 تسجيل لقطات</div>
              <div class="nm-note">يسجّل شاشة اللعبة نفسها عندك (الكانفس) لملف فيديو .webm ينزل على جهازك أول ما توقف — زي برنامج تصوير شاشة بسيط، من غير أي برنامج خارجي.</div>
              <div class="nm-lines-toolbar">
                <button class="nm-chip-btn primary" id="nm-capBtn">⏺ ابدأ التسجيل</button>
              </div>
              <div class="nm-live" id="nm-capLive" style="display:none">بيسجّل... <b id="nm-capSec">0</b> ثانية</div>
            </div>
            <div class="nm-card">
              <div class="nm-card-title">💾 بروفايلات الإعدادات</div>
              <div class="nm-note">احفظ إعداداتك الحالية (الألوان، الفريمات، التنبيهات) تحت اسم، وبدّل بينهم في أي وقت.</div>
              <div class="nm-lines-toolbar">
                <input type="text" id="nm-profName" class="nm-dark-input" placeholder="اسم البروفايل" style="max-width:150px">
                <button class="nm-chip-btn primary" id="nm-profSaveBtn">💾 حفظ الحالي</button>
              </div>
              <div id="nm-profList" class="nm-macro-list"></div>
            </div>
          </div>`;
}

function nmColorsPaneHTML() {
    const row = (id, label) => `
              <div class="nm-color-row">
                <label class="nm-toggle-switch"><input type="checkbox" id="nm-${id}On"><span class="nm-slider"></span></label>
                <span class="nm-color-name">${label}</span>
                <input type="color" id="nm-${id}">
              </div>`;
    return `
          <div id="nm-tab-colors" class="nm-tab-pane" dir="rtl">
            <div class="nm-card">
              <div class="nm-card-title">🎨 ألوان اللعب</div>
              ${row("colBall", "لون الكرة اللي بلعب بيها")}
              <div class="nm-swatches" id="nm-ballSwatches" style="justify-content:center"></div>
              ${row("colName", "لون اسمي")}
              ${row("colText", "لون الكتابة (الكتلة) على كرتي")}
              <div class="nm-opt"><span>اسمي في اللعبة</span>
                <input type="text" id="nm-colMyName" class="nm-dark-input" style="max-width:190px" placeholder="زي ما بيظهر في اللعبة">
                <button class="nm-chip-btn" id="nm-grabName">التقاط</button></div>
              <div class="nm-opt"><span>لون الاسم يتطبق على كل اللاعبين</span>
                <label class="nm-toggle-switch"><input type="checkbox" id="nm-colAllNames"><span class="nm-slider"></span></label></div>
              <div class="nm-diag-line" id="nm-colDiag">...</div>
              <div class="nm-note">كرتك بتتعرف تلقائياً (الكرة اللي في نص الشاشة، وأي كرة بنفس لونها). لو اللعبة بترسم الأسماء مرة واحدة وتخزنها، اكتب اسمك في الخانة عشان يتلون. ملحوظة: الكشف شغال لو اللعبة بترسم بـ Canvas 2D بس.</div>
            </div>
          </div>`;
}

function nmInitV32UI() {
    try {
        try { nmWatchPanel(nmGetPanel()); } catch (_) { }
        const $ = (id) => document.getElementById(id);
        const bind = (id, ev, fn) => { const el = $(id); if (el) el["on" + ev] = fn; return el; };

        // ── Lines tab extras
        bind("nm-guidedSetup", "click", () => nmGuidedSetup());
        bind("nm-clearKeys", "click", () => { if (confirm("مسح كل المفاتيح (اللاينات + فك اللاينات + التخصيصات)؟")) nmClearAllKeys(); });
        bind("nm-releaseAllBtn", "click", () => nmReleaseAll());
        const rb = $("nmReleaseKeyBox"), rr = $("nmReleaseRec");
        if (rb) rb.textContent = nmReleaseKey !== "None" ? nmKeyLabel(nmReleaseKey) : "";
        if (rr) rr.onclick = () => {
            if (_recBoxId === "nmReleaseKeyBox") { _stopRec(); return; }
            _recOnComplete = (code) => {
                const o = { type: "release" };
                if (code !== "None") nmClaimKey(code, o);
                nmWriteOwnerKey(o, code);
                nmRefreshKeyUI();
            };
            _startRec("nmReleaseKeyBox", rr);
        };
        const dbl = $("nm-dblMs"); if (dbl) { dbl.value = NMCFG.dblMs; dbl.onchange = () => { NMCFG.dblMs = Math.min(1500, Math.max(200, parseInt(dbl.value, 10) || 700)); dbl.value = NMCFG.dblMs; S.set("nmDblMs", String(NMCFG.dblMs)); }; }
        const bom = $("nm-breakOnMove"), bpx = $("nm-breakPx"), bpr = $("nm-breakPxRow");
        const showBp = () => { if (bpr) bpr.style.display = NMCFG.breakOnMove ? "flex" : "none"; };
        if (bom) { bom.checked = NMCFG.breakOnMove; bom.onchange = () => { NMCFG.breakOnMove = bom.checked; S.set("nmBreakOnMove", String(bom.checked)); showBp(); }; }
        if (bpx) { bpx.value = NMCFG.breakPx; bpx.onchange = () => { NMCFG.breakPx = Math.min(2000, Math.max(50, parseInt(bpx.value, 10) || 300)); bpx.value = NMCFG.breakPx; S.set("nmBreakPx", String(NMCFG.breakPx)); }; }
        showBp();
        const dg = $("nm-diagToggle"); if (dg) { dg.checked = NMCFG.diag; dg.onchange = () => { NMCFG.diag = dg.checked; S.set("nmDiag", String(dg.checked)); nmDiagTick(); }; }

        // ── Performance tab
        if (NMFPS) {
            const mode = $("nm-fpsMode"), cap = $("nm-fpsCap"), bgOn = $("nm-fpsBgOn"), bg = $("nm-fpsBg"), show = $("nm-fpsShow");
            const sync = () => {
                if (mode) mode.value = NMFPS.cfg.mode;
                if (cap) cap.value = NMFPS.cfg.cap;
                if (bgOn) bgOn.checked = NMFPS.cfg.bgOn;
                if (bg) bg.value = NMFPS.cfg.bg;
                if (show) show.checked = NMFPS.cfg.show;
                const cr = $("nm-fpsCapRow"); if (cr) cr.style.display = NMFPS.cfg.mode === "custom" ? "flex" : "none";
                const br = $("nm-fpsBgRow"); if (br) br.style.display = NMFPS.cfg.bgOn ? "flex" : "none";
            };
            sync();
            if (mode) mode.onchange = () => { NMFPS.set("mode", mode.value); sync(); };
            if (cap) cap.onchange = () => { NMFPS.set("cap", cap.value); sync(); };
            if (bgOn) bgOn.onchange = () => { NMFPS.set("bgOn", bgOn.checked); sync(); };
            if (bg) bg.onchange = () => { NMFPS.set("bg", bg.value); sync(); };
            if (show) show.onchange = () => { NMFPS.set("show", show.checked); };
            setInterval(() => { const l = $("nm-fpsLive"); const p = $("nm-tab-perf"); if (l && p && p.classList.contains("active")) l.textContent = String(NMFPS.fps()); }, 500);
        }

        // ── Packet recorder tab
        if (typeof NMREC !== "undefined") {
            const on = $("nm-recOn"), hm = $("nm-recHideMouse");
            if (on) { on.checked = NMREC.st.on; on.onchange = () => NMREC.set("on", on.checked); }
            if (hm) { hm.checked = NMREC.st.hideMouse; hm.onchange = () => NMREC.set("hideMouse", hm.checked); }
            bind("nm-recClear", "click", () => { NMREC.clear(); const l = $("nm-recList"); if (l) l.textContent = ""; });
            bind("nm-recCopy", "click", () => {
                const txt = NMREC.text();
                const fallback = () => { const ta = document.createElement("textarea"); ta.value = txt; ta.style.cssText = "position:fixed;left:-9999px"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (_) { } ta.remove(); };
                try { navigator.clipboard.writeText(txt).catch(fallback); } catch (_) { fallback(); }
                nmToast(txt ? "اتنسخ " + NMREC.st.rows.length + " سطر" : "مفيش حاجة متسجلة لسه");
            });
            setInterval(() => {
                const p = $("nm-tab-rec"); if (!p || !p.classList.contains("active")) return;
                const l = $("nm-recList"), c = $("nm-recCount");
                if (c) c.textContent = String(NMREC.st.rows.length);
                if (l) l.textContent = NMREC.st.rows.slice(-40).reverse().map(r => "[" + (r.t / 1000).toFixed(1) + "s] len=" + r.len + (r.op >= 0 ? " op=" + r.op : "") + (r.n > 1 ? " x" + r.n : "") + (r.text ? "  «" + r.text + "»" : "") + "  " + r.hex).join("\n");
            }, 600);
        }

        // ── Colors tab
        if (NMCOL) {
            [["colBall", "ball"], ["colName", "name"], ["colText", "text"]].forEach(([id, key]) => {
                const on = $("nm-" + id + "On"), col = $("nm-" + id);
                if (on) { on.checked = NMCOL.cfg[key + "On"]; on.onchange = () => NMCOL.set(key + "On", on.checked); }
                if (col) { col.value = NMCOL.cfg[key]; col.oninput = () => NMCOL.set(key, col.value); }
            });
            const all = $("nm-colAllNames"); if (all) { all.checked = NMCOL.cfg.allNames; all.onchange = () => NMCOL.set("allNames", all.checked); }
            const nm = $("nm-colMyName"); if (nm) { nm.value = NMCOL.cfg.myName; nm.oninput = () => NMCOL.set("myName", nm.value); }
            bind("nm-grabName", "click", () => {
                try {
                    const cands = Array.from(document.querySelectorAll("input[type=text],input:not([type])")).filter(i => !i.closest("#controlPanel") && i.value && i.value.trim());
                    const pick = cands.find(i => /nick|name|اسم|لقب/i.test((i.id || "") + (i.name || "") + (i.placeholder || ""))) || cands[0];
                    if (pick && nm) { nm.value = pick.value.trim(); NMCOL.set("myName", nm.value); nmToast("اتلقط الاسم: " + nm.value); }
                    else nmToast("مش لاقي خانة اسم في اللعبة - اكتبه بإيدك");
                } catch (_) { }
            });
            const sw = $("nm-ballSwatches");
            if (sw && !sw.children.length) {
                ["#00e5ff", "#ff2d55", "#7CFF4F", "#ffd400", "#b36bff", "#ff8a00", "#ffffff", "#111111"].forEach(c => {
                    const b = document.createElement("button");
                    b.className = "nm-swatch"; b.style.background = c; b.title = c;
                    b.onclick = () => { const col = $("nm-colBall"); if (col) col.value = c; NMCOL.set("ball", c); NMCOL.set("ballOn", true); const on = $("nm-colBallOn"); if (on) on.checked = true; };
                    sw.appendChild(b);
                });
            }
            setInterval(() => {
                const el = $("nm-colDiag"), p = $("nm-tab-colors");
                if (!el || !p || !p.classList.contains("active")) return;
                const d = NMCOL.diag();
                const kinds = Object.keys(d.kinds).map(k => k + "×" + d.kinds[k]).join(" ") || "لسه";
                const gl = Object.keys(d.kinds).some(k => /webgl/i.test(k));
                el.innerHTML = "نوع الرسم: <b>" + kinds + "</b>" + (gl ? " (WebGL: التلوين مش هيشتغل عليه)" : "") +
                    " | دوائر/ث: <b>" + d.arcsPerSec + "</b> | نصوص/ث: <b>" + d.textsPerSec + "</b> | كرتي: <b>" + (d.found ? "اتلقت ✔" : "لسه ✖") + "</b>";
            }, 500);
        }
        // ── Advanced tools tab: macros / alerts / profiles
        if (typeof NMMACRO !== "undefined") {
            const recBtn = $("nm-macroRecBtn"), nameInp = $("nm-macroName"), live = $("nm-macroRecLive"), liveName = $("nm-macroRecName"), liveCount = $("nm-macroRecCount");
            function renderMacros() {
                const box = $("nm-macroList"); if (!box) return;
                const items = NMMACRO.all();
                box.innerHTML = items.length ? "" : '<div class="nm-empty-state" style="padding:10px">لسه مفيش ماكروهات محفوظة</div>';
                items.forEach((m, i) => {
                    const row = document.createElement("div");
                    row.className = "nm-macro-row";
                    row.innerHTML = `<span class="nm-macro-name">${m.name} <small>(${m.steps.length} ضغطة)</small></span>
                        <button class="nm-chip-btn mini" data-act="play">▶</button>
                        <div class="nm-key-box mini" data-act="key">${m.key !== "None" ? nmKeyLabel(m.key) : "بدون"}</div>
                        <button class="nm-chip-btn mini" data-act="del">🗑</button>`;
                    row.querySelector('[data-act="play"]').onclick = () => NMMACRO.play(i);
                    row.querySelector('[data-act="del"]').onclick = () => { if (confirm("مسح الماكرو ده؟")) { NMMACRO.removeAt(i); renderMacros(); } };
                    const kb = row.querySelector('[data-act="key"]');
                    kb.onclick = () => {
                        if (_recBoxId === kb) { _stopRec(); return; }
                        _recOnComplete = (code) => { NMMACRO.setKeyFor(i, code); renderMacros(); };
                        _startRec(kb, kb);
                    };
                    box.appendChild(row);
                });
            }
            if (recBtn) recBtn.onclick = () => {
                if (NMMACRO.isRecording()) {
                    NMMACRO.stopRecord();
                    if (live) live.style.display = "none";
                    recBtn.textContent = "⏺ تسجيل";
                    renderMacros();
                } else {
                    NMMACRO.startRecord(nameInp ? nameInp.value : "");
                    if (live) live.style.display = "flex";
                    if (liveName) liveName.textContent = NMMACRO.recName();
                    recBtn.textContent = "⏹ إيقاف";
                }
            };
            setInterval(() => { if (liveCount && NMMACRO.isRecording()) liveCount.textContent = String(NMMACRO.recLen()); }, 300);
            renderMacros();
        }
        if (typeof NMCAP !== "undefined") {
            const capBtn = $("nm-capBtn"), capLive = $("nm-capLive"), capSec = $("nm-capSec");
            if (capBtn) capBtn.onclick = () => {
                if (NMCAP.isRecording()) {
                    NMCAP.stop();
                    capBtn.textContent = "⏺ ابدأ التسجيل";
                    if (capLive) capLive.style.display = "none";
                    nmToast("اتسجّل اللقطة ونزلت");
                } else {
                    if (NMCAP.start()) {
                        capBtn.textContent = "⏹ إيقاف وحفظ";
                        if (capLive) capLive.style.display = "flex";
                    } else nmToast("مش لاقي شاشة اللعبة أسجّلها");
                }
            };
            setInterval(() => { if (capSec && NMCAP.isRecording()) capSec.textContent = String(NMCAP.seconds()); }, 500);
        }
        if (typeof NMALERT !== "undefined") {
            const on = $("nm-alOn"), snd = $("nm-alSound"), grow = $("nm-alGrow"), shrink = $("nm-alShrink");
            if (on) { on.checked = NMALERT.cfg.on; on.onchange = () => NMALERT.set("on", on.checked); }
            if (snd) { snd.checked = NMALERT.cfg.sound; snd.onchange = () => NMALERT.set("sound", snd.checked); }
            if (grow) { grow.value = NMALERT.cfg.growPct; grow.onchange = () => NMALERT.set("growPct", Math.max(5, Math.min(100, parseInt(grow.value, 10) || 18))); }
            if (shrink) { shrink.value = NMALERT.cfg.shrinkPct; shrink.onchange = () => NMALERT.set("shrinkPct", Math.max(5, Math.min(100, parseInt(shrink.value, 10) || 22))); }
            bind("nm-alTest", "click", () => NMALERT.testSound());
        }
        if (typeof NMPROFILES !== "undefined") {
            const profInp = $("nm-profName");
            function renderProfiles() {
                const box = $("nm-profList"); if (!box) return;
                const names = NMPROFILES.names();
                box.innerHTML = names.length ? "" : '<div class="nm-empty-state" style="padding:10px">لسه مفيش بروفايلات محفوظة</div>';
                names.forEach(name => {
                    const row = document.createElement("div");
                    row.className = "nm-macro-row";
                    row.innerHTML = `<span class="nm-macro-name">${name}</span>
                        <button class="nm-chip-btn mini" data-act="load">تحميل</button>
                        <button class="nm-chip-btn mini" data-act="del">🗑</button>`;
                    row.querySelector('[data-act="load"]').onclick = () => { if (NMPROFILES.load(name)) nmToast("اتحمّل بروفايل: " + name); };
                    row.querySelector('[data-act="del"]').onclick = () => { if (confirm("مسح البروفايل ده؟")) { NMPROFILES.remove(name); renderProfiles(); } };
                    box.appendChild(row);
                });
            }
            bind("nm-profSaveBtn", "click", () => {
                const name = profInp ? profInp.value : "";
                if (!name || !name.trim()) { nmToast("اكتب اسم للبروفايل الأول"); return; }
                NMPROFILES.saveAs(name);
                if (profInp) profInp.value = "";
                renderProfiles();
                nmToast("اتحفظ البروفايل");
            });
            renderProfiles();
        }
        try { nmRefreshPageLabels(); } catch (_) { }
    } catch (_) { }
}

function nmExportExtra() {
    const keys = ["nmReleaseKey", "nmDblMs", "nmBreakOnMove", "nmBreakPx", "fpsMode", "fpsCap", "fpsBgOn", "fpsBg", "fpsShow", "colBallOn", "colBall", "colNameOn", "colName", "colTextOn", "colText", "colAllNames", "colMyName", "skipResults", "alOn", "alGrowPct", "alShrinkPct", "alSound"];
    const o = {};
    keys.forEach(k => { const v = S.get(k, null); if (v !== null) o[k] = v; });
    return o;
}
function nmImportExtra(o) {
    if (!o || typeof o !== "object") return;
    Object.keys(o).forEach(k => { S.set(k, String(o[k])); });
    try { nmReleaseKey = S.get("nmReleaseKey", "None") || "None"; } catch (_) { }
    try { NMCFG.dblMs = parseInt(S.get("nmDblMs", "700"), 10) || 700; NMCFG.breakOnMove = S.get("nmBreakOnMove", "false") === "true"; NMCFG.breakPx = parseInt(S.get("nmBreakPx", "300"), 10) || 300; } catch (_) { }
    try { if (NMFPS) { NMFPS.set("mode", S.get("fpsMode", "unlimited")); NMFPS.set("cap", S.get("fpsCap", "240")); NMFPS.set("bgOn", S.get("fpsBgOn", "true") !== "false"); NMFPS.set("bg", S.get("fpsBg", "60")); NMFPS.set("show", S.get("fpsShow", "false") === "true"); } } catch (_) { }
    try { if (NMCOL) { NMCOL.set("ballOn", S.get("colBallOn", "false") === "true"); NMCOL.set("ball", S.get("colBall", "#00e5ff")); NMCOL.set("nameOn", S.get("colNameOn", "false") === "true"); NMCOL.set("name", S.get("colName", "#ffe600")); NMCOL.set("textOn", S.get("colTextOn", "false") === "true"); NMCOL.set("text", S.get("colText", "#ffffff")); NMCOL.set("allNames", S.get("colAllNames", "false") === "true"); NMCOL.set("myName", S.get("colMyName", "")); } } catch (_) { }
    try { nmDedupeKeys(); nmInitV32UI(); } catch (_) { }
}

function setupFocusSignalListener() {
    try {
        window.addEventListener('storage', nativeify((ev) => {
            try {
                if (ev.key !== SIGNAL_KEY) return;
                const o = ev.newValue ? JSON.parse(ev.newValue) : null;
                if (o && typeof o === 'object' && o.to === myId) {
                    freezeMouseTemporarily(500);
                    try { window.focus(); } catch (_) { }
                }
            } catch (_) { }
        }, 'storageSignal'));
    } catch (_) { }
}
function nextSeq() {
    try {
        const e = 1 + (S.get(SEQ_KEY, 0) | 0);
        S.set(SEQ_KEY, e);
        return e;
    } catch (_) { return 0; }
}
window.freezeMouseTracking = window.freezeMouseTracking || false;
let freezeTimeout = null;
function freezeMouseTemporarily(e = 1500) {
    try {
        window.freezeMouseTracking = true;
        if (freezeTimeout) { try { clearTimeout(freezeTimeout); } catch (_) { } }
        try { document.body.style.pointerEvents = "none"; } catch (_) { }
        freezeTimeout = setTimeout(nativeify(() => {
            try {
                window.freezeMouseTracking = false;
                document.body.style.pointerEvents = "";
            } catch (_) { }
        }), e);
    } catch (_) { }
}
const blockMouseDuringFreeze = nativeify(function blockMouseDuringFreeze(e) {
    try {
        if (window.freezeMouseTracking) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }
    } catch (_) { }
}, 'blockMouseDuringFreeze');
try { document.addEventListener("mousemove", blockMouseDuringFreeze, true); } catch (_) { }
try { document.addEventListener("mouseenter", blockMouseDuringFreeze, true); } catch (_) { }
try { document.addEventListener("mouseover", blockMouseDuringFreeze, true); } catch (_) { }
try { document.addEventListener("mouseout", blockMouseDuringFreeze, true); } catch (_) { }
try { document.addEventListener("mouseleave", blockMouseDuringFreeze, true); } catch (_) { }
const originalAddEventListener = document.addEventListener;
function signalPeer(e) {
    try {
        if (!e) return;
        const t = nextSeq();
        S.set(SIGNAL_KEY, JSON.stringify({ to: e, from: myId, seq: t, ts: Date.now() }));
    } catch (_) { }
}
function getPair() {
    try {
        const raw = S.get(PAIR_KEY, null);
        if (!raw) return null;
        const e = typeof raw === 'object' ? raw : JSON.parse(raw);
        return (e && typeof e === 'object') ? e : null;
    } catch (_) { return null; }
}
function hasActivePair() {
    try {
        const e = getPair();
        return !!e && !!e.token && (e.a === myId || e.b === myId);
    } catch (_) { return false; }
}
function getPeerId() {
    try {
        const e = getPair();
        if (e) {
            if (e.a === myId) { return e.b || null; }
            else { return e.b === myId && e.a || null; }
        }
        return null;
    } catch (_) { return null; }
}
function maybeClaimPairFromHash() {
    try {
        const e = String(location.hash || "").match(/(?:^|[#&?])paired=([a-z0-9]+)/i);
        if (!e) return;
        const t = e[1];
        let o = getPair();
        if (o && o.token === t) {
            if (!o.b || o.b === myId) {
                if (o.a !== myId) {
                    o = { ...o, b: myId };
                    S.set(PAIR_KEY, JSON.stringify(o));
                }
            }
        }
    } catch (_) { }
}
document.addEventListener = nativeify(function addEventListener(e, t, o) {
    try {
        if (!window.freezeMouseTracking || e !== "mousemove" && e !== "mouseenter" && e !== "mouseover") {
            return originalAddEventListener.call(this, e, t, o);
        }
    } catch (_) { }
}, 'addEventListener');
window.focusPeer = nativeify(function focusPeer() {
    try {
        const e = getPair();
        if (!e || !e.token) return;
        freezeMouseTemporarily(2000);
        if (openedTabHandle && !openedTabHandle.closed) {
            try { openedTabHandle.focus(); return; } catch (_) { }
        }
        const t = getPeerId();
        if (t) signalPeer(t);
    } catch (_) { }
}, 'focusPeer');
window.openPairedTab = nativeify(function openPairedTab(e) {
    try {
        if (!myId) return;
        const t = Math.random().toString(36).slice(2);
        const o = e || location.origin + "/";
        const n = o + (o.includes("#") ? "&" : "#") + "paired=" + t + "&nmpage=" + nmOtherPage();
        S.set(PAIR_KEY, JSON.stringify({ a: myId, b: null, url: o, token: t, createdAt: Date.now() }));
        try {
            openedTabHandle = window.open(n, '_blank');
            if (openedTabHandle) { try { openedTabHandle.focus(); } catch (_) { } }
        } catch (_) { }
    } catch (_) { }
}, 'openPairedTab');
const MIG_KEYS = ["customizations", "textColor", "buttonColor", "backgroundColor", "panelBackgroundImage", "buttonBackgroundImage", "buttonShape", "buttonSize", "oppositeHashName", "controlButtonPosition", "movementLeftEnabled", "movementLeftKey", "movementLeftPage", "movementRightEnabled", "movementRightKey", "movementRightPage", "movementUpEnabled", "movementUpKey", "movementUpPage", "movementDownEnabled", "movementDownKey", "movementDownPage", "movementTopLeftEnabled", "movementTopLeftKey", "movementTopLeftPage", "movementTopRightEnabled", "movementTopRightKey", "movementTopRightPage", "movementBottomLeftEnabled", "movementBottomLeftKey", "movementBottomLeftPage", "movementBottomRightEnabled", "movementBottomRightKey", "movementBottomRightPage", "normalBottomLeftEnabled", "normalBottomLeftKey", "normalBottomLeftPage", "normalMiddleBottomEnabled", "normalMiddleBottomKey", "normalMiddleBottomPage", "normalBottomRightEnabled", "normalBottomRightKey", "normalBottomRightPage", "normalLeftEnabled", "normalLeftKey", "normalLeftPage", "normalCenterEnabled", "normalCenterKey", "normalCenterPage", "normalRightEnabled", "normalRightKey", "normalRightPage", "normalTopLeftEnabled", "normalTopLeftKey", "normalTopLeftPage", "normalTopEnabled", "normalTopKey", "normalTopPage", "normalTopRightEnabled", "normalTopRightKey", "normalTopRightPage", "normalTopcEnabled", "normalTopcKey", "normalTopcPage", "timerEnabled", "timerColorMode", "timerFixedColor"];
// Migration: copy any keys from old GM storage to localStorage (now no-op since both use localStorage)
// Left as comment for backward compat
let settingsChannel = new BroadcastChannel("settings_channel");
let actionChannel = new BroadcastChannel("action_channel");
let customizations = [];
let canvasElement = null;
let activeCustomizations = {};
let intervals = {};
let panelBackgroundImage = null;
let buttonBackgroundImage = null;
let buttonShape = "rectangle";
let buttonSize = "medium";
let oppositeHashName = "dream-land";
let movementLeftEnabled = false;
let movementLeftKey = "None";
let movementLeftPage = "current";
let movementRightEnabled = false;
let movementRightKey = "None";
let movementRightPage = "current";
let movementUpEnabled = false;
let movementUpKey = "None";
let movementUpPage = "current";
let movementDownEnabled = false;
let movementDownKey = "None";
let movementDownPage = "current";
let movementTopLeftEnabled = false;
let movementTopLeftKey = "None";
let movementTopLeftPage = "current";
let movementTopRightEnabled = false;
let movementTopRightKey = "None";
let movementTopRightPage = "current";
let movementBottomLeftEnabled = false;
let movementBottomLeftKey = "None";
let movementBottomLeftPage = "current";
let movementBottomRightEnabled = false;
let movementBottomRightKey = "None";
let movementBottomRightPage = "current";
let normalBottomLeftEnabled = false;
let normalBottomLeftKey = "None";
let normalBottomLeftPage = "current";
let normalMiddleBottomEnabled = false;
let normalMiddleBottomKey = "None";
let normalMiddleBottomPage = "current";
let normalBottomRightEnabled = false;
let normalBottomRightKey = "None";
let normalBottomRightPage = "current";
let normalLeftEnabled = false;
let normalLeftKey = "None";
let normalLeftPage = "current";
let normalCenterEnabled = false;
let normalCenterKey = "None";
let normalCenterPage = "current";
let normalRightEnabled = false;
let normalRightKey = "None";
let normalRightPage = "current";
let normalTopLeftEnabled = false;
let normalTopLeftKey = "None";
let normalTopLeftPage = "current";
let normalTopEnabled = false;
let normalTopKey = "None";
let normalTopPage = "current";
let normalTopRightEnabled = false;
let normalTopRightKey = "None";
let normalTopRightPage = "current";
let normalTopcEnabled = false;
let normalTopcKey = "None";
let normalTopcPage = "current";
let timerEnabled = false;
let timerColorMode = "random";
let timerFixedColor = "#FFFFFF";
let gmOppositeTabHandle = null;
let hookingSuccess = false;
// WS is auto-updated in document.cachedWS by the game
function getLastWS() {
    try {
        // Try both casings — game may set either
        const ws = document.cachedWS || document.cachedWs
            || window.gfokhokgkhgfdfghfghfghghfokhfgdokhfgokh
            || window.ghfdh4hg5hgfghhghghfghghffdg
            || null;
        return ws;
    } catch (_) { return null; }
}
function startWSMonitoring() { /* no-op: WS is auto-updated on document */ }
function updateHIndicatorColor() {
    try {
        const e = document.getElementById("HIndicator");
        if (!e) return;
        const t = getLastWS();
        hookingSuccess = t && t.readyState === WebSocket.OPEN;
        if (hookingSuccess) { e.classList.add("connected"); }
        else { e.classList.remove("connected"); }
    } catch (_) { }
}

// Continuous movement packet injection for perfectly stable lines
nmTicker(nativeify(() => {
    try {
        if (!window.activeMovementLock && !window.activeNormalLock) return;
        const c = nmLockCoords();
        if (c) sendMovePacket(c.x, c.y);
    } catch (_) { }
}, 'movementLoop'), 20);
const knownWsMessages = [{
    label: "None (لا شيء)",
    value: "None"
}, {
    label: "انقسام البوت",
    value: "0x16"
}, {
    label: "فيد البوت",
    value: "0x17"
}, {
    label: "فيد عادي",
    value: "0x15"
}, {
    label: "فيد سريع",
    value: "0x1a"
}, {
    label: "سبيس (Space)",
    value: "0x11"
}, {
    label: "split 4",
    value: "0x1b"
}, {
    label: "split 16",
    value: "0x1c"
}, {
    label: "split 32",
    value: "0x1d"
}, {
    label: "split 64",
    value: "0x1e"
}];
const UINT8_CACHE = {
    1: new Uint8Array([1]),
    17: new Uint8Array([17]),
    21: new Uint8Array([21]),
    18: new Uint8Array([18]),
    19: new Uint8Array([19]),
    22: new Uint8Array([22]),
    23: new Uint8Array([23]),
    24: new Uint8Array([24]),
    25: new Uint8Array([25]),
    26: new Uint8Array([26]),
    27: new Uint8Array([27]),
    28: new Uint8Array([28]),
    29: new Uint8Array([29]),
    30: new Uint8Array([30]),
    254: new Uint8Array([254])
};
function sendGamePacket(e) {
    try {
        const t = getLastWS();
        if (!t) {
            return false;
        }
        try { updateHIndicatorColor(); } catch (_) { }
        let o = typeof e == "string" ? e.startsWith("0x") || e.startsWith("0X") ? parseInt(e, 16) : parseInt(e, 10) : Number(e);
        if (!Number.isFinite(o) || o < 0 || o > 255) {
            return false;
        }
        const n = new Uint8Array([o & 255]);
        const a = n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength);
        if (t.readyState === WebSocket.OPEN) {
            try {
                t.send(a);
                return true;
            } catch (e) {
                return false;
            }
        }
        if (t.readyState === WebSocket.CONNECTING) {
            const e = () => {
                try {
                    t.send(a);
                } catch (e) { } finally {
                    try {
                        t.removeEventListener("open", e);
                    } catch (e) { }
                }
            };
            try {
                t.addEventListener("open", e);
            } catch (e) { }
            return true;
        }
        return false;
    } catch (_) { return false; }
}

// ── pkt_move: opcode 16 move packet — matches Python's pkt_move(x, y) ──
// Packet: [0x10, x(i32le), y(i32le), 0x00000000] = 9 bytes
function pkt_move(x, y) {
    try {
        // Matches Python: struct.pack("<B ii I", 16, x, y, 0) = 13 bytes
        // B=opcode(1) + i=x(4) + i=y(4) + I=padding(4) = 13
        const buf = new ArrayBuffer(13);
        const view = new DataView(buf);
        view.setUint8(0, 16);           // opcode 16 = 0x10
        view.setInt32(1, x, true);      // x as signed int32 little-endian
        view.setInt32(5, y, true);      // y as signed int32 little-endian
        view.setUint32(9, 0, true);     // 4-byte zero padding (the "I" in "<B ii I")
        return buf;
    } catch (_) { return null; }
}
function sendMovePacket(x, y) {
    try {
        const ws = getLastWS();
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        const pkt = pkt_move(x, y);
        if (!pkt) return false;
        ws.send(pkt);
        return true;
    } catch (_) { return false; }
}
let settingsChannelLocal = settingsChannel;
let actionChannelLocal = actionChannel;
function executeReceivedActions(e) {
    try {
        let t = 0;
        (function o() {
            try {
                if (!(t >= e.length)) {
                    try { sendBinaryMessage(e[t].message); } catch (_) { }
                    t++;
                    setTimeout(nativeify(o, 'recvActions'), 50);
                }
            } catch (_) { }
        })();
    } catch (_) { }
}
function sendBinaryMessage(e) {
    try {
        if (e !== "None") { sendGamePacket(e); }
    } catch (_) { }
}

// ── Load images from IndexedDB after UI is ready ─────────────────────────
function _loadStoredImages() {
    try {
        ImageStore.get("buttonBackgroundImage").then(img => {
            try {
                if (!img) return;
                buttonBackgroundImage = img;
                const circle = document.getElementById("nm-floating-circle");
                if (circle) circle.style.backgroundImage = `url(${img})`;
            } catch (_) { }
        }).catch(() => { });
        ImageStore.get("panelBackgroundImage").then(img => {
            try {
                if (!img) return;
                panelBackgroundImage = img;
                const panel = document.getElementById("controlPanel");
                if (panel) {
                    panel.style.backgroundImage = `linear-gradient(rgba(26,26,36,0.85),rgba(15,15,19,0.95)),url(${img})`;
                    panel.style.backgroundSize = "cover";
                    panel.style.backgroundPosition = "center";
                }
            } catch (_) { }
        }).catch(() => { });
    } catch (_) { }
}
function init() {
    try {
        if (window.__nmInited) return true;
        if (!document.body) return false;
        window.__nmInited = true;
        const run = (name, fn) => { try { fn(); } catch (e) { try { console.error("[MTC 3.2] خطأ في: " + name, e); } catch (_) { } } };
        run("loadStoredCustomizations", loadStoredCustomizations);
        run("loadAllStyle", loadAllStyle);
        run("createControlPanel", createControlPanel);
        run("createControlButton", createControlButton);
        run("nmInitV32UI", nmInitV32UI);
        run("NMAUTH.applyPermissionUI", () => NMAUTH.applyPermissionUI());
        run("applyStoredCustomizations", applyStoredCustomizations);
        run("addEventListeners", addEventListeners);
        run("loadStoredImages", _loadStoredImages);
        run("observeCanvas", observeCanvas);
        run("observeChatMessages", observeChatMessages);
        run("hIndicator", () => setInterval(nativeify(updateHIndicatorColor, 'hIndicator'), 1000));
        setTimeout(nmDedupeKeys, 800);
        try { console.log("[MTC 3.2] جاهز - صفحة " + myPage); } catch (_) { }
        return true;
    } catch (e) {
        try { console.error("[MTC 3.2] init failed", e); } catch (_) { }
        return false;
    }
}
function initWithRetry(e = 20, t = 1) {
    try {
        if (!init() && !(t >= e)) {
            setTimeout(nativeify(() => {
                try { initWithRetry(e, t + 1); } catch (_) { }
            }, 'initRetry'), 1000);
        }
    } catch (_) { }
}
function observeCanvas() {
    try {
        const e = new MutationObserver(nativeify(() => {
            try {
                const t = document.querySelector("canvas");
                if (t) { canvasElement = t; try { e.disconnect(); } catch (_) { } }
            } catch (_) { }
        }));
        try { e.observe(document.body, { childList: true, subtree: true }); } catch (_) { }
    } catch (_) { }
}
function loadStoredCustomizations() {
    try {
        let e = S.get("customizations", null);
        if (e) {
            try { customizations = JSON.parse(e); } catch (_) { }
        }
        let t = S.get("textColor", null);
        if (t) {
            document.documentElement.style.setProperty("--text-color", t);
        }
        let o = S.get("buttonColor", null);
        if (o) {
            document.documentElement.style.setProperty("--button-color", o);
        }
        let n = S.get("backgroundColor", null);
        if (n) {
            document.documentElement.style.setProperty("--background-color", n);
        }
        // Images are stored in IndexedDB (no size limit) - load them async after DOM is ready
        // panelBackgroundImage and buttonBackgroundImage will be populated by _loadStoredImages()
        let i = S.get("buttonShape", null);
        if (i) {
            buttonShape = i;
        }
        let m = S.get("buttonSize", null);
        if (m) {
            buttonSize = m;
        }
        let r = S.get("oppositeHashName", null);
        if (r) {
            oppositeHashName = r;
        }
        let d = S.get("movementLeftEnabled", null);
        if (d) {
            movementLeftEnabled = d === "true";
        }
        let s = S.get("movementLeftKey", null);
        if (s) {
            movementLeftKey = s;
        }
        let c = S.get("movementLeftPage", null);
        if (c) {
            movementLeftPage = c;
        }
        let g = S.get("movementRightEnabled", null);
        if (g) {
            movementRightEnabled = g === "true";
        }
        let u = S.get("movementRightKey", null);
        if (u) {
            movementRightKey = u;
        }
        let p = S.get("movementRightPage", null);
        if (p) {
            movementRightPage = p;
        }
        let b = S.get("movementUpEnabled", null);
        if (b) {
            movementUpEnabled = b === "true";
        }
        let h = S.get("movementUpKey", null);
        if (h) {
            movementUpKey = h;
        }
        let y = S.get("movementUpPage", null);
        if (y) {
            movementUpPage = y;
        }
        let f = S.get("movementDownEnabled", null);
        if (f) {
            movementDownEnabled = f === "true";
        }
        let v = S.get("movementDownKey", null);
        if (v) {
            movementDownKey = v;
        }
        let E = S.get("movementDownPage", null);
        if (E) {
            movementDownPage = E;
        }
        let L = S.get("movementTopLeftEnabled", null);
        if (L) {
            movementTopLeftEnabled = L === "true";
        }
        let k = S.get("movementTopLeftKey", null);
        if (k) {
            movementTopLeftKey = k;
        }
        let B = S.get("movementTopLeftPage", null);
        if (B) {
            movementTopLeftPage = B;
        }
        let T = S.get("movementTopRightEnabled", null);
        if (T) {
            movementTopRightEnabled = T === "true";
        }
        let R = S.get("movementTopRightKey", null);
        if (R) {
            movementTopRightKey = R;
        }
        let P = S.get("movementTopRightPage", null);
        if (P) {
            movementTopRightPage = P;
        }
        let K = S.get("movementBottomLeftEnabled", null);
        if (K) {
            movementBottomLeftEnabled = K === "true";
        }
        let C = S.get("movementBottomLeftKey", null);
        if (C) {
            movementBottomLeftKey = C;
        }
        let x = S.get("movementBottomLeftPage", null);
        if (x) {
            movementBottomLeftPage = x;
        }
        let w = S.get("movementBottomRightEnabled", null);
        if (w) {
            movementBottomRightEnabled = w === "true";
        }
        let I = S.get("movementBottomRightKey", null);
        if (I) {
            movementBottomRightKey = I;
        }
        let M = S.get("movementBottomRightPage", null);
        if (M) {
            movementBottomRightPage = M;
        }
        let _ = S.get("normalBottomLeftEnabled", null);
        if (_) {
            normalBottomLeftEnabled = _ === "true";
        }
        let D = S.get("normalBottomLeftKey", null);
        if (D) {
            normalBottomLeftKey = D;
        }
        let z = S.get("normalBottomLeftPage", null);
        if (z) {
            normalBottomLeftPage = z;
        }
        let N = S.get("normalMiddleBottomEnabled", null);
        if (N) {
            normalMiddleBottomEnabled = N === "true";
        }
        let F = S.get("normalMiddleBottomKey", null);
        if (F) {
            normalMiddleBottomKey = F;
        }
        let U = S.get("normalMiddleBottomPage", null);
        if (U) {
            normalMiddleBottomPage = U;
        }
        let A = S.get("normalBottomRightEnabled", null);
        if (A) {
            normalBottomRightEnabled = A === "true";
        }
        let $ = S.get("normalBottomRightKey", null);
        if ($) {
            normalBottomRightKey = $;
        }
        let H = S.get("normalBottomRightPage", null);
        if (H) {
            normalBottomRightPage = H;
        }
        let W = S.get("normalLeftEnabled", null);
        if (W) {
            normalLeftEnabled = W === "true";
        }
        let O = S.get("normalLeftKey", null);
        if (O) {
            normalLeftKey = O;
        }
        let q = S.get("normalLeftPage", null);
        if (q) {
            normalLeftPage = q;
        }
        let j = S.get("normalCenterEnabled", null);
        if (j) {
            normalCenterEnabled = j === "true";
        }
        let Y = S.get("normalCenterKey", null);
        if (Y) {
            normalCenterKey = Y;
        }
        let G = S.get("normalCenterPage", null);
        if (G) {
            normalCenterPage = G;
        }
        let J = S.get("normalRightEnabled", null);
        if (J) {
            normalRightEnabled = J === "true";
        }
        let X = S.get("normalRightKey", null);
        if (X) {
            normalRightKey = X;
        }
        let V = S.get("normalRightPage", null);
        if (V) {
            normalRightPage = V;
        }
        let Q = S.get("normalTopLeftEnabled", null);
        if (Q) {
            normalTopLeftEnabled = Q === "true";
        }
        let Z = S.get("normalTopLeftKey", null);
        if (Z) {
            normalTopLeftKey = Z;
        }
        let ee = S.get("normalTopLeftPage", null);
        if (ee) {
            normalTopLeftPage = ee;
        }
        let te = S.get("normalTopEnabled", null);
        if (te) {
            normalTopEnabled = te === "true";
        }
        let oe = S.get("normalTopKey", null);
        if (oe) {
            normalTopKey = oe;
        }
        let ne = S.get("normalTopPage", null);
        if (ne) {
            normalTopPage = ne;
        }
        let ae = S.get("normalTopRightEnabled", null);
        if (ae) {
            normalTopRightEnabled = ae === "true";
        }
        let le = S.get("normalTopRightKey", null);
        if (le) {
            normalTopRightKey = le;
        }
        let ie = S.get("normalTopRightPage", null);
        if (ie) {
            normalTopRightPage = ie;
        }
        let me = S.get("normalTopcEnabled", null);
        if (me) {
            normalTopcEnabled = me === "true";
        }
        let re = S.get("normalTopcKey", null);
        if (re) {
            normalTopcKey = re;
        }
        let de = S.get("normalTopcPage", null);
        if (de) {
            normalTopcPage = de;
        }
        let se = S.get("timerEnabled", null);
        if (se) {
            timerEnabled = se === "true";
        }
        let ce = S.get("timerColorMode", null);
        if (ce) {
            timerColorMode = ce;
        }
        let ge = S.get("timerFixedColor", null);
        if (ge) {
            timerFixedColor = ge;
        }
    } catch (_) { }
}
function _buildLinesRows(directions, idPrefix, labelFn) {
    return directions.map(dir => {
        return `
          <div class="nm-line-row">
            <div class="nm-line-name">${labelFn(dir)}</div>
            <span class="nm-line-state nm-st-off" data-dir="${dir}" data-st="off">—</span>
            <label class="nm-toggle-switch"><input type="checkbox" id="${idPrefix}${dir}Enabled"><span class="nm-slider"></span></label>
            <select class="nm-mini-select" id="${idPrefix}${dir}PageSelect">
              <option value="current">الحالية</option><option value="opposite">المعاكسة</option><option value="both">كلاهما</option>
            </select>
            <button class="nm-btn-rec" data-boxid="${idPrefix}${dir}KeyBox">REC</button>
            <div class="nm-key-box" id="${idPrefix}${dir}KeyBox"></div>
          </div>`;
    }).join("");
}

function createControlPanel() {
    try {
        const panel = document.createElement("div");
        panel.id = "controlPanel";
        panel.className = "nm-menu-container";
        panel.setAttribute("dir", "rtl");

        const movDirs = ["Right", "Left", "Up", "Down", "TopLeft", "TopRight", "BottomLeft", "BottomRight"];

        panel.innerHTML = `
      <button class="nm-close-btn" id="nm-closePanelBtn">&times;</button>
      <button class="nm-special-top-btn" id="nm-openOppositePage">فتح الصفحة الأخرى</button>

      <div class="nm-menu-header">
        <h2>إضافة <span>الصفحتين</span></h2>
        <div class="nm-page-chip">أنت في صفحة رقم <b id="nm-page-chip-num">1</b></div>
      </div>

      <div class="nm-menu-body">
        <div class="nm-side-nav">
          <button class="nm-tab-btn active" data-tab="nm-tab-settings" title="الإعدادات">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          <button class="nm-tab-btn" data-tab="nm-tab-customizations" title="تخصيصات">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
          </button>
          <button class="nm-tab-btn" data-tab="nm-tab-lines" title="اللاينات">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
          </button>
          <button class="nm-tab-btn" data-tab="nm-tab-perf" title="الأداء والفريمات">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </button>
          <button class="nm-tab-btn" data-tab="nm-tab-colors" title="الألوان">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16c3 0 6-2.5 6-5.5C22 6 17.5 2 12 2z"/></svg>
          </button>
          <button class="nm-tab-btn" data-tab="nm-tab-rec" title="مسجّل الحزم">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/></svg>
          </button>
          <button class="nm-tab-btn" data-tab="nm-tab-adv" title="أدوات متقدمة">
            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </button>
        </div>

        <div class="nm-tab-content-container">

          <!-- Settings Tab -->
          <div id="nm-tab-settings" class="nm-tab-pane active">
            <div class="nm-action-buttons-row">
              <button class="nm-btn-main" id="nm-exportSettingsBtn">📤 تصدير الإعدادات</button>
              <button class="nm-btn-main" id="nm-importSettingsBtn">📥 استيراد الإعدادات</button>
              <input type="file" id="nm-importSettingsFile" accept=".json" style="display:none;">
            </div>
            <div style="display:flex;gap:15px;" dir="rtl">
              <div class="nm-timer-box">
                <h3>تايمر</h3>
                <label class="nm-toggle-switch"><input type="checkbox" id="timerEnabled"><span class="nm-slider"></span></label>
              </div>
              <div class="nm-timer-box" id="timerSettingsContainer" style="display:none;">
                <h3>لون العداد</h3>
                <select id="timerColorMode" class="nm-mini-select" style="width:90px;">
                  <option value="random">عشوائي</option>
                  <option value="fixed">ثابت</option>
                </select>
                <input type="color" id="timerFixedColor" value="#FFFFFF" style="display:none;width:26px;height:26px;border:none;padding:0;background:none;cursor:pointer;">
              </div>
            </div>
            <div class="nm-timer-box nm-skip-box" dir="rtl">
              <h3>تخطي شاشة الاستمرار</h3>
              <label class="nm-toggle-switch"><input type="checkbox" id="nm-skipResults"><span class="nm-slider"></span></label>
            </div>
            <div class="nm-colors-box" dir="rtl">
              <h3>ألوان الإضافة والخطوط</h3>
              <div class="nm-color-pickers-group">
                <div class="nm-color-wrapper" title="لون القائمة"><input type="color" id="nm-color-menu-bg" value="#1a1a24"></div>
                <div class="nm-color-wrapper" title="لون الظل"><input type="color" id="nm-color-menu-shadow" value="#e53935"></div>
                <div class="nm-color-wrapper" title="لون الدائرة"><input type="color" id="nm-color-circle-bg" value="#e53935"></div>
                <div class="nm-color-wrapper" title="اللون الأساسي"><input type="color" id="nm-color-primary" value="#e53935"></div>
                <div class="nm-color-wrapper" title="لون النص الأساسي"><input type="color" id="nm-color-text-light" value="#ffffff"></div>
                <div class="nm-color-wrapper" title="لون النص الثانوي"><input type="color" id="nm-color-text-dim" value="#a0a0b0"></div>
                <div class="nm-color-wrapper" title="زر الصفحة الأخرى"><input type="color" id="nm-color-special-btn" value="#ffffff"></div>
              </div>
            </div>
            <div class="nm-upload-group">
              <label class="nm-upload-label"><input type="file" id="nm-buttonBackgroundImage" accept="image/*"><span>خلفية الدائرة</span></label>
              <label class="nm-upload-label"><input type="file" id="nm-panelBackgroundImage" accept="image/*"><span>خلفية الإضافة</span></label>
            </div>
          </div>

          <!-- Customizations Tab -->
          <div id="nm-tab-customizations" class="nm-tab-pane">
            <div class="nm-tab-header" dir="rtl">
              <button class="nm-btn-main" id="nm-createCustomization" style="flex:none;width:auto;height:32px;font-size:12px;padding:0 15px;">إنشاء تخصيص جديد</button>
            </div>
            <div class="nm-customizations-list" id="customizationsContainer" dir="rtl"></div>
            <div class="nm-empty-state" id="nm-cust-empty-state">لا يوجد تخصيصات (إضغط على إنشاء)</div>
          </div>

          <!-- Lines Tab -->
          <div id="nm-tab-lines" class="nm-tab-pane" dir="rtl">
            <div class="nm-lines-hint"><span>ضغطة واحدة = لاين قوي</span><span class="pin">ضغطتين سريعين = 📌 تثبيت</span><span>ضغطة تانية = إيقاف</span></div>
            <div class="nm-lines-toolbar">
              <button class="nm-chip-btn primary" id="nm-guidedSetup">⚡ ضبط سريع للمفاتيح</button>
              <button class="nm-chip-btn" id="nm-clearKeys">🧹 مسح كل المفاتيح</button>
              <button class="nm-chip-btn" id="nm-releaseAllBtn">⛔ فك كل اللاينات</button>
            </div>
            <div class="nm-lines-container">
              <div class="nm-lines-column">
                <div class="nm-lines-title">اللاينات</div>
                ${_buildLinesRows(movDirs, "movement", getDirectionLabel)}
                <div class="nm-line-row nm-release-row">
                  <div class="nm-line-name">فك كل اللاينات</div>
                  <span class="nm-line-extra">زر طوارئ</span>
                  <button class="nm-btn-rec" id="nmReleaseRec">REC</button>
                  <div class="nm-key-box" id="nmReleaseKeyBox"></div>
                </div>
                <div class="nm-opts">
                  <div class="nm-opt"><span>مهلة الضغطتين (ملّي ثانية)</span><input type="number" id="nm-dblMs" class="nm-dark-input mini" min="200" max="1500" step="50"></div>
                  <div class="nm-opt"><span>فك اللاين العادي بحركة الماوس</span><label class="nm-toggle-switch"><input type="checkbox" id="nm-breakOnMove"><span class="nm-slider"></span></label></div>
                  <div class="nm-opt" id="nm-breakPxRow"><span>مسافة الفك (بكسل)</span><input type="number" id="nm-breakPx" class="nm-dark-input mini" min="50" max="2000" step="50"></div>
                  <div class="nm-opt"><span>وضع التشخيص (شريط معلومات تحت)</span><label class="nm-toggle-switch"><input type="checkbox" id="nm-diagToggle"><span class="nm-slider"></span></label></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Performance Tab -->
          ${nmPerfPaneHTML()}

          <!-- Colors Tab -->
          ${nmColorsPaneHTML()}

          <!-- Recorder Tab -->
          ${nmRecPaneHTML()}

          <!-- Advanced Tools Tab -->
          ${nmAdvPaneHTML()}

          <!-- Customization Modal (inside content container) -->
          <div id="nm-customization-modal" class="nm-modal" dir="rtl">
            <div class="nm-modal-header"><h3 id="nm-modal-title">إنشاء تخصيص جديد</h3></div>
            <div class="nm-modal-body">
              <div class="nm-modal-row">
                <span class="nm-row-label">إسم التخصيص</span>
                <input type="text" id="nm-customizationName" class="nm-dark-input" placeholder="أدخل الإسم...">
              </div>
              <div class="nm-modal-row">
                <span class="nm-row-label">زر التشغيل</span>
                <div class="nm-controls-group">
                  <button class="nm-btn-rec" id="nm-shortcutRecBtn">REC</button>
                  <div class="nm-key-box" id="nm-customizationShortcutBox"></div>
                  <input type="hidden" id="nm-customizationShortcut" value="None">
                </div>
              </div>
              <div class="nm-modal-row">
                <span class="nm-row-label">حالة التنفيذ</span>
                <div class="nm-segment-control">
                  <div class="nm-segment-item"><input type="radio" id="nm-exec-once" name="nm-cust-exec" value="once" checked><label for="nm-exec-once">مرة واحدة</label></div>
                  <div class="nm-segment-item"><input type="radio" id="nm-exec-cont" name="nm-cust-exec" value="continuous"><label for="nm-exec-cont">مستمر</label></div>
                </div>
                <div class="nm-timer-mini-group" id="nm-continuousIntervalContainer" style="display:none;">
                  <input type="number" id="nm-continuousInterval" class="nm-dark-input mini" value="50" min="10">
                  <span class="nm-ms-text">ملّي ثانية</span>
                </div>
              </div>
              <div class="nm-modal-row">
                <button class="nm-btn-main" id="nm-addAction" style="flex:none;width:auto;font-size:11px;height:28px;padding:0 12px;">+ إضافة إجراء</button>
              </div>
              <div class="nm-actions-list" id="nm-actionsContainer"></div>
            </div>
            <div class="nm-modal-footer">
              <button class="nm-btn-main" id="nm-saveCustomization" style="height:30px;font-size:12px;padding:0 16px;">إنشاء</button>
              <button class="nm-btn-icon nm-danger-icon" id="nm-cancelCustomization" style="font-size:14px;background:rgba(0,0,0,0.3);padding:5px 10px;border-radius:6px;">❌</button>
            </div>
          </div>

        </div>
      </div>

      <div class="nm-footer-rights">
        حقوق الإضافة لسيرفر Nightmare<br>
        <span style="letter-spacing:0.5px;">إختصار السيرفر NMAG</span><br>
        <span style="letter-spacing:0.5px;">By Kiro</span>
      </div>
      <div class="nm-status-container" dir="rtl">
        <span class="nm-status-text">حالة التحكم</span>
        <div class="nm-status-dot" id="HIndicator"></div>
      </div>
    `;

        document.body.appendChild(panel);

        // Tab switching
        panel.querySelectorAll(".nm-tab-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                panel.querySelectorAll(".nm-tab-btn").forEach(b => b.classList.remove("active"));
                panel.querySelectorAll(".nm-tab-pane").forEach(p => p.classList.remove("active"));
                btn.classList.add("active");
                const tabId = btn.getAttribute("data-tab");
                if (tabId) panel.querySelector("#" + tabId).classList.add("active");
            });
        });

        panel.querySelector("#nm-closePanelBtn").onclick = () => {
            panel.classList.remove("show");
        };
        panel.querySelector("#nm-openOppositePage").onclick = () => {
            nmOpenOtherPage();
        };

        updateCustomizationsUI();
        addControlPanelListeners();
        updateHIndicatorColor();
        nmBindPageUI();

        if (panelBackgroundImage) {
            panel.style.backgroundImage = `linear-gradient(rgba(26,26,36,0.85),rgba(15,15,19,0.95)),url(${panelBackgroundImage})`;
            panel.style.backgroundSize = "cover";
            panel.style.backgroundPosition = "center";
        }
    } catch (_) { }
}
// ── REC key binding helpers ───────────────────────────────────────────────
let _recBoxId = null, _recBtn = null;
const _keyDisplayToCode = {
    'TAB': 'Tab', 'A': 'KeyA', 'B': 'KeyB', 'C': 'KeyC', 'D': 'KeyD', 'E': 'KeyE', 'F': 'KeyF',
    'G': 'KeyG', 'H': 'KeyH', 'I': 'KeyI', 'J': 'KeyJ', 'K': 'KeyK', 'L': 'KeyL', 'M': 'KeyM',
    'N': 'KeyN', 'O': 'KeyO', 'P': 'KeyP', 'Q': 'KeyQ', 'R': 'KeyR', 'S': 'KeyS', 'T': 'KeyT',
    'U': 'KeyU', 'V': 'KeyV', 'W': 'KeyW', 'X': 'KeyX', 'Y': 'KeyY', 'Z': 'KeyZ',
    '0': 'Digit0', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4',
    '5': 'Digit5', '6': 'Digit6', '7': 'Digit7', '8': 'Digit8', '9': 'Digit9',
    'NUM0': 'Numpad0', 'NUM1': 'Numpad1', 'NUM2': 'Numpad2', 'NUM3': 'Numpad3',
    'NUM4': 'Numpad4', 'NUM5': 'Numpad5', 'NUM6': 'Numpad6', 'NUM7': 'Numpad7',
    'NUM8': 'Numpad8', 'NUM9': 'Numpad9',
    'NUM+': 'NumpadAdd', 'NUM-': 'NumpadSubtract', 'NUM*': 'NumpadMultiply',
    'NUM/': 'NumpadDivide', 'NUM.': 'NumpadDecimal', 'NUM↵': 'NumpadEnter',
    'SPC': 'Space', 'ENT': 'Enter', 'SHF': 'ShiftLeft', 'CTL': 'ControlLeft',
    'ALT': 'AltLeft', 'LFT': 'ArrowLeft', 'UP': 'ArrowUp', 'RGT': 'ArrowRight',
    'DWN': 'ArrowDown', '`': 'Backquote'
};
const _codeToDisplay = Object.fromEntries(Object.entries(_keyDisplayToCode).map(([d, c]) => [c, d]));
function _keyEventToDisplay(ev) {
    try {
        const c = ev.code;
        if (_codeToDisplay[c]) return _codeToDisplay[c];
        if (c.startsWith('Key')) return c.slice(3);
        if (c.startsWith('Digit')) return c.slice(5);
        if (c.startsWith('Numpad')) return 'NUM' + c.slice(6);
        if (c === 'Space') return 'SPC';
        if (c === 'Enter') return 'ENT';
        if (c === 'ShiftLeft' || c === 'ShiftRight') return 'SHF';
        if (c === 'ControlLeft' || c === 'ControlRight') return 'CTL';
        if (c === 'AltLeft' || c === 'AltRight') return 'ALT';
        if (c === 'ArrowLeft') return 'LFT';
        if (c === 'ArrowRight') return 'RGT';
        if (c === 'ArrowUp') return 'UP';
        if (c === 'ArrowDown') return 'DWN';
        if (c === 'Tab') return 'TAB';
        if (c === 'Backquote') return '`';
        if (c === 'Escape') return 'ESC';
        return c.length > 5 ? c.substring(0, 4) : c;
    } catch (_) { }
}
function _displayToCode(disp) {
    try { return _keyDisplayToCode[disp.toUpperCase()] || disp; } catch (_) { return disp; }
}
function _startRec(boxId, btn) {
    try {
        _stopRec();
        _recBoxId = boxId; _recBtn = btn;
        const box = document.getElementById(boxId);
        if (box) { box.classList.add('recording'); box.textContent = '...'; }
        btn.classList.add('recording'); btn.textContent = '...';
        document.addEventListener('keydown', _recHandler, true);
    } catch (_) { }
}
function _stopRec() {
    try {
        if (_recBoxId) {
            const box = document.getElementById(_recBoxId);
            if (box) { box.classList.remove('recording'); if (box.textContent === '...') box.textContent = ''; }
        }
        if (_recBtn) { _recBtn.classList.remove('recording'); _recBtn.textContent = 'REC'; }
        _recBoxId = null; _recBtn = null;
        document.removeEventListener('keydown', _recHandler, true);
    } catch (_) { }
}
let _recOnComplete = null;
const _recHandler = nativeify(function _recHandler(ev) {
    try {
        ev.preventDefault(); ev.stopPropagation();
        let disp = _keyEventToDisplay(ev);
        let code = _displayToCode(disp);
        if (ev.code === "Escape" || ev.code === "Backspace" || ev.code === "Delete") { disp = ""; code = "None"; }
        const box = document.getElementById(_recBoxId);
        if (box) box.textContent = disp;
        const cb = _recOnComplete;
        _recOnComplete = null;
        _stopRec();
        if (cb) cb(code);
    } catch (_) { }
}, '_recHandler');
// ── multi-toggle (enable/disable all game logic) ──────────────────────────
// Default true if never set — convert stored string "true"/"false" or use default true
let multiEnabled = (function () {
    const stored = S.get('multiEnabled', null);
    if (stored === null) return true;  // first run: enabled by default
    return boolFrom(stored);
})();
function _applyMultiEnabled(val) {
    try {
        multiEnabled = val;
        S.set('multiEnabled', val.toString());
        settingsChannel.postMessage({ type: 'update_multi_enabled', data: val });
    } catch (_) { }
}
function addControlPanelListeners() {
    try {
        // ── Customizations button
        const createBtn = document.getElementById("nm-createCustomization");
        if (createBtn) createBtn.onclick = () => createNewCustomization();

        // ── Export / Import
        const exportBtn = document.getElementById("nm-exportSettingsBtn");
        const importBtn = document.getElementById("nm-importSettingsBtn");
        const importFile = document.getElementById("nm-importSettingsFile");
        if (exportBtn) exportBtn.addEventListener("click", () => exportAllSettings());
        if (importBtn && importFile) {
            importBtn.addEventListener("click", () => importFile.click());
            importFile.addEventListener("change", ev => {
                const f = ev.target.files[0];
                if (f) {
                    const r = new FileReader();
                    r.onload = e => createWarningModal(() => importSettings(e.target.result), () => { });
                    r.readAsText(f);
                }
                ev.target.value = "";
            });
        }

        // ── Timer toggle
        const timerToggle = document.getElementById("timerEnabled");
        const timerSettingsBox = document.getElementById("timerSettingsContainer");
        const timerColorMode = document.getElementById("timerColorMode");
        const timerFixedColor = document.getElementById("timerFixedColor");
        if (timerToggle) {
            const stored = S.get("timerEnabled", "false") === "true";
            timerToggle.checked = stored;
            if (timerSettingsBox) timerSettingsBox.style.display = stored ? "inline-flex" : "none";
            timerToggle.addEventListener("change", () => {
                const v = timerToggle.checked;
                S.set("timerEnabled", v.toString());
                if (timerSettingsBox) timerSettingsBox.style.display = v ? "inline-flex" : "none";
            });
        }
        if (timerColorMode) {
            const stored = S.get("timerColorMode", "random");
            timerColorMode.value = stored;
            if (timerFixedColor) timerFixedColor.style.display = stored === "fixed" ? "inline-block" : "none";
            timerColorMode.addEventListener("change", () => {
                const v = timerColorMode.value;
                S.set("timerColorMode", v);
                if (timerFixedColor) timerFixedColor.style.display = v === "fixed" ? "inline-block" : "none";
            });
        }
        if (timerFixedColor) {
            timerFixedColor.value = S.get("timerFixedColor", "#FFFFFF");
            timerFixedColor.addEventListener("input", () => S.set("timerFixedColor", timerFixedColor.value));
        }

        // ── Skip results screen toggle
        const skipToggle = document.getElementById("nm-skipResults");
        if (skipToggle) {
            skipToggle.checked = nmSkipEnabled();
            skipToggle.addEventListener("change", () => nmSetSkip(skipToggle.checked));
        }

        // ── Multi toggle (enable/disable ALL logic)
        const multiToggle = document.getElementById("multi-toggle");
        if (multiToggle) {
            multiToggle.checked = multiEnabled;
            multiToggle.addEventListener("change", () => _applyMultiEnabled(multiToggle.checked));
        }

        // ── 7 Color pickers
        function _wireColorPicker(id, action) {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener("input", () => action(el.value));
        }
        const panel = document.getElementById("controlPanel");
        const circle = document.getElementById("nm-floating-circle");
        _wireColorPicker("nm-color-menu-bg", v => {
            if (panel) { panel.style.backgroundColor = v; panel.style.backgroundImage = "none"; }
            S.set("nmColorMenuBg", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorMenuBg", val: v });
        });
        _wireColorPicker("nm-color-menu-shadow", v => {
            if (panel) {
                const [r, g, b] = [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
                panel.style.boxShadow = `0 15px 35px rgba(0,0,0,0.6), 0 0 20px rgba(${r},${g},${b},0.25)`;
                panel.style.border = `1px solid rgba(${r},${g},${b},0.15)`;
                panel.style.borderTop = `1px solid rgba(${r},${g},${b},0.3)`;
            }
            S.set("nmColorMenuShadow", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorMenuShadow", val: v });
        });
        _wireColorPicker("nm-color-circle-bg", v => {
            if (circle) { circle.style.backgroundColor = v; circle.style.backgroundImage = "none"; }
            S.set("nmColorCircleBg", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorCircleBg", val: v });
        });
        _wireColorPicker("nm-color-primary", v => {
            document.documentElement.style.setProperty("--primary-red", v);
            // Derive --primary-rgb, --hover-red (lighter), --primary-dark (darker) from chosen color
            const r = parseInt(v.slice(1, 3), 16), g = parseInt(v.slice(3, 5), 16), b = parseInt(v.slice(5, 7), 16);
            document.documentElement.style.setProperty("--primary-rgb", `${r},${g},${b}`);
            // Lighter hover: blend toward white by 20%
            const hr = Math.min(255, Math.round(r + (255 - r) * 0.2));
            const hg = Math.min(255, Math.round(g + (255 - g) * 0.2));
            const hb = Math.min(255, Math.round(b + (255 - b) * 0.2));
            document.documentElement.style.setProperty("--hover-red", `rgb(${hr},${hg},${hb})`);
            // Darker shade: multiply by 0.65
            const dr = Math.round(r * 0.65), dg = Math.round(g * 0.65), db = Math.round(b * 0.65);
            document.documentElement.style.setProperty("--primary-dark", `rgb(${dr},${dg},${db})`);
            S.set("nmColorPrimary", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorPrimary", val: v });
        });
        _wireColorPicker("nm-color-text-light", v => {
            document.documentElement.style.setProperty("--text-light", v);
            S.set("nmColorTextLight", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorTextLight", val: v });
        });
        _wireColorPicker("nm-color-text-dim", v => {
            document.documentElement.style.setProperty("--text-dim", v);
            S.set("nmColorTextDim", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorTextDim", val: v });
        });
        _wireColorPicker("nm-color-special-btn", v => {
            document.documentElement.style.setProperty("--special-btn-bg", v);
            S.set("nmColorSpecialBtn", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorSpecialBtn", val: v });
        });

        // ── Image uploads
        const circleImgInput = document.getElementById("nm-buttonBackgroundImage");
        if (circleImgInput) {
            circleImgInput.addEventListener("change", function () {
                const f = this.files[0]; if (!f) return;
                const r = new FileReader();
                r.onload = e => {
                    buttonBackgroundImage = e.target.result;
                    ImageStore.set("buttonBackgroundImage", buttonBackgroundImage);
                    if (circle) { circle.style.backgroundImage = `url(${buttonBackgroundImage})`; }
                    settingsChannel.postMessage({ type: "update_button_background", data: buttonBackgroundImage });
                };
                r.readAsDataURL(f);
            });
        }
        const panelImgInput = document.getElementById("nm-panelBackgroundImage");
        if (panelImgInput) {
            panelImgInput.addEventListener("change", function () {
                const f = this.files[0]; if (!f) return;
                const r = new FileReader();
                r.onload = e => {
                    panelBackgroundImage = e.target.result;
                    ImageStore.set("panelBackgroundImage", panelBackgroundImage);
                    if (panel) {
                        panel.style.backgroundImage = `linear-gradient(rgba(26,26,36,0.85),rgba(15,15,19,0.95)),url(${panelBackgroundImage})`;
                        panel.style.backgroundSize = "cover";
                        panel.style.backgroundPosition = "center";
                    }
                    settingsChannel.postMessage({ type: "update_panel_background", data: panelBackgroundImage });
                };
                r.readAsDataURL(f);
            });
        }

        // ── Lines tab: REC binding + toggle + page select for movement dirs only
        ["Right", "Left", "Up", "Down", "TopLeft", "TopRight", "BottomLeft", "BottomRight"].forEach(dir => {
            _setupLineRowUI("movement", dir);
        });

        // ── New customization modal wiring (use onclick = assignment so re-runs are idempotent)
        const _execOnce = document.getElementById("nm-exec-once");
        const _execCont = document.getElementById("nm-exec-cont");
        const _intBox = document.getElementById("nm-continuousIntervalContainer");
        if (_execOnce) _execOnce.onchange = () => { if (_intBox) _intBox.style.display = "none"; };
        if (_execCont) _execCont.onchange = () => { if (_intBox) _intBox.style.display = "flex"; };

        const shortcutRecBtn = document.getElementById("nm-shortcutRecBtn");
        if (shortcutRecBtn) {
            shortcutRecBtn.onclick = () => {
                if (_recBoxId === "nm-customizationShortcutBox") { _stopRec(); return; }
                _startRec("nm-customizationShortcutBox", shortcutRecBtn);
            };
        }
        const addActionBtn = document.getElementById("nm-addAction");
        if (addActionBtn) addActionBtn.onclick = () => _addNewActionRow();
        const saveBtn = document.getElementById("nm-saveCustomization");
        if (saveBtn) saveBtn.onclick = () => _saveNewCustomization();
        const cancelBtn = document.getElementById("nm-cancelCustomization");
        if (cancelBtn) cancelBtn.onclick = () => _closeCustomizationModal();
    } catch (_) { }
}

// ── Line row wiring (REC-based) ───────────────────────────────────────────
// Lookup table that maps varBase → getter/setter functions using the actual module-scope lets.
// This avoids eval() which cannot write outer let bindings in strict mode.
const _lineVarMap = {
    movementRight: {
        get: () => movementRightEnabled, set: v => { movementRightEnabled = v; },
        getKey: () => movementRightKey, setKey: v => { movementRightKey = v; },
        getPage: () => movementRightPage, setPage: v => { movementRightPage = v; }
    },
    movementLeft: {
        get: () => movementLeftEnabled, set: v => { movementLeftEnabled = v; },
        getKey: () => movementLeftKey, setKey: v => { movementLeftKey = v; },
        getPage: () => movementLeftPage, setPage: v => { movementLeftPage = v; }
    },
    movementUp: {
        get: () => movementUpEnabled, set: v => { movementUpEnabled = v; },
        getKey: () => movementUpKey, setKey: v => { movementUpKey = v; },
        getPage: () => movementUpPage, setPage: v => { movementUpPage = v; }
    },
    movementDown: {
        get: () => movementDownEnabled, set: v => { movementDownEnabled = v; },
        getKey: () => movementDownKey, setKey: v => { movementDownKey = v; },
        getPage: () => movementDownPage, setPage: v => { movementDownPage = v; }
    },
    movementTopLeft: {
        get: () => movementTopLeftEnabled, set: v => { movementTopLeftEnabled = v; },
        getKey: () => movementTopLeftKey, setKey: v => { movementTopLeftKey = v; },
        getPage: () => movementTopLeftPage, setPage: v => { movementTopLeftPage = v; }
    },
    movementTopRight: {
        get: () => movementTopRightEnabled, set: v => { movementTopRightEnabled = v; },
        getKey: () => movementTopRightKey, setKey: v => { movementTopRightKey = v; },
        getPage: () => movementTopRightPage, setPage: v => { movementTopRightPage = v; }
    },
    movementBottomLeft: {
        get: () => movementBottomLeftEnabled, set: v => { movementBottomLeftEnabled = v; },
        getKey: () => movementBottomLeftKey, setKey: v => { movementBottomLeftKey = v; },
        getPage: () => movementBottomLeftPage, setPage: v => { movementBottomLeftPage = v; }
    },
    movementBottomRight: {
        get: () => movementBottomRightEnabled, set: v => { movementBottomRightEnabled = v; },
        getKey: () => movementBottomRightKey, setKey: v => { movementBottomRightKey = v; },
        getPage: () => movementBottomRightPage, setPage: v => { movementBottomRightPage = v; }
    },
};

function _setupLineRowUI(prefix, dir) {
    try {
        const dirCap = dir.charAt(0).toUpperCase() + dir.slice(1);
        const varBase = prefix + dirCap;
        const entry = _lineVarMap[varBase];
        if (!entry) return;

        const enabledId = `${prefix}${dirCap}Enabled`;
        const pageId = `${prefix}${dirCap}PageSelect`;
        const boxId = `${prefix}${dirCap}KeyBox`;

        const toggle = document.getElementById(enabledId);
        const pageSel = document.getElementById(pageId);
        const keyBox = document.getElementById(boxId);
        const recBtn = keyBox ? keyBox.previousElementSibling : null;

        function setEnabled(v) {
            entry.set(v);
            S.set(varBase + "Enabled", v.toString());
            settingsChannel.postMessage({ type: "update_movement_settings", data: getAllDirections() });
        }
        function setKey(v) {
            nmSetLineKey(varBase, v || "None");
            if (toggle) toggle.checked = entry.get();
        }
        function setPage(v) {
            entry.setPage(v);
            S.set(varBase + "Page", v);
            settingsChannel.postMessage({ type: "update_movement_settings", data: getAllDirections() });
        }

        // Restore saved state to UI
        if (toggle) toggle.checked = entry.get();
        if (pageSel) pageSel.value = entry.getPage();
        if (keyBox) {
            const k = entry.getKey();
            keyBox.textContent = (k && k !== "None") ? (_codeToDisplay[k] || k) : "";
        }

        // Idempotent wiring via .onchange / .onclick
        if (toggle) toggle.onchange = () => setEnabled(toggle.checked);
        if (pageSel) pageSel.onchange = () => setPage(pageSel.value);
        if (recBtn && keyBox) {
            recBtn.onclick = () => {
                if (_recBoxId === boxId) { _stopRec(); return; }
                _recOnComplete = (code) => setKey(code);
                _startRec(boxId, recBtn);
            };
        }
    } catch (_) { }
}

// ── New customization modal ───────────────────────────────────────────────
let _editingCustomizationIndex = null;
function _openCustomizationModal(existing = null, idx = null) {
    try {
        _editingCustomizationIndex = idx;
        const modal = document.getElementById("nm-customization-modal");
        if (!modal) return;
        const titleEl = document.getElementById("nm-modal-title");
        const nameEl = document.getElementById("nm-customizationName");
        const shortEl = document.getElementById("nm-customizationShortcut");
        const boxEl = document.getElementById("nm-customizationShortcutBox");
        const onceRad = document.getElementById("nm-exec-once");
        const contRad = document.getElementById("nm-exec-cont");
        const intBox = document.getElementById("nm-continuousIntervalContainer");
        const intEl = document.getElementById("nm-continuousInterval");
        const saveBtn = document.getElementById("nm-saveCustomization");
        const actCont = document.getElementById("nm-actionsContainer");

        if (titleEl) titleEl.textContent = existing ? "تعديل التخصيص" : "إنشاء تخصيص جديد";
        if (saveBtn) saveBtn.textContent = existing ? "حفظ التعديلات" : "إنشاء";
        if (nameEl) nameEl.value = existing ? existing.name : "";
        const storedCode = existing ? existing.shortcut : "None";
        if (shortEl) shortEl.value = storedCode;
        if (boxEl) boxEl.textContent = (storedCode && storedCode !== "None") ? (_codeToDisplay[storedCode] || storedCode) : "";
        const isCont = existing && existing.executionMode === "continuous";
        if (onceRad) onceRad.checked = !isCont;
        if (contRad) contRad.checked = isCont;
        if (intBox) intBox.style.display = isCont ? "flex" : "none";
        if (intEl) intEl.value = existing ? (existing.continuousInterval || 50) : 50;
        if (actCont) actCont.innerHTML = "";
        if (existing && existing.actions) {
            existing.actions.forEach(a => _addNewActionRow(a));
        }
        _stopRec();
        modal.classList.add("show");
    } catch (_) { }
}
function _closeCustomizationModal() {
    try {
        const modal = document.getElementById("nm-customization-modal");
        if (modal) modal.classList.remove("show");
        _editingCustomizationIndex = null;
        _stopRec();
    } catch (_) { }
}
function _addNewActionRow(existing = null) {
    try {
        const container = document.getElementById("nm-actionsContainer");
        if (!container) return;
        const row = document.createElement("div");
        row.className = "nm-action-row";
        const msgVal = existing ? existing.message : "None";
        const repVal = existing ? (existing.repeat || 1) : 1;
        const pageVal = existing ? existing.page : "current";
        row.innerHTML = `
      <select class="nm-dark-select nm-action-msg" style="flex:2;">
        ${knownWsMessages.map(m => `<option value="${m.value}" ${m.value === msgVal ? "selected" : ""}>${m.label}</option>`).join("")}
      </select>
      <span>×</span>
      <input type="number" class="nm-dark-input mini nm-action-repeat" value="${repVal}" min="1">
      <span>الصفحة</span>
      <select class="nm-dark-select nm-action-page" style="flex:1.2;">
        <option value="current"  ${pageVal === "current" ? "selected" : ""}>الحالية</option>
        <option value="opposite" ${pageVal === "opposite" ? "selected" : ""}>المعاكسة</option>
        <option value="both"     ${pageVal === "both" ? "selected" : ""}>كلاهما</option>
      </select>
      <button class="nm-btn-icon nm-danger-icon">❌</button>
    `;
        row.querySelector(".nm-btn-icon").addEventListener("click", () => row.remove());
        container.appendChild(row);
        nmRefreshPageLabels();
    } catch (_) { }
}
function _saveNewCustomization() {
    try {
        const nameEl = document.getElementById("nm-customizationName");
        const shortEl = document.getElementById("nm-customizationShortcut");
        const boxEl = document.getElementById("nm-customizationShortcutBox");
        const intEl = document.getElementById("nm-continuousInterval");
        const contRad = document.getElementById("nm-exec-cont");
        const actCont = document.getElementById("nm-actionsContainer");

        const name = nameEl ? nameEl.value.trim() : "";
        // get key code: if shortEl hidden input was set by rec, use that; else decode from box display
        const disp = boxEl ? boxEl.textContent.trim() : "";
        const shortcut = disp ? (_displayToCode(disp) || "None") : "None";
        const execMode = contRad && contRad.checked ? "continuous" : "once";
        const interval = parseInt(intEl ? intEl.value : "50") || 50;

        const actions = [];
        if (actCont) {
            actCont.querySelectorAll(".nm-action-row").forEach(row => {
                const msg = row.querySelector(".nm-action-msg") ? row.querySelector(".nm-action-msg").value : "None";
                const rep = row.querySelector(".nm-action-repeat") ? parseInt(row.querySelector(".nm-action-repeat").value) || 1 : 1;
                const page = row.querySelector(".nm-action-page") ? row.querySelector(".nm-action-page").value : "current";
                if (msg && msg !== "None") actions.push({ message: msg, repeat: rep, page });
            });
        }

        if (!name || actions.length === 0) {
            alert("يرجى تعبئة الاسم وإضافة إجراء واحد على الأقل.");
            return;
        }

        nmClaimKey(shortcut, { type: 'cust', idx: _editingCustomizationIndex !== null ? _editingCustomizationIndex : -1 });
        const obj = { name, shortcut, executionMode: execMode, continuousInterval: interval, actions, enabled: true };
        if (_editingCustomizationIndex !== null) {
            customizations[_editingCustomizationIndex] = { ...customizations[_editingCustomizationIndex], ...obj };
        } else {
            customizations.push(obj);
        }
        S.set("customizations", JSON.stringify(customizations));
        settingsChannel.postMessage({ type: "update_customizations", data: customizations });
        _closeCustomizationModal();
        updateCustomizationsUI();
    } catch (_) { }
}

function fillSelectWithKeys(e, t) {
    e.innerHTML = "";
    [{
        name: "None",
        code: "None"
    }, {
        name: "Tab",
        code: "Tab"
    }, {
        name: "A",
        code: "KeyA"
    }, {
        name: "B",
        code: "KeyB"
    }, {
        name: "C",
        code: "KeyC"
    }, {
        name: "D",
        code: "KeyD"
    }, {
        name: "E",
        code: "KeyE"
    }, {
        name: "F",
        code: "KeyF"
    }, {
        name: "G",
        code: "KeyG"
    }, {
        name: "H",
        code: "KeyH"
    }, {
        name: "I",
        code: "KeyI"
    }, {
        name: "J",
        code: "KeyJ"
    }, {
        name: "K",
        code: "KeyK"
    }, {
        name: "L",
        code: "KeyL"
    }, {
        name: "M",
        code: "KeyM"
    }, {
        name: "N",
        code: "KeyN"
    }, {
        name: "O",
        code: "KeyO"
    }, {
        name: "P",
        code: "KeyP"
    }, {
        name: "Q",
        code: "KeyQ"
    }, {
        name: "R",
        code: "KeyR"
    }, {
        name: "S",
        code: "KeyS"
    }, {
        name: "T",
        code: "KeyT"
    }, {
        name: "U",
        code: "KeyU"
    }, {
        name: "V",
        code: "KeyV"
    }, {
        name: "W",
        code: "KeyW"
    }, {
        name: "X",
        code: "KeyX"
    }, {
        name: "Y",
        code: "KeyY"
    }, {
        name: "Z",
        code: "KeyZ"
    }, {
        name: "0",
        code: "Digit0"
    }, {
        name: "1",
        code: "Digit1"
    }, {
        name: "2",
        code: "Digit2"
    }, {
        name: "3",
        code: "Digit3"
    }, {
        name: "4",
        code: "Digit4"
    }, {
        name: "5",
        code: "Digit5"
    }, {
        name: "6",
        code: "Digit6"
    }, {
        name: "7",
        code: "Digit7"
    }, {
        name: "8",
        code: "Digit8"
    }, {
        name: "9",
        code: "Digit9"
    }, {
        name: "0 (يمين الكيبورد)",
        code: "Numpad0"
    }, {
        name: "1 (يمين الكيبورد)",
        code: "Numpad1"
    }, {
        name: "2 (يمين الكيبورد)",
        code: "Numpad2"
    }, {
        name: "3 (يمين الكيبورد)",
        code: "Numpad3"
    }, {
        name: "4 (يمين الكيبورد)",
        code: "Numpad4"
    }, {
        name: "5 (يمين الكيبورد)",
        code: "Numpad5"
    }, {
        name: "6 (يمين الكيبورد)",
        code: "Numpad6"
    }, {
        name: "7 (يمين الكيبورد)",
        code: "Numpad7"
    }, {
        name: "8 (يمين الكيبورد)",
        code: "Numpad8"
    }, {
        name: "9 (يمين الكيبورد)",
        code: "Numpad9"
    }, {
        name: "+ (يمين الكيبورد)",
        code: "NumpadAdd"
    }, {
        name: "− (يمين الكيبورد)",
        code: "NumpadSubtract"
    }, {
        name: "× (يمين الكيبورد)",
        code: "NumpadMultiply"
    }, {
        name: "÷ (يمين الكيبورد)",
        code: "NumpadDivide"
    }, {
        name: ". (يمين الكيبورد)",
        code: "NumpadDecimal"
    }, {
        name: "↵ (يمين الكيبورد)",
        code: "NumpadEnter"
    }, {
        name: "Space",
        code: "Space"
    }, {
        name: "Enter",
        code: "Enter"
    }, {
        name: "Shift",
        code: "ShiftLeft"
    }, {
        name: "Ctrl",
        code: "ControlLeft"
    }, {
        name: "Alt",
        code: "AltLeft"
    }, {
        name: "←",
        code: "ArrowLeft"
    }, {
        name: "↑",
        code: "ArrowUp"
    }, {
        name: "→",
        code: "ArrowRight"
    }, {
        name: "↓",
        code: "ArrowDown"
    }, {
        name: "`",
        code: "Backquote"
    }].forEach(o => {
        const n = document.createElement("option");
        n.value = o.code;
        n.textContent = o.name;
        if (o.code === t) {
            n.selected = true;
        }
        e.appendChild(n);
    });
}
function fillSelectWithPages(e, t) {
    e.innerHTML = "";
    [{
        value: "current",
        text: "الحالية"
    }, {
        value: "opposite",
        text: "المعاكسة"
    }, {
        value: "both",
        text: "كلاهما"
    }].forEach(o => {
        const n = document.createElement("option");
        n.value = o.value;
        n.textContent = o.text;
        if (o.value === t) {
            n.selected = true;
        }
        e.appendChild(n);
    });
}
function setupDirectionUI(e) {
    const t = document.getElementById(`movement${e}Enabled`);
    const o = document.getElementById(`movement${e}KeySelect`);
    const n = document.getElementById(`movement${e}PageSelect`);
    const a = getAllDirections().find(t => t.id === e);
    if (a) {
        if (t) {
            t.checked = a.enabled;
            t.addEventListener("change", () => {
                const o = t.checked;
                switch (e) {
                    case "Left":
                        movementLeftEnabled = o;
                        S.set("movementLeftEnabled", o.toString());
                        break;
                    case "Right":
                        movementRightEnabled = o;
                        S.set("movementRightEnabled", o.toString());
                        break;
                    case "Up":
                        movementUpEnabled = o;
                        S.set("movementUpEnabled", o.toString());
                        break;
                    case "Down":
                        movementDownEnabled = o;
                        S.set("movementDownEnabled", o.toString());
                        break;
                    case "TopLeft":
                        movementTopLeftEnabled = o;
                        S.set("movementTopLeftEnabled", o.toString());
                        break;
                    case "TopRight":
                        movementTopRightEnabled = o;
                        S.set("movementTopRightEnabled", o.toString());
                        break;
                    case "BottomLeft":
                        movementBottomLeftEnabled = o;
                        S.set("movementBottomLeftEnabled", o.toString());
                        break;
                    case "BottomRight":
                        movementBottomRightEnabled = o;
                        S.set("movementBottomRightEnabled", o.toString());
                }
                settingsChannel.postMessage({
                    type: "update_movement_settings",
                    data: getAllDirections()
                });
            });
        }
        if (o) {
            fillSelectWithKeys(o, a.key);
            o.addEventListener("change", () => {
                const t = o.value;
                switch (e) {
                    case "Left":
                        movementLeftKey = t;
                        S.set("movementLeftKey", t);
                        break;
                    case "Right":
                        movementRightKey = t;
                        S.set("movementRightKey", t);
                        break;
                    case "Up":
                        movementUpKey = t;
                        S.set("movementUpKey", t);
                        break;
                    case "Down":
                        movementDownKey = t;
                        S.set("movementDownKey", t);
                        break;
                    case "TopLeft":
                        movementTopLeftKey = t;
                        S.set("movementTopLeftKey", t);
                        break;
                    case "TopRight":
                        movementTopRightKey = t;
                        S.set("movementTopRightKey", t);
                        break;
                    case "BottomLeft":
                        movementBottomLeftKey = t;
                        S.set("movementBottomLeftKey", t);
                        break;
                    case "BottomRight":
                        movementBottomRightKey = t;
                        S.set("movementBottomRightKey", t);
                }
                settingsChannel.postMessage({
                    type: "update_movement_settings",
                    data: getAllDirections()
                });
            });
        }
        if (n) {
            fillSelectWithPages(n, a.page);
            n.addEventListener("change", () => {
                const t = n.value;
                switch (e) {
                    case "Left":
                        movementLeftPage = t;
                        S.set("movementLeftPage", t);
                        break;
                    case "Right":
                        movementRightPage = t;
                        S.set("movementRightPage", t);
                        break;
                    case "Up":
                        movementUpPage = t;
                        S.set("movementUpPage", t);
                        break;
                    case "Down":
                        movementDownPage = t;
                        S.set("movementDownPage", t);
                        break;
                    case "TopLeft":
                        movementTopLeftPage = t;
                        S.set("movementTopLeftPage", t);
                        break;
                    case "TopRight":
                        movementTopRightPage = t;
                        S.set("movementTopRightPage", t);
                        break;
                    case "BottomLeft":
                        movementBottomLeftPage = t;
                        S.set("movementBottomLeftPage", t);
                        break;
                    case "BottomRight":
                        movementBottomRightPage = t;
                        S.set("movementBottomRightPage", t);
                }
                settingsChannel.postMessage({
                    type: "update_movement_settings",
                    data: getAllDirections()
                });
            });
        }
    }
}
function setupNormalDirectionUI(e) {
    const t = e.charAt(0).toLowerCase() + e.slice(1);
    const o = document.getElementById(`normal${t}Enabled`);
    const n = document.getElementById(`normal${t}KeySelect`);
    const a = document.getElementById(`normal${t}PageSelect`);
    const l = getAllNormalDirections().find(t => t.id === e);
    if (l) {
        if (o) {
            o.checked = l.enabled;
            o.addEventListener("change", () => {
                const t = o.checked;
                switch (e) {
                    case "BottomLeft":
                        normalBottomLeftEnabled = t;
                        S.set("normalBottomLeftEnabled", t.toString());
                        break;
                    case "MiddleBottom":
                        normalMiddleBottomEnabled = t;
                        S.set("normalMiddleBottomEnabled", t.toString());
                        break;
                    case "BottomRight":
                        normalBottomRightEnabled = t;
                        S.set("normalBottomRightEnabled", t.toString());
                        break;
                    case "Left":
                        normalLeftEnabled = t;
                        S.set("normalLeftEnabled", t.toString());
                        break;
                    case "Center":
                        normalCenterEnabled = t;
                        S.set("normalCenterEnabled", t.toString());
                        break;
                    case "Right":
                        normalRightEnabled = t;
                        S.set("normalRightEnabled", t.toString());
                        break;
                    case "TopLeft":
                        normalTopLeftEnabled = t;
                        S.set("normalTopLeftEnabled", t.toString());
                        break;
                    case "Top":
                        normalTopEnabled = t;
                        S.set("normalTopEnabled", t.toString());
                        break;
                    case "TopRight":
                        normalTopRightEnabled = t;
                        S.set("normalTopRightEnabled", t.toString());
                        break;
                    case "Topc":
                        normalTopcEnabled = t;
                        S.set("normalTopcEnabled", t.toString());
                }
                settingsChannel.postMessage({
                    type: "update_normal_settings",
                    data: getAllNormalDirections()
                });
            });
        }
        if (n) {
            fillSelectWithKeys(n, l.key);
            n.addEventListener("change", () => {
                const t = n.value;
                switch (e) {
                    case "BottomLeft":
                        normalBottomLeftKey = t;
                        S.set("normalBottomLeftKey", t);
                        break;
                    case "MiddleBottom":
                        normalMiddleBottomKey = t;
                        S.set("normalMiddleBottomKey", t);
                        break;
                    case "BottomRight":
                        normalBottomRightKey = t;
                        S.set("normalBottomRightKey", t);
                        break;
                    case "Left":
                        normalLeftKey = t;
                        S.set("normalLeftKey", t);
                        break;
                    case "Center":
                        normalCenterKey = t;
                        S.set("normalCenterKey", t);
                        break;
                    case "Right":
                        normalRightKey = t;
                        S.set("normalRightKey", t);
                        break;
                    case "TopLeft":
                        normalTopLeftKey = t;
                        S.set("normalTopLeftKey", t);
                        break;
                    case "Top":
                        normalTopKey = t;
                        S.set("normalTopKey", t);
                        break;
                    case "TopRight":
                        normalTopRightKey = t;
                        S.set("normalTopRightKey", t);
                        break;
                    case "Topc":
                        normalTopcKey = t;
                        S.set("normalTopcKey", t);
                }
                settingsChannel.postMessage({
                    type: "update_normal_settings",
                    data: getAllNormalDirections()
                });
            });
        }
        if (a) {
            fillSelectWithPages(a, l.page);
            a.addEventListener("change", () => {
                const t = a.value;
                switch (e) {
                    case "BottomLeft":
                        normalBottomLeftPage = t;
                        S.set("normalBottomLeftPage", t);
                        break;
                    case "MiddleBottom":
                        normalMiddleBottomPage = t;
                        S.set("normalMiddleBottomPage", t);
                        break;
                    case "BottomRight":
                        normalBottomRightPage = t;
                        S.set("normalBottomRightPage", t);
                        break;
                    case "Left":
                        normalLeftPage = t;
                        S.set("normalLeftPage", t);
                        break;
                    case "Center":
                        normalCenterPage = t;
                        S.set("normalCenterPage", t);
                        break;
                    case "Right":
                        normalRightPage = t;
                        S.set("normalRightPage", t);
                        break;
                    case "TopLeft":
                        normalTopLeftPage = t;
                        S.set("normalTopLeftPage", t);
                        break;
                    case "Top":
                        normalTopPage = t;
                        S.set("normalTopPage", t);
                        break;
                    case "TopRight":
                        normalTopRightPage = t;
                        S.set("normalTopRightPage", t);
                        break;
                    case "Topc":
                        normalTopcPage = t;
                        S.set("normalTopcPage", t);
                }
                settingsChannel.postMessage({
                    type: "update_normal_settings",
                    data: getAllNormalDirections()
                });
            });
        }
    }
}
function getDirectionLabel(e) {
    return {
        Left: "أفقي يسار",
        Right: "أفقي يمين",
        Up: "عمودي فوق",
        Down: "عمودي تحت",
        TopLeft: "زاوية فوق يسار",
        TopRight: "زاوية فوق يمين",
        BottomLeft: "زاوية تحت يسار",
        BottomRight: "زاوية تحت يمين"
    }[e] || e;
}
function getNormalDirectionLabel(e) {
    return {
        bottomLeft: "زاوية تحت يسار",
        middleBottom: "عمودي تحت ",
        bottomRight: "زاوية تحت يمين",
        left: " افقي يسار",
        center: "افقي عادي",
        right: "افقي يمين",
        topLeft: "زاوية فوق يسار",
        top: "عمودي فوق",
        topRight: "زاوية فوق يمين",
        topc: "عمودي عادي"
    }[e] || e;
}
function getAllDirections() {
    return [{
        id: "Left",
        label: "أفقي يسار",
        enabled: movementLeftEnabled,
        key: movementLeftKey,
        page: movementLeftPage
    }, {
        id: "Right",
        label: "أفقي يمين",
        enabled: movementRightEnabled,
        key: movementRightKey,
        page: movementRightPage
    }, {
        id: "Up",
        label: "عمودي فوق",
        enabled: movementUpEnabled,
        key: movementUpKey,
        page: movementUpPage
    }, {
        id: "Down",
        label: "عمودي تحت",
        enabled: movementDownEnabled,
        key: movementDownKey,
        page: movementDownPage
    }, {
        id: "TopLeft",
        label: "زاوية فوق يسار",
        enabled: movementTopLeftEnabled,
        key: movementTopLeftKey,
        page: movementTopLeftPage
    }, {
        id: "TopRight",
        label: "زاوية فوق يمين",
        enabled: movementTopRightEnabled,
        key: movementTopRightKey,
        page: movementTopRightPage
    }, {
        id: "BottomLeft",
        label: "زاوية تحت يسار",
        enabled: movementBottomLeftEnabled,
        key: movementBottomLeftKey,
        page: movementBottomLeftPage
    }, {
        id: "BottomRight",
        label: "زاوية تحت يمين",
        enabled: movementBottomRightEnabled,
        key: movementBottomRightKey,
        page: movementBottomRightPage
    }];
}
function getAllNormalDirections() {
    return [{
        id: "BottomLeft",
        label: "تحت يسار",
        enabled: normalBottomLeftEnabled,
        key: normalBottomLeftKey,
        page: normalBottomLeftPage
    }, {
        id: "MiddleBottom",
        label: "وسط تحت",
        enabled: normalMiddleBottomEnabled,
        key: normalMiddleBottomKey,
        page: normalMiddleBottomPage
    }, {
        id: "BottomRight",
        label: "تحت يمين",
        enabled: normalBottomRightEnabled,
        key: normalBottomRightKey,
        page: normalBottomRightPage
    }, {
        id: "Left",
        label: "يسار",
        enabled: normalLeftEnabled,
        key: normalLeftKey,
        page: normalLeftPage
    }, {
        id: "Center",
        label: "وسط",
        enabled: normalCenterEnabled,
        key: normalCenterKey,
        page: normalCenterPage
    }, {
        id: "Right",
        label: "يمين",
        enabled: normalRightEnabled,
        key: normalRightKey,
        page: normalRightPage
    }, {
        id: "TopLeft",
        label: "فوق يسار",
        enabled: normalTopLeftEnabled,
        key: normalTopLeftKey,
        page: normalTopLeftPage
    }, {
        id: "Top",
        label: "فوق",
        enabled: normalTopEnabled,
        key: normalTopKey,
        page: normalTopPage
    }, {
        id: "TopRight",
        label: "فوق يمين",
        enabled: normalTopRightEnabled,
        key: normalTopRightKey,
        page: normalTopRightPage
    }, {
        id: "Topc",
        label: "فوق وسط",
        enabled: normalTopcEnabled,
        key: normalTopcKey,
        page: normalTopcPage
    }];
}
function createControlButton() {
    try {
        if (document.getElementById("nm-floating-circle")) return;
        const circle = document.createElement("div");
        circle.id = "nm-floating-circle";
        circle.innerHTML = '<span class="nm-glyph"><svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="14" height="20" rx="3.5"/><rect x="15.5" y="6" width="14" height="20" rx="3.5" fill="rgba(255,255,255,.22)"/><path d="M8 16h8M13 12l4 4-4 4"/></svg></span><span class="nm-page-badge" id="nm-page-badge">1</span>';
        document.body.appendChild(circle);
        nmBindPageUI();

        // restore saved position
        const saved = S.get("controlButtonPosition", null);
        if (saved) {
            try {
                const pos = JSON.parse(saved);
                if (pos && pos.top != null && pos.left != null) {
                    circle.style.top = pos.top;
                    circle.style.left = pos.left;
                }
            } catch (_) { }
        }
        // apply stored image
        if (buttonBackgroundImage) {
            circle.style.backgroundImage = `url(${buttonBackgroundImage})`;
        }
        _setupCircleDragAndToggle(circle);
    } catch (_) { }
}
function applyButtonStyles() {
    // No-op in new UI: circle size/shape is fixed via CSS.
    // Kept so existing callers don't throw.
}
function _setupCircleDragAndToggle(circle) {
    const panel = document.getElementById("controlPanel");
    let isDragging = false;
    let startX, startY, initLeft, initTop;

    function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
    function savePos() {
        S.set("controlButtonPosition", JSON.stringify({ top: circle.style.top, left: circle.style.left }));
    }
    function repositionPanel() {
        const cr = circle.getBoundingClientRect();
        const panelW = 680;
        const panelH = 600;
        const margin = 12;
        // Prefer below the circle, fall back to above if not enough space
        let top = cr.bottom + margin;
        if (top + panelH > window.innerHeight) top = Math.max(margin, cr.top - panelH - margin);
        // Align left edge with circle, shift left if it clips the right edge
        let left = cr.left;
        if (left + panelW > window.innerWidth) left = Math.max(margin, window.innerWidth - panelW - margin);
        panel.style.top = top + "px";
        panel.style.left = left + "px";
    }

    // Mouse drag
    circle.addEventListener("mousedown", nativeify((ev) => {
        try {
            if (ev.button !== 0) return;
            ev.preventDefault();
            initLeft = circle.offsetLeft; initTop = circle.offsetTop;
            startX = ev.clientX; startY = ev.clientY; isDragging = false;
        } catch (_) { }
    }, 'circleMousedown'), true);
    document.addEventListener("mousemove", nativeify((ev) => {
        try {
            if (startX === undefined) return;
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            if (!isDragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) isDragging = true;
            if (isDragging) {
                circle.style.left = clamp(initLeft + dx, 0, window.innerWidth - circle.offsetWidth) + "px";
                circle.style.top = clamp(initTop + dy, 0, window.innerHeight - circle.offsetHeight) + "px";
            }
        } catch (_) { }
    }, 'circleDrag'), true);
    document.addEventListener("mouseup", nativeify((ev) => {
        try {
            if (startX === undefined) return;
            const wasDragging = isDragging;
            startX = startY = undefined; isDragging = false;
            if (wasDragging) { savePos(); return; }
            if (ev.target === circle || circle.contains(ev.target)) {
                nmTogglePanel();
            }
        } catch (_) { }
    }, 'circleMouseup'), true);

    // Touch drag
    circle.addEventListener("touchstart", nativeify((ev) => {
        try {
            const t = ev.touches[0];
            initLeft = circle.offsetLeft; initTop = circle.offsetTop;
            startX = t.clientX; startY = t.clientY; isDragging = false;
        } catch (_) { }
    }, 'touchstart'), { passive: true });
    document.addEventListener("touchmove", nativeify((ev) => {
        try {
            if (startX === undefined) return;
            const t = ev.touches[0];
            const dx = t.clientX - startX, dy = t.clientY - startY;
            if (!isDragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) isDragging = true;
            if (isDragging) {
                circle.style.left = clamp(initLeft + dx, 0, window.innerWidth - circle.offsetWidth) + "px";
                circle.style.top = clamp(initTop + dy, 0, window.innerHeight - circle.offsetHeight) + "px";
            }
        } catch (_) { }
    }, 'touchmove'), { passive: false });
    document.addEventListener("touchend", nativeify(() => {
        try {
            if (startX === undefined) return;
            const wasDragging = isDragging;
            startX = startY = undefined; isDragging = false;
            if (wasDragging) savePos();
            else nmTogglePanel();
        } catch (_) { }
    }, 'touchend'));

    // Click-outside → close
    document.addEventListener("mousedown", nativeify((ev) => {
        try {
            if (panel.classList.contains("show") &&
                !panel.contains(ev.target) && ev.target !== circle) {
                panel.classList.remove("show");
            }
        } catch (_) { }
    }, 'clickOutside'));

    // Keep circle in viewport on resize
    window.addEventListener("resize", nativeify(() => {
        try {
            circle.style.left = clamp(circle.offsetLeft, 0, Math.max(0, window.innerWidth - circle.offsetWidth)) + "px";
            circle.style.top = clamp(circle.offsetTop, 0, Math.max(0, window.innerHeight - circle.offsetHeight)) + "px";
            savePos();
        } catch (_) { }
    }, 'circleResize'));
}
function enableDrag(e) {
    let t = 0;
    let o = 0;
    let n = 0;
    let a = 0;
    function l(e, t, o) {
        return Math.min(Math.max(e, t), o);
    }
    const i = nativeify(function dragMove(i) {
        try {
            i.preventDefault();
            const m = i.clientX - t;
            const r = i.clientY - o;
            const d = function (t, o) {
                const n = Math.max(0, window.innerWidth - e.offsetWidth);
                const a = Math.max(0, window.innerHeight - e.offsetHeight);
                return { left: l(t, 0, n), top: l(o, 0, a) };
            }(n + m, a + r);
            e.style.left = d.left + "px";
            e.style.top = d.top + "px";
        } catch (_) { }
    }, 'dragMove');
    const m = nativeify(function dragEnd() {
        try {
            document.removeEventListener("mousemove", i, true);
            document.removeEventListener("mouseup", m, true);
            S.set("controlButtonPosition", JSON.stringify({ top: e.style.top, left: e.style.left }));
        } catch (_) { }
    }, 'dragEnd');
    e.addEventListener("mousedown", nativeify(function (l) {
        try {
            l.preventDefault();
            t = l.clientX; o = l.clientY; n = e.offsetLeft; a = e.offsetTop;
            document.addEventListener("mousemove", i, true);
            document.addEventListener("mouseup", m, true);
        } catch (_) { }
    }, 'dragMousedown'), true);
    window.addEventListener("resize", nativeify(() => {
        try {
            const t = parseFloat(e.style.top) || 0;
            const o = parseFloat(e.style.left) || 0;
            const n = Math.min(Math.max(o, 0), Math.max(0, window.innerWidth - e.offsetWidth));
            const a = Math.min(Math.max(t, 0), Math.max(0, window.innerHeight - e.offsetHeight));
            e.style.left = n + "px"; e.style.top = a + "px";
            S.set("controlButtonPosition", JSON.stringify({ top: e.style.top, left: e.style.left }));
        } catch (_) { }
    }, 'dragResize'));
}
function updateCustomizationsUI() {
    try {
        const container = document.getElementById("customizationsContainer");
        const emptyState = document.getElementById("nm-cust-empty-state");
        if (!container) return;
        container.innerHTML = "";
        if (emptyState) emptyState.style.display = customizations.length ? "none" : "flex";
        customizations.forEach((c, idx) => {
            const item = document.createElement("div");
            item.className = "nm-cust-item" + (c.enabled ? "" : " disabled");
            item.setAttribute("data-index", idx);
            const dispKey = c.shortcut && c.shortcut !== "None" ? (_codeToDisplay[c.shortcut] || c.shortcut) : "";
            item.innerHTML = `
          <div class="nm-cust-info">
            <h4>${c.name}</h4>
            ${dispKey ? `<span class="nm-cust-key-badge">${dispKey}</span>` : ""}
          </div>
          <div class="nm-cust-actions">
            <button class="nm-btn-mini nm-toggle-cust">${c.enabled ? "تعطيل" : "تمكين"}</button>
            <button class="nm-btn-mini nm-edit-cust">تعديل</button>
            <button class="nm-btn-mini danger nm-delete-cust">حذف</button>
          </div>`;
            item.querySelector(".nm-toggle-cust").addEventListener("click", () => {
                customizations[idx].enabled = !customizations[idx].enabled;
                S.set("customizations", JSON.stringify(customizations));
                settingsChannel.postMessage({ type: "update_customizations", data: customizations });
                updateCustomizationsUI();
            });
            item.querySelector(".nm-edit-cust").addEventListener("click", () => {
                _openCustomizationModal(customizations[idx], idx);
            });
            item.querySelector(".nm-delete-cust").addEventListener("click", () => {
                customizations.splice(idx, 1);
                S.set("customizations", JSON.stringify(customizations));
                settingsChannel.postMessage({ type: "update_customizations", data: customizations });
                updateCustomizationsUI();
            });
            container.appendChild(item);
        });
    } catch (_) { }
}
function createNewCustomization(e = null, t = null) {
    _openCustomizationModal(e, t);
}
function getActionsFromContainer(e) {
    const t = [];
    e.querySelectorAll(".action").forEach(e => {
        const o = e.querySelector(".actionMessage").value;
        const n = parseInt(e.querySelector(".actionRepeat").value) || 1;
        const a = e.querySelector(".actionPage").value;
        if (o && o !== "None") {
            t.push({
                message: o,
                repeat: n,
                page: a
            });
        }
    });
    return t;
}
function updateMovementUI() { try { updateMovementUIElements(); } catch (_) { } }
function updateNormalUI() { try { updateNormalUIElements(); } catch (_) { } }

function addEventListeners() {
    try { window.addEventListener("keydown", handleKeyDown, true); } catch (_) { }
    try { window.addEventListener("resize", nativeify(() => { }, 'resize')); } catch (_) { }
    settingsChannel.onmessage = e => {
        const t = e.data;
        if (t.type === "update_customizations") {
            customizations = t.data;
            S.set("customizations", JSON.stringify(customizations));
            applyStoredCustomizations();
        } else if (t.type === "update_customizations") {
            customizations = t.data;
            S.set("customizations", JSON.stringify(customizations));
            applyStoredCustomizations();
        } else if (t.type === "update_nm_color") {
            // 7-color system sync across tabs
            S.set(t.key, t.val);
            const cssVarMap = {
                nmColorPrimary: "--primary-red",
                nmColorTextLight: "--text-light",
                nmColorTextDim: "--text-dim",
                nmColorSpecialBtn: "--special-btn-bg"
            };
            if (cssVarMap[t.key]) document.documentElement.style.setProperty(cssVarMap[t.key], t.val);
            const panel = document.getElementById("controlPanel");
            const circle = document.getElementById("nm-floating-circle");
            if (t.key === "nmColorMenuBg" && panel) { panel.style.backgroundColor = t.val; }
            if (t.key === "nmColorCircleBg" && circle) { circle.style.backgroundColor = t.val; }
            updateAllUIElements();
        } else if (t.type === "update_multi_enabled") {
            multiEnabled = t.data;
            S.set("multiEnabled", t.data.toString());
            const mt = document.getElementById("multi-toggle");
            if (mt) mt.checked = multiEnabled;
        } else if (t.type === "update_panel_background") {
            panelBackgroundImage = t.data;
            ImageStore.set("panelBackgroundImage", t.data);
            const panel = document.getElementById("controlPanel");
            if (panel) {
                panel.style.backgroundImage = `linear-gradient(rgba(26,26,36,0.85),rgba(15,15,19,0.95)),url(${t.data})`;
                panel.style.backgroundSize = "cover";
                panel.style.backgroundPosition = "center";
            }
        } else if (t.type === "update_button_background") {
            buttonBackgroundImage = t.data;
            ImageStore.set("buttonBackgroundImage", t.data);
            const circle = document.getElementById("nm-floating-circle");
            if (circle) circle.style.backgroundImage = `url(${t.data})`;
        } else if (t.type === "toggle_focus") {
            if (window.focusPeer) window.focusPeer();
        } else if (t.type === "update_movement_settings") {
            const e = t.data;
            if (e) {
                Object.keys(e).forEach(t => {
                    const o = e[t];
                    if (o) {
                        switch (t) {
                            case "Left":
                                movementLeftEnabled = o.enabled;
                                movementLeftKey = o.key;
                                movementLeftPage = o.page;
                                S.set("movementLeftEnabled", movementLeftEnabled.toString());
                                S.set("movementLeftKey", movementLeftKey);
                                S.set("movementLeftPage", movementLeftPage);
                                break;
                            case "Right":
                                movementRightEnabled = o.enabled;
                                movementRightKey = o.key;
                                movementRightPage = o.page;
                                S.set("movementRightEnabled", movementRightEnabled.toString());
                                S.set("movementRightKey", movementRightKey);
                                S.set("movementRightPage", movementRightPage);
                                break;
                            case "Up":
                                movementUpEnabled = o.enabled;
                                movementUpKey = o.key;
                                movementUpPage = o.page;
                                S.set("movementUpEnabled", movementUpEnabled.toString());
                                S.set("movementUpKey", movementUpKey);
                                S.set("movementUpPage", movementUpPage);
                                break;
                            case "Down":
                                movementDownEnabled = o.enabled;
                                movementDownKey = o.key;
                                movementDownPage = o.page;
                                S.set("movementDownEnabled", movementDownEnabled.toString());
                                S.set("movementDownKey", movementDownKey);
                                S.set("movementDownPage", movementDownPage);
                        }
                    }
                });
                updateMovementUIElements();
            }
        } else if (t.type === "update_normal_settings") {
            const e = t.data;
            if (e) {
                Object.keys(e).forEach(t => {
                    const o = e[t];
                    if (o) {
                        switch (t) {
                            case "BottomLeft":
                                normalBottomLeftEnabled = o.enabled;
                                normalBottomLeftKey = o.key;
                                normalBottomLeftPage = o.page;
                                S.set("normalBottomLeftEnabled", normalBottomLeftEnabled.toString());
                                S.set("normalBottomLeftKey", normalBottomLeftKey);
                                S.set("normalBottomLeftPage", normalBottomLeftPage);
                                break;
                            case "MiddleBottom":
                                normalMiddleBottomEnabled = o.enabled;
                                normalMiddleBottomKey = o.key;
                                normalMiddleBottomPage = o.page;
                                S.set("normalMiddleBottomEnabled", normalMiddleBottomEnabled.toString());
                                S.set("normalMiddleBottomKey", normalMiddleBottomKey);
                                S.set("normalMiddleBottomPage", normalMiddleBottomPage);
                                break;
                            case "BottomRight":
                                normalBottomRightEnabled = o.enabled;
                                normalBottomRightKey = o.key;
                                normalBottomRightPage = o.page;
                                S.set("normalBottomRightEnabled", normalBottomRightEnabled.toString());
                                S.set("normalBottomRightKey", normalBottomRightKey);
                                S.set("normalBottomRightPage", normalBottomRightPage);
                                break;
                            case "Left":
                                normalLeftEnabled = o.enabled;
                                normalLeftKey = o.key;
                                normalLeftPage = o.page;
                                S.set("normalLeftEnabled", normalLeftEnabled.toString());
                                S.set("normalLeftKey", normalLeftKey);
                                S.set("normalLeftPage", normalLeftPage);
                                break;
                            case "Center":
                                normalCenterEnabled = o.enabled;
                                normalCenterKey = o.key;
                                normalCenterPage = o.page;
                                S.set("normalCenterEnabled", normalCenterEnabled.toString());
                                S.set("normalCenterKey", normalCenterKey);
                                S.set("normalCenterPage", normalCenterPage);
                                break;
                            case "Right":
                                normalRightEnabled = o.enabled;
                                normalRightKey = o.key;
                                normalRightPage = o.page;
                                S.set("normalRightEnabled", normalRightEnabled.toString());
                                S.set("normalRightKey", normalRightKey);
                                S.set("normalRightPage", normalRightPage);
                                break;
                            case "TopLeft":
                                normalTopLeftEnabled = o.enabled;
                                normalTopLeftKey = o.key;
                                normalTopLeftPage = o.page;
                                S.set("normalTopLeftEnabled", normalTopLeftEnabled.toString());
                                S.set("normalTopLeftKey", normalTopLeftKey);
                                S.set("normalTopLeftPage", normalTopLeftPage);
                                break;
                            case "Top":
                                normalTopEnabled = o.enabled;
                                normalTopKey = o.key;
                                normalTopPage = o.page;
                                S.set("normalTopEnabled", normalTopEnabled.toString());
                                S.set("normalTopKey", normalTopKey);
                                S.set("normalTopPage", normalTopPage);
                                break;
                            case "TopRight":
                                normalTopRightEnabled = o.enabled;
                                normalTopRightKey = o.key;
                                normalTopRightPage = o.page;
                                S.set("normalTopRightEnabled", normalTopRightEnabled.toString());
                                S.set("normalTopRightKey", normalTopRightKey);
                                S.set("normalTopRightPage", normalTopRightPage);
                                break;
                            case "Topc":
                                normalTopcEnabled = o.enabled;
                                normalTopcKey = o.key;
                                normalTopcPage = o.page;
                                S.set("normalTopcEnabled", normalTopcEnabled.toString());
                                S.set("normalTopcKey", normalTopcKey);
                                S.set("normalTopcPage", normalTopcPage);
                        }
                    }
                });
                updateNormalUIElements();
            }
        }
    };
}
const handleKeyDown = nativeify(function handleKeyDown(e) {
    try {
        if (!NMAUTH.isAuthed()) return; // defense-in-depth: no command fires without a validated login
        if (!multiEnabled) return;
        if ((!e.isTrusted && !window.__nmMacroReplay) || e.repeat) return;
        if (_recBoxId || window.__nmSetupActive) return;          // recording a key: never fire actions
        const el = e.target, tag = el && el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el && el.isContentEditable)) return;
        const code = e.code;
        if (!code || code === "None") return;
        window.__nmStat.key = code;
        if (nmReleaseKey !== "None" && code === nmReleaseKey) { nmReleaseAll(); window.__nmStat.act = "release-all"; return; }
        const dirs = getAllDirections();
        for (let i = 0; i < dirs.length; i++) {
            const d = dirs[i];
            if (d.enabled && d.key === code) { window.__nmStat.key = code + " > " + d.id; handleMouseMovement(d.id, d.page); return; }
        }
        const nd = getAllNormalDirections();
        for (let i = 0; i < nd.length; i++) {
            const d = nd[i];
            if (d.enabled && d.key && d.key !== "None" && d.key === code) { handleNormalLineMovement(d.id, d.page); return; }
        }
        customizations.forEach((c, o) => {
            if (c.enabled && c.shortcut && c.shortcut !== "None" && code === c.shortcut) executeCustomization(c, o);
        });
    } catch (_) { }
}, 'handleKeyDown');
function getCanvasPositions() {
    try {
        const e = canvasElement || getCanvasElement();
        if (!e) { return null; }
        const t = e.getBoundingClientRect();
        const o = t.left + t.width / 2;
        const n = t.top + t.height / 2;
        const a = Math.min(t.width, t.height);
        const l = a / 2;
        return {
            canvas: e,
            rect: t,
            centerX: o,
            centerY: n,
            positions: {
                Left: [o - l, n],
                Right: [o + l, n],
                Up: [o, n - l],
                Down: [o, n + l],
                TopLeft: [o - l, n - l],
                TopRight: [o + l, n - l],
                BottomLeft: [o - l, n + l],
                BottomRight: [o + l, n + l],
                bottomLeft: [o - l, n + l],
                middleBottom: [o, n + l],
                bottomRight: [o + l, n + l],
                left: [o - l, n],
                center: [o, n],
                right: [o + l, n],
                topLeft: [o - l, n - l],
                top: [o, n - l],
                topRight: [o + l, n - l],
                topc: [o, n - a * 0.1]
            }
        };
    } catch (_) { }
}
actionChannelLocal.onmessage = nativeify(function (e) {
    try {
        const t = e.data;
        // only the page this message is addressed to reacts, and never to its own messages
        if (!t || t.to !== myPage || t.from === myPage) return;
        if (t.type === "line_press") {
            try { nmLinePress(t.dir, t.ts); } catch (_) { }
        } else if (t.type === "execute_actions") {
            try { executeReceivedActions(t.actions); } catch (_) { }
        } else if (t.type === "normal_line_move") {
            try { nmLinePress(mapNormalToMoveDir(t.position), Date.now()); } catch (_) { }
        }
    } catch (_) { }
}, 'onmessage');
// ──────────────────────────────────────────────────────────────────────
// NMAUTH — login gate. Nothing below this point (panel, hotkeys, lines,
// FPS override, color hooks, macro/clip/alerts/profiles, packet recorder)
// is ever wired up before a code is checked against the license server
// and accepted. If the server can't be reached, access fails CLOSED
// (blocked), never open — this is a deliberate choice, not a bug.
// ──────────────────────────────────────────────────────────────────────
const NM_LICENSE_SERVER_DEFAULT = "https://agar-server-production.up.railway.app";
const NMAUTH = (function () {
    const SKEY = "nm3_serverUrl", AKEY = "nm3_auth", DKEY = "nm3_deviceId";

    function deviceId() {
        let id;
        try { id = localStorage.getItem(DKEY); } catch (_) { }
        if (!id) {
            try { id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(36).slice(2)); } catch (_) { id = Date.now() + "-" + Math.random().toString(36).slice(2); }
            try { localStorage.setItem(DKEY, id); } catch (_) { }
        }
        return id;
    }
    function serverUrl() {
        let v; try { v = localStorage.getItem(SKEY); } catch (_) { }
        return (v || NM_LICENSE_SERVER_DEFAULT).replace(/\/+$/, "");
    }
    function setServerUrl(u) { try { localStorage.setItem(SKEY, String(u || "").replace(/\/+$/, "")); } catch (_) { } }
    function getAuth() { try { return JSON.parse(localStorage.getItem(AKEY) || "null"); } catch (_) { return null; } }
    function setAuth(a) { try { localStorage.setItem(AKEY, JSON.stringify(a)); } catch (_) { } }
    function clearAuth() { try { localStorage.removeItem(AKEY); } catch (_) { } }

    let _state = { authed: false, permissions: {} };
    function isAuthed() { return _state.authed === true; }
    function hasPerm(k) { return _state.authed && _state.permissions && _state.permissions[k] !== false; }
    function permissions() { return Object.assign({}, _state.permissions); }

    async function login(code) {
        const res = await fetch(serverUrl() + "/api/auth/login", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: code, deviceId: deviceId() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error((data && data.error) || "login_failed");
        setAuth({ token: data.token, exp: data.exp, permissions: data.permissions, expiresAt: data.expiresAt });
        _state = { authed: true, permissions: data.permissions || {} };
        return data;
    }
    async function validate() {
        const a = getAuth();
        if (!a || !a.token) { _state = { authed: false, permissions: {} }; return false; }
        try {
            const res = await fetch(serverUrl() + "/api/auth/validate", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: a.token }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.valid) { clearAuth(); _state = { authed: false, permissions: {} }; return false; }
            _state = { authed: true, permissions: data.permissions || {} };
            return true;
        } catch (_) {
            // Server unreachable: fail CLOSED rather than trusting a cached token.
            _state = { authed: false, permissions: {} };
            return false;
        }
    }
    async function revalidateNow() {
        const result = await validate();
        if (!result) { try { lockdown(); } catch (_) { } }
        else { try { applyPermissionUI(); } catch (_) { } }
        return result;
    }
    function startHeartbeat() {
        try {
            setInterval(nativeify(revalidateNow, 'nmAuthHeartbeat'), 5 * 60 * 1000);
        } catch (_) { }
    }
    function lockdown() {
        try { if (typeof nmReleaseAll === "function") nmReleaseAll(); } catch (_) { }
        try { if (window.__nmCorner && window.__nmCorner.releaseAll) window.__nmCorner.releaseAll(); } catch (_) { }
        try { const p = document.getElementById("controlPanel"); if (p) p.classList.remove("show"); } catch (_) { }
        try { showOverlay(); } catch (_) { }
    }
    function applyPermissionUI() {
        try {
            const map = {
                "nm-tab-lines": ["lines", "pin"],
                "nm-tab-perf": ["fps", "alerts"],
                "nm-tab-colors": ["colors"],
                "nm-tab-rec": ["recorder"],
                "nm-tab-adv": ["macro", "clip", "alerts", "profiles"],
            };
            Object.keys(map).forEach((tabId) => {
                const visible = map[tabId].some((k) => hasPerm(k));
                const pane = document.getElementById(tabId);
                const btn = document.querySelector('.nm-tab-btn[data-tab="' + tabId + '"]');
                if (pane) pane.style.display = visible ? "" : "none";
                if (btn) btn.style.display = visible ? "" : "none";
            });
        } catch (_) { }
    }

    function injectAuthStyles() {
        if (document.getElementById("nm-auth-style")) return;
        const st = document.createElement("style");
        st.id = "nm-auth-style";
        st.textContent = `
#nm-auth-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 700px at 80% -10%,rgba(124,92,255,.18),transparent),radial-gradient(900px 500px at -10% 110%,rgba(255,92,168,.14),transparent),rgba(6,7,12,.92);backdrop-filter:blur(8px);font-family:"Segoe UI",Tahoma,Arial,sans-serif}
.nm-auth-card{width:min(360px,90vw);padding:30px 28px;direction:rtl;text-align:center;background:linear-gradient(180deg,#1a1f30,#151926);border:1px solid #262c40;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.nm-auth-brand{font-size:19px;font-weight:800;background:linear-gradient(135deg,#7c5cff,#ff5ca8);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:4px}
.nm-auth-sub{font-size:12.5px;color:#8d93ab;margin-bottom:18px;line-height:1.6}
.nm-auth-lbl{display:block;text-align:right;font-size:12px;color:#8d93ab;margin-bottom:12px}
.nm-auth-input{width:100%;margin-top:6px;background:#0e111a;border:1px solid #262c40;color:#e9ecf5;border-radius:10px;padding:10px 12px;font-size:14px;box-sizing:border-box;outline:none}
.nm-auth-input:focus{border-color:#7c5cff;box-shadow:0 0 0 3px rgba(124,92,255,.15)}
.nm-auth-btn{width:100%;margin-top:4px;padding:11px;border:none;border-radius:10px;font-size:14px;font-weight:700;color:#fff;cursor:pointer;background:linear-gradient(135deg,#7c5cff,#ff5ca8);background-size:200% 200%;animation:nmAuthGrad 4s ease infinite}
.nm-auth-btn:disabled{opacity:.6;cursor:default}
@keyframes nmAuthGrad{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
.nm-auth-msg{min-height:16px;margin-top:12px;font-size:12.5px;color:#ff5b6e}
.nm-auth-msg.ok{color:#35d399}
`;
        document.documentElement.appendChild(st);
    }

    let _onAuthedCb = null;
    function onAuthed() {
        applyPermissionUI();
        startHeartbeat();
        if (_onAuthedCb) { const cb = _onAuthedCb; _onAuthedCb = null; try { cb(); } catch (_) { } }
    }

    function showOverlay() {
        if (!document.body) { setTimeout(showOverlay, 200); return; }
        if (document.getElementById("nm-auth-overlay")) return;
        injectAuthStyles();
        const ov = document.createElement("div");
        ov.id = "nm-auth-overlay";
        ov.innerHTML =
            '<div class="nm-auth-card">' +
            '<div class="nm-auth-brand">Multi Tabs Controller</div>' +
            '<div class="nm-auth-sub">سجّل دخولك بكود التفعيل عشان تقدر تستخدم الأداة<br>مفيش اي امر هيتنفذ قبل التسجيل</div>' +
            '<label class="nm-auth-lbl">سيرفر التفعيل' +
            '<input id="nm-auth-server" class="nm-auth-input" dir="ltr" placeholder="' + NM_LICENSE_SERVER_DEFAULT + '" /></label>' +
            '<label class="nm-auth-lbl">كود الدخول' +
            '<input id="nm-auth-code" class="nm-auth-input" dir="ltr" placeholder="XXXX-XXXX-XXXX" /></label>' +
            '<button id="nm-auth-submit" class="nm-auth-btn">دخول</button>' +
            '<div id="nm-auth-msg" class="nm-auth-msg"></div>' +
            '</div>';
        document.body.appendChild(ov);
        const serverInput = ov.querySelector("#nm-auth-server");
        const savedServer = serverUrl();
        serverInput.value = savedServer === NM_LICENSE_SERVER_DEFAULT ? "" : savedServer;
        const codeInput = ov.querySelector("#nm-auth-code");
        const msg = ov.querySelector("#nm-auth-msg");
        const submit = ov.querySelector("#nm-auth-submit");
        const ERR_MAP = {
            invalid_code: "الكود غير صحيح",
            revoked: "تم إلغاء هذا الكود",
            expired: "الكود منتهي الصلاحية",
            device_limit: "تجاوزت عدد الأجهزة المسموح بها لهذا الكود",
            missing_code: "اكتب الكود",
        };
        const doLogin = nativeify(async () => {
            const su = (serverInput.value || NM_LICENSE_SERVER_DEFAULT).trim();
            const code = codeInput.value.trim();
            if (!code) { msg.className = "nm-auth-msg"; msg.textContent = "اكتب الكود"; return; }
            setServerUrl(su);
            submit.disabled = true;
            msg.className = "nm-auth-msg";
            msg.textContent = "جارٍ التحقق...";
            try {
                await login(code);
                msg.className = "nm-auth-msg ok";
                msg.textContent = "تم الدخول ✓";
                try { ov.remove(); } catch (_) { }
                onAuthed();
            } catch (e) {
                const reason = String((e && e.message) || e);
                msg.className = "nm-auth-msg";
                msg.textContent = ERR_MAP[reason] || "تعذر الاتصال بسيرفر التفعيل — تأكد من رابط السيرفر";
            } finally {
                submit.disabled = false;
            }
        }, 'nmAuthSubmit');
        submit.addEventListener("click", doLogin);
        codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
    }

    async function boot(readyCb) {
        _onAuthedCb = readyCb;
        const cached = getAuth();
        if (cached && cached.token) {
            const ok = await validate();
            if (ok) { onAuthed(); return; }
        }
        showOverlay();
    }

    return { boot, isAuthed, hasPerm, permissions, lockdown, deviceId, serverUrl, applyPermissionUI, revalidateNow };
})();

(function () {
    try {
        const e = nativeify(() => {
            try {
                NMAUTH.boot(() => { try { initWithRetry(20); } catch (_) { } });
            } catch (_) { }
        });
        if (document.readyState === "complete" || document.readyState === "interactive") {
            try { setTimeout(e, 1000); } catch (_) { }
        } else {
            try { window.addEventListener("DOMContentLoaded", nativeify(() => { try { setTimeout(e, 1000); } catch (_) { } })); } catch (_) { }
            try { window.addEventListener("load", nativeify(() => { try { setTimeout(e, 1000); } catch (_) { } })); } catch (_) { }
        }
    } catch (_) { }
})();
// Direction → game-world coordinate offsets for pkt_move
// Use values well beyond any map boundary (~14142 units for standard maps)
const MOUSE_MOVE_COORDS = {
    Left: {
        x: e => -9999999,
        y: e => e / 2
    },
    Right: {
        x: e => e + 9999999,
        y: e => e / 2
    },
    Up: {
        x: e => e / 2,
        y: e => -9999999
    },
    Down: {
        x: e => e / 2,
        y: e => e + 9999999
    },
    TopLeft: {
        x: e => -9999999,
        y: e => -9999999
    },
    TopRight: {
        x: e => e + 9999999,
        y: e => -9999999
    },
    BottomLeft: {
        x: e => -9999999,
        y: e => e + 9999999
    },
    BottomRight: {
        x: e => e + 9999999,
        y: e => e + 9999999
    }
};
function handleMouseMovement(dir, page) {
    try {
        const ts = Date.now();
        if (page === "current" || page === "both") { try { nmLinePress(dir, ts); } catch (_) { } }
        if (page === "opposite" || page === "both") { nmPostToOther({ type: "line_press", dir: dir, ts: ts }); }
    } catch (_) { }
}
function handleMouseMoveLocal(dir) {
    try { nmLinePress(dir, Date.now()); } catch (_) { }
}
function mapNormalToMoveDir(e) {
    try {
        return {
            BottomLeft: "BottomLeft",
            MiddleBottom: "Down",
            BottomRight: "BottomRight",
            Left: "Left",
            Center: "Left",
            Right: "Right",
            TopLeft: "TopLeft",
            Top: "Up",
            TopRight: "TopRight",
            Topc: "Up"
        }[e] || "Down";
    } catch (_) { }
}
function handleNormalLineMovement(e, t) {
    try {
        if (t === "current" || t === "both") { try { handleNormalLineMoveLocal(e); } catch (_) { } }
        if (t === "opposite" || t === "both") {
            nmPostToOther({ type: "normal_line_move", position: e });
        }
    } catch (_) { }
}
function handleNormalLineMoveLocal(pos) {
    try {
        if (window.activeNormalLock === pos) {
            window.activeNormalLock = null;
        } else {
            window.activeNormalLock = pos;
            window.activeMovementLock = null;
        }
    } catch (_) { }
}
function dispatchMouseLike(e, t, o) {
    try {
        if (window.PointerEvent) {
            try { e.dispatchEvent(new PointerEvent(t, { ...o, pointerId: 1, pointerType: "mouse", isPrimary: true })); }
            catch (_) { try { e.dispatchEvent(new MouseEvent(t, o)); } catch (_) { } }
        } else {
            try { e.dispatchEvent(new MouseEvent(t, o)); } catch (_) { }
        }
    } catch (_) { }
}
function dispatchMoveOnly(e, t, o) {
    try {
        const n = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: t,
            clientY: o
        };
        if (window.PointerEvent) {
            try {
                e.dispatchEvent(new PointerEvent("pointermove", {
                    ...n,
                    pointerId: 1,
                    pointerType: "mouse",
                    isPrimary: true,
                    buttons: 0
                }));
            } catch (_) { }
        }
        e.dispatchEvent(new MouseEvent("mousemove", n));
    } catch (_) { }
}
function getNormalLineCoords(e, t = 50) {
    const o = canvasElement || getCanvasElement();
    const n = (e, t, o) => Math.min(o, Math.max(t, e));
    const a = o => {
        const a = o.left + o.width / 2;
        const l = o.top + o.height / 2;
        const i = Math.min(o.width, o.height) - t * 2;
        const m = i / 2;
        const r = {
            BottomLeft: {
                x: a - m,
                y: l + m
            },
            MiddleBottom: {
                x: a,
                y: l + m
            },
            BottomRight: {
                x: a + m,
                y: l + m
            },
            Left: {
                x: a - m,
                y: l
            },
            Center: {
                x: a,
                y: l
            },
            Right: {
                x: a + m,
                y: l
            },
            TopLeft: {
                x: a - m,
                y: l - m
            },
            Top: {
                x: a,
                y: l - m
            },
            TopRight: {
                x: a + m,
                y: l - m
            },
            Topc: {
                x: a,
                y: l - i * 0.1
            }
        };
        const d = r[e] || r.Center;
        return {
            x: n(d.x, o.left + t, o.right - t),
            y: n(d.y, o.top + t, o.bottom - t)
        };
    };
    if (o && typeof o.getBoundingClientRect == "function") {
        return a(o.getBoundingClientRect());
    }
    {
        const e = document.documentElement.clientWidth;
        const t = document.documentElement.clientHeight;
        return a({
            left: 0,
            top: 0,
            width: e,
            height: t,
            right: e,
            bottom: t
        });
    }
}
function getCanvasElement() {
    try { return document.querySelector("canvas"); } catch (_) { return null; }
}
function executeCustomization(e, t) {
    try {
        if (e.executionMode === "once") {
            try { executeActions(e.actions); } catch (_) { }
        } else if (e.executionMode === "continuous") {
            if (activeCustomizations[t]) {
                try { clearInterval(intervals[t]); } catch (_) { }
                delete activeCustomizations[t];
            } else {
                activeCustomizations[t] = true;
                intervals[t] = setInterval(nativeify(() => {
                    try { executeActions(e.actions); } catch (_) { }
                }, 'custInterval'), e.continuousInterval);
            }
        }
    } catch (_) { }
}
function executeActions(e) {
    try {
        e.forEach(e => {
            try {
                for (let t = 0; t < e.repeat; t++) {
                    const o = t * 50;
                    if (e.page === "current" || e.page === "both") {
                        setTimeout(nativeify(() => { try { sendBinaryMessage(e.message); } catch (_) { } }), o);
                    }
                    if (e.page === "opposite" || e.page === "both") {
                        setTimeout(nativeify(() => {
                            nmPostToOther({ type: "execute_actions", actions: [{ message: e.message }] });
                        }), o);
                    }
                }
            } catch (_) { }
        });
    } catch (_) { }
}
let timer;
function loadAllStyle() {
    try {
        const e = document.createElement("style");
        e.type = "text/css";
        e.innerHTML = `
:root{--bg-dark:#0a0a10;--menu-bg:#12121b;--primary-red:#e53935;--primary-rgb:229,57,53;--primary-dark:#b71c1c;--hover-red:#ff5252;--text-light:#ffffff;--text-dim:#a0a0b0;--input-bg:#1c1c29;--border-glow:rgba(var(--primary-rgb),0.45);--special-btn-bg:#ffffff;--special-btn-text:var(--primary-red)}
.nm-menu-container,.nm-menu-container *,#nm-floating-circle,#nm-floating-circle *,#nm-hud,#nm-hud *,.nm-toast{box-sizing:border-box;font-family:'Segoe UI','Cairo',Tahoma,Roboto,Arial,sans-serif}

/* ───────── Panel ───────── */
.nm-menu-container{position:fixed;display:none;flex-direction:column;gap:10px;width:680px;max-width:calc(100vw - 16px);min-height:570px;max-height:calc(100vh - 16px);padding:16px 16px 50px;background-color:var(--menu-bg);border-radius:22px;border:1px solid rgba(var(--primary-rgb),.28);box-shadow:0 24px 60px rgba(0,0,0,.7),0 0 40px rgba(var(--primary-rgb),.18),inset 0 1px 0 rgba(255,255,255,.07);z-index:2147482000;overflow:hidden;isolation:isolate}
.nm-menu-container.show{display:flex;animation:nmPop .28s cubic-bezier(.2,.9,.3,1.2)}
@keyframes nmPop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
.nm-menu-container::before{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;background:radial-gradient(520px 260px at 100% 0%,rgba(var(--primary-rgb),.16),transparent 70%),radial-gradient(420px 260px at 0% 100%,rgba(var(--primary-rgb),.10),transparent 70%)}
.nm-menu-container::after{content:"";position:absolute;top:0;left:0;right:0;height:2px;z-index:2;pointer-events:none;background:linear-gradient(90deg,transparent,var(--primary-red),var(--hover-red),var(--primary-red),transparent);background-size:200% 100%;animation:nmShimmer 3.2s linear infinite}
@keyframes nmShimmer{from{background-position:200% 0}to{background-position:-200% 0}}
.nm-menu-container>*{z-index:1}

.nm-close-btn{position:absolute;top:14px;left:14px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:10px;color:var(--text-dim);font-size:22px;line-height:1;padding:0;cursor:pointer;transition:all .2s}
.nm-close-btn:hover{color:#fff;background:rgba(var(--primary-rgb),.35);border-color:var(--primary-red);transform:rotate(90deg)}
.nm-special-top-btn{position:absolute;top:14px;right:14px;z-index:10;background:var(--special-btn-bg);color:var(--special-btn-text);border:none;padding:8px 14px;border-radius:10px;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 6px 16px rgba(0,0,0,.35);transition:all .2s}
.nm-special-top-btn:hover{transform:translateY(-2px);box-shadow:0 10px 22px rgba(0,0,0,.45);filter:brightness(1.08)}

.nm-menu-header{text-align:center;margin:6px 0 2px;display:flex;flex-direction:column;align-items:center;gap:6px}
.nm-menu-header h2{margin:0;color:var(--text-light);font-size:22px;font-weight:800;letter-spacing:.5px}
.nm-menu-header h2 span{color:var(--primary-red);text-shadow:0 0 18px rgba(var(--primary-rgb),.6)}
.nm-page-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 14px;border-radius:999px;font-size:11px;color:var(--text-dim);background:rgba(var(--primary-rgb),.12);border:1px solid rgba(var(--primary-rgb),.35)}
.nm-page-chip b{color:var(--text-light);background:var(--primary-red);min-width:20px;height:20px;line-height:20px;text-align:center;border-radius:10px;font-size:12px;box-shadow:0 0 10px rgba(var(--primary-rgb),.6)}

.nm-menu-body{display:flex;flex-direction:row;flex:1;gap:12px;margin-top:4px;width:100%;min-height:0}
.nm-side-nav{display:flex;flex-direction:column;gap:10px;width:54px}
.nm-tab-btn{position:relative;width:52px;height:52px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:14px;color:var(--text-dim);cursor:pointer;transition:all .25s ease}
.nm-tab-btn:hover{color:var(--text-light);background:rgba(var(--primary-rgb),.12);border-color:rgba(var(--primary-rgb),.35);transform:translateX(-3px)}
.nm-tab-btn.active{color:#fff;background:linear-gradient(135deg,rgba(var(--primary-rgb),.35),rgba(var(--primary-rgb),.12));border-color:var(--primary-red);box-shadow:0 0 18px rgba(var(--primary-rgb),.3),inset -3px 0 0 var(--primary-red)}

.nm-tab-content-container{flex:1;display:flex;flex-direction:column;position:relative;min-height:0;background:rgba(0,0,0,.28);border-radius:16px;border:1px solid rgba(255,255,255,.05);padding:12px;overflow:hidden;backdrop-filter:blur(6px)}
.nm-tab-pane{display:none;flex-direction:column;gap:14px;height:100%;width:100%;position:relative;overflow-y:auto}
.nm-tab-pane.active{display:flex;animation:nmFadeIn .3s ease}
@keyframes nmFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.nm-tab-pane::-webkit-scrollbar,.nm-lines-column::-webkit-scrollbar,.nm-customizations-list::-webkit-scrollbar,.nm-modal-body::-webkit-scrollbar{width:4px}
.nm-tab-pane::-webkit-scrollbar-thumb,.nm-lines-column::-webkit-scrollbar-thumb,.nm-customizations-list::-webkit-scrollbar-thumb,.nm-modal-body::-webkit-scrollbar-thumb{background:var(--primary-red);border-radius:4px}

/* ───────── Buttons / inputs ───────── */
.nm-action-buttons-row{display:flex;gap:12px}
.nm-btn-main{flex:1;height:40px;padding:0 12px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,var(--primary-red),var(--primary-dark));border:1px solid rgba(255,255,255,.1);border-radius:11px;box-shadow:0 6px 18px rgba(var(--primary-rgb),.3);transition:all .2s ease}
.nm-btn-main:hover{background:linear-gradient(135deg,var(--hover-red),var(--primary-red));box-shadow:0 10px 26px rgba(var(--primary-rgb),.5);transform:translateY(-2px)}
.nm-btn-main:active{transform:translateY(1px)}
.nm-timer-box,.nm-colors-box{display:inline-flex;align-items:center;gap:12px;padding:9px 14px;align-self:flex-start;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:12px}
.nm-timer-box h3,.nm-colors-box h3{margin:0;color:var(--text-light);font-size:13px;font-weight:700}
.nm-color-pickers-group{display:flex;gap:8px;flex-wrap:wrap;max-width:260px}
.nm-color-wrapper{position:relative;width:28px;height:28px;border-radius:8px;overflow:hidden;border:2px solid rgba(255,255,255,.18);cursor:pointer;transition:transform .2s,border-color .2s}
.nm-color-wrapper:hover{transform:scale(1.15);border-color:#fff}
.nm-color-wrapper input[type="color"]{position:absolute;top:-50%;left:-50%;width:200%;height:200%;cursor:pointer;border:none;padding:0}

.nm-toggle-switch{position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0}
.nm-toggle-switch input{opacity:0;width:0;height:0}
.nm-slider{position:absolute;inset:0;cursor:pointer;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.08);border-radius:24px;transition:.3s}
.nm-slider:before{content:"";position:absolute;height:16px;width:16px;left:4px;bottom:3px;background:var(--text-dim);border-radius:50%;transition:.3s}
.nm-toggle-switch input:checked+.nm-slider{background:rgba(var(--primary-rgb),.25);border-color:var(--primary-red)}
.nm-toggle-switch input:checked+.nm-slider:before{transform:translateX(20px);background:var(--primary-red);box-shadow:0 0 12px rgba(var(--primary-rgb),.7)}

.nm-upload-group{display:flex;gap:12px;width:100%;margin-top:auto}
.nm-upload-label{flex:1;display:flex;align-items:center;justify-content:center;padding:13px 10px;color:var(--text-dim);font-size:13px;font-weight:700;text-align:center;white-space:nowrap;cursor:pointer;background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.18);border-radius:12px;transition:all .2s}
.nm-upload-label:hover{color:#fff;background:rgba(var(--primary-rgb),.15);border-color:var(--primary-red)}
.nm-upload-label input[type="file"]{display:none}
.nm-empty-state{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:100%;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:15px;opacity:.5}

.nm-dark-input,.nm-dark-select{flex:1;padding:8px 10px;font-size:12px;color:var(--text-light);background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.12);border-radius:8px;outline:none;transition:border-color .2s,box-shadow .2s}
.nm-dark-input:focus,.nm-dark-select:focus{border-color:var(--primary-red);box-shadow:0 0 0 3px rgba(var(--primary-rgb),.2)}
.nm-dark-input.mini{width:54px;flex:none;text-align:center;padding:8px 4px}
.nm-dark-select{appearance:none;cursor:pointer}
.nm-dark-select option,.nm-mini-select option{background:#10101a}

/* ───────── Customizations ───────── */
.nm-tab-header{display:flex;justify-content:flex-start;margin:3px 3px 5px 0}
.nm-customizations-list{display:flex;flex-direction:column;gap:10px;flex:1;overflow-y:auto;padding-right:5px;position:relative}
.nm-cust-item{display:flex;align-items:center;justify-content:space-between;padding:11px 15px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:12px;transition:all .25s}
.nm-cust-item:hover{border-color:rgba(var(--primary-rgb),.4);transform:translateX(-2px)}
.nm-cust-item.disabled{opacity:.45}
.nm-cust-info{display:flex;align-items:center;gap:10px}
.nm-cust-info h4{margin:0;font-size:13px;color:var(--text-light)}
.nm-cust-key-badge{padding:2px 8px;font-size:10px;font-weight:800;color:var(--primary-red);background:var(--input-bg);border:1px solid rgba(var(--primary-rgb),.4);border-radius:6px}
.nm-cust-actions{display:flex;gap:8px}
.nm-btn-mini{padding:5px 11px;font-size:11px;color:var(--text-light);background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);border-radius:8px;cursor:pointer;transition:all .2s}
.nm-btn-mini:hover{background:rgba(255,255,255,.18)}
.nm-btn-mini.danger{color:var(--hover-red);background:rgba(var(--primary-rgb),.18);border-color:rgba(var(--primary-rgb),.5)}

.nm-modal{position:absolute;inset:0;z-index:2000;display:none;flex-direction:column;padding:20px;background:rgba(8,8,14,.92);backdrop-filter:blur(8px);border-radius:16px}
.nm-modal.show{display:flex;animation:nmFadeIn .2s ease-out}
.nm-modal-header h3{margin:0 0 14px;padding-bottom:10px;color:var(--text-light);font-size:16px;border-bottom:1px solid rgba(255,255,255,.1)}
.nm-modal-body{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:14px;padding-right:5px}
.nm-modal-row{display:flex;align-items:center;gap:14px}
.nm-row-label{width:88px;flex-shrink:0;font-size:12px;font-weight:700;color:var(--text-dim)}
.nm-segment-control{display:flex;gap:1px;overflow:hidden;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);border-radius:9px}
.nm-segment-item{flex:1}
.nm-segment-item input{display:none}
.nm-segment-item label{display:flex;align-items:center;justify-content:center;padding:7px 16px;font-size:12px;color:var(--text-dim);white-space:nowrap;cursor:pointer;background:rgba(0,0,0,.6);transition:all .2s}
.nm-segment-item input:checked+label{color:#fff;font-weight:800;background:rgba(var(--primary-rgb),.3)}
.nm-timer-mini-group{display:flex;align-items:center;gap:8px}
.nm-ms-text{font-size:11px;color:var(--text-dim)}
.nm-actions-list{display:flex;flex-direction:column;gap:8px}
.nm-action-row{display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:10px}
.nm-action-row span{font-size:11px;color:var(--text-dim);white-space:nowrap}
.nm-btn-icon{display:flex;align-items:center;justify-content:center;padding:5px;background:transparent;border:none;border-radius:6px;color:var(--text-dim);cursor:pointer;transition:all .2s}
.nm-btn-icon:hover{color:#fff;background:rgba(255,255,255,.1)}
.nm-btn-icon.nm-danger-icon:hover{color:var(--hover-red);background:rgba(var(--primary-rgb),.2)}
.nm-modal-footer{display:flex;gap:10px;justify-content:flex-end;align-items:center;margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.06)}

/* ───────── Lines tab ───────── */
.nm-lines-hint{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:10px}
.nm-lines-hint span{padding:4px 12px;font-size:11px;font-weight:700;color:var(--text-light);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:999px}
.nm-lines-hint span.pin{background:rgba(var(--primary-rgb),.2);border-color:rgba(var(--primary-rgb),.55)}
.nm-lines-container{display:flex;justify-content:center;gap:12px;height:100%}
.nm-lines-column{flex:1;display:flex;flex-direction:column;padding:14px 18px;overflow-y:auto;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:14px}
.nm-lines-title{text-align:center;margin-bottom:10px;padding-bottom:8px;font-size:15px;font-weight:800;color:var(--primary-red);border-bottom:1px solid rgba(255,255,255,.06)}
.nm-line-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:1;min-height:38px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.03)}
.nm-line-row:last-child{border-bottom:none}
.nm-line-name{width:96px;font-size:13px;font-weight:700;color:var(--text-light);white-space:nowrap}
.nm-line-state{min-width:62px;text-align:center;padding:3px 8px;font-size:10px;font-weight:800;color:var(--text-dim);background:rgba(255,255,255,.05);border:1px solid transparent;border-radius:999px;transition:all .25s}
.nm-line-state.nm-st-line{color:#fff;background:rgba(var(--primary-rgb),.2);border-color:rgba(var(--primary-rgb),.55)}
.nm-line-state.nm-st-pin{color:#fff;background:linear-gradient(135deg,var(--primary-red),var(--primary-dark));box-shadow:0 0 14px rgba(var(--primary-rgb),.7);animation:nmPinPulse 1.3s infinite alternate}
@keyframes nmPinPulse{from{box-shadow:0 0 6px rgba(var(--primary-rgb),.5)}to{box-shadow:0 0 18px rgba(var(--primary-rgb),.95)}}
.nm-mini-select{width:108px;height:28px;padding:0 6px;font-size:11px;color:var(--text-light);background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.12);border-radius:8px;outline:none;cursor:pointer;appearance:none}

/* ───────── REC / key box ───────── */
.nm-controls-group{display:flex;align-items:center;gap:8px}
.nm-key-box{width:52px;height:30px;display:flex;justify-content:center;align-items:center;font-size:12px;font-weight:800;color:var(--primary-red);text-transform:uppercase;background:var(--input-bg);border:2px solid #2d2d40;border-radius:8px;box-shadow:inset 0 3px 6px rgba(0,0,0,.35);transition:all .3s}
.nm-key-box.recording{border-color:var(--primary-red);animation:nmPulseBorder 1.2s infinite alternate}
@keyframes nmPulseBorder{0%{box-shadow:0 0 5px var(--border-glow)}100%{box-shadow:0 0 20px var(--hover-red);border-color:var(--hover-red)}}
.nm-btn-rec{height:30px;padding:0 12px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);background:transparent;border:2px solid #3a3a50;border-radius:8px;cursor:pointer;transition:all .25s}
.nm-btn-rec:hover{color:#fff;border-color:var(--primary-red);background:rgba(var(--primary-rgb),.12)}
.nm-btn-rec.recording{color:#fff;background:var(--primary-red);border-color:var(--primary-red);animation:nmPulseBg 1s infinite alternate}
@keyframes nmPulseBg{0%{opacity:1}100%{opacity:.78}}

/* ───────── Footer / status ───────── */
.nm-footer-rights{position:absolute;bottom:10px;right:14px;text-align:right;font-size:11px;line-height:1.5;color:var(--text-dim);opacity:.4;transition:opacity .3s;cursor:default}
.nm-footer-rights:hover{opacity:.85}
.nm-status-container{position:absolute;bottom:14px;left:18px;display:flex;align-items:center;gap:8px;user-select:none}
.nm-status-text{font-size:12px;color:rgba(255,255,255,.6)}
.nm-status-dot{width:10px;height:10px;background:#ff3b3b;border-radius:50%;transition:all .4s}
.nm-status-dot.connected{background:#00e676;box-shadow:0 0 6px #00e676,0 0 12px #00e676;animation:nmPulseGreen 1.5s infinite alternate}
@keyframes nmPulseGreen{0%{opacity:.8;box-shadow:0 0 3px #00e676}100%{opacity:1;box-shadow:0 0 10px #00e676,0 0 18px #00e676}}

/* ───────── Floating icon ───────── */
#nm-floating-circle{position:fixed;top:30px;left:30px;width:62px;height:62px;display:flex;align-items:center;justify-content:center;border-radius:50%;background-color:var(--primary-red);background-image:radial-gradient(circle at 30% 25%,rgba(255,255,255,.35),transparent 55%);background-size:cover;background-position:center;box-shadow:0 8px 24px rgba(0,0,0,.6),0 0 0 3px rgba(255,255,255,.08),0 0 26px rgba(var(--primary-rgb),.6);cursor:grab;z-index:2147482500;user-select:none;transition:transform .2s,box-shadow .3s}
#nm-floating-circle:hover{transform:scale(1.08);box-shadow:0 10px 28px rgba(0,0,0,.65),0 0 0 3px rgba(255,255,255,.14),0 0 34px rgba(var(--primary-rgb),.85)}
#nm-floating-circle:active{cursor:grabbing;transform:scale(.94)}
#nm-floating-circle::before{content:"";position:absolute;inset:-6px;border-radius:50%;pointer-events:none;background:conic-gradient(from 0deg,transparent 0 50%,var(--hover-red) 85%,#fff 100%);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 3px));mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 3px));animation:nmSpin 3s linear infinite}
@keyframes nmSpin{to{transform:rotate(360deg)}}
#nm-floating-circle .nm-glyph{display:flex;pointer-events:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}
#nm-floating-circle[style*="url("] .nm-glyph{opacity:0}
#nm-floating-circle .nm-page-badge{position:absolute;right:-6px;bottom:-6px;min-width:24px;height:24px;padding:0 5px;text-align:center;font-size:13px;font-weight:900;line-height:20px;color:#fff;background:#0b0b12;border:2px solid var(--primary-red);border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.6),0 0 10px rgba(var(--primary-rgb),.6);pointer-events:none}

/* ───────── HUD / toast ───────── */
#nm-hud{position:fixed;top:16px;left:50%;transform:translateX(-50%);display:none;flex-direction:column;align-items:center;gap:6px;z-index:2147483000;pointer-events:none}
.nm-hud-tag{padding:6px 16px;font-size:13px;font-weight:800;color:#fff;background:rgba(10,10,16,.88);border:1.5px solid rgba(255,255,255,.7);border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.55);animation:clHudIn .3s cubic-bezier(.18,.89,.32,1.28)}
.nm-hud-tag.nm-hud-pin{border-color:var(--primary-red);box-shadow:0 0 16px rgba(var(--primary-rgb),.7),0 6px 18px rgba(0,0,0,.55)}
@keyframes clHudIn{from{opacity:0;transform:translateY(-16px)}to{opacity:1;transform:none}}
.nm-toast{position:fixed;bottom:34px;left:50%;transform:translateX(-50%);z-index:2147483000;padding:10px 20px;font-size:13px;font-weight:700;color:#fff;background:rgba(10,10,16,.92);border:1px solid var(--primary-red);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.6);animation:nmFadeIn .25s ease;transition:opacity .45s}
.nm-toast.out{opacity:0}
.nm-skip-hide{position:fixed!important;left:-99999px!important;top:-99999px!important;opacity:0!important;pointer-events:none!important}

.timer{font-family:'Arial',sans-serif;font-size:48px;font-weight:bold;text-shadow:2px 2px 4px rgba(0,0,0,.6)}
`;
        document.head.appendChild(e);
        let t = S.get("timerEnabled", "false") === "true";
        let o = S.get("timerColorMode", "random");
        let n = S.get("timerFixedColor", "#FFFFFF");
        timer = {
            started: false,
            element: null,
            interval: null,
            timeLeft: 60,
            start() {
                if (t) {
                    if (!this.started) {
                        this.started = true;
                        this.element = document.createElement("div");
                        this.element.style.position = "fixed";
                        this.element.style.top = "12px";
                        this.element.style.left = "50%";
                        this.element.style.transform = "translateX(-50%)";
                        this.element.style.zIndex = "999999";
                        this.element.style.pointerEvents = "none";
                        this.element.classList.add("timer");
                        document.body.appendChild(this.element);
                        this.timeLeft = 60;
                        this.updateTimerDisplay();
                        this.interval = setInterval(nativeify(() => {
                            try {
                                this.timeLeft--;
                                this.updateTimerDisplay();
                                if (this.timeLeft <= 0) {
                                    this.element.textContent = "0";
                                    clearInterval(this.interval);
                                    setTimeout(nativeify(() => { try { this.stop(); } catch (_) { } }, 'timerStop'), 1000);
                                }
                            } catch (_) { }
                        }, 'timerTick'), 1000);
                    }
                }
            },
            stop() {
                if (this.started) {
                    clearInterval(this.interval);
                    if (this.element) {
                        this.element.remove();
                        this.element = null;
                    }
                    this.started = false;
                    this.interval = null;
                    this.timeLeft = 60;
                }
            },
            updateTimerDisplay() {
                if (this.element) {
                    this.element.textContent = `${this.timeLeft}`;
                    this.element.style.color = o === "random" ? function () {
                        const e = "0123456789ABCDEF";
                        let t = "#";
                        for (let o = 0; o < 6; o++) {
                            t += e[Math.floor(Math.random() * 16)];
                        }
                        return t;
                    }() : n;
                }
            }
        };
        window.addEventListener("storage", nativeify(() => {
            try {
                t = S.get("timerEnabled", "false") === "true";
                o = S.get("timerColorMode", "random");
                n = S.get("timerFixedColor", "#FFFFFF");
                if (!t) { try { timer.stop(); } catch (_) { } }
            } catch (_) { }
        }, 'storageTimer'));
    } catch (_) { }
}
function applyStoredCustomizations() {
    try { updateAllUIElements(); } catch (_) { }
    try { updateCustomizationsUI(); } catch (_) { }
}
function observeChatMessages() {
    const e = (...e) => false;
    const t = /^started:\s*auto\s*reset\s*in\s*\d{1,3}\s*-\s*\d{1,3}\s*seconds!?$/i;
    const o = /^(auto reset canceled!|auto reset done!)$/i;
    let n = 0;
    let a = 0;
    const l = e => {
        const t = Date.now();
        if (e === "start") {
            return !(t < n) && (n = t + 4000, true);
        } else {
            return !(t < a) && (a = t + 4000, true);
        }
    };
    const i = e => (e || "").replace(/\s+/g, " ").trim();
    const m = new WeakSet();
    function r(n) {
        if (!n || n.nodeType !== 1) {
            return;
        }
        const a = n;
        if (m.has(a)) {
            return;
        }
        m.add(a);
        const r = function (e) {
            if (!e || e.nodeType !== 1) {
                return "";
            }
            const t = e.querySelector?.(".chat-message") || e;
            let o = "";
            try {
                const e = document.createTreeWalker(t, NodeFilter.SHOW_TEXT, null);
                for (let t = e.nextNode(); t; t = e.nextNode()) {
                    o += t.nodeValue + " ";
                }
            } catch {
                o = t.textContent || "";
            }
            return i(o).toLowerCase();
        }(a);
        if (!r) {
            return;
        }
        const d = t.test(r);
        const s = o.test(r);
        if ((d || s) && function (t) {
            const o = t.querySelector?.(".chat-name") || null;
            const n = t.querySelector?.(".chat-id") || null;
            if (o || n) {
                const t = i(o?.textContent || "");
                const a = i(n?.textContent || "");
                const l = t === "SERVER |📢" && /^0\|?$/.test(a);
                if (!l) {
                    e("reject (identity mismatch)", {
                        name: t,
                        id: a
                    });
                }
                return l;
            }
            return true;
        }(a)) {
            try {
                if (d && l("start")) {
                    timer.start();
                } else if (s && l("stop")) {
                    timer.stop();
                }
            } catch (e) { }
        }
    }
    new MutationObserver(e => {
        for (const t of e) {
            if (t.type === "characterData" && t.target?.parentElement) {
                r(t.target.parentElement);
            }
            if (t.addedNodes && t.addedNodes.length) {
                t.addedNodes.forEach(e => {
                    if (e.nodeType === 1) {
                        r(e);
                        e.querySelectorAll?.("div,span,p,li,section,article").forEach(r);
                    }
                });
            }
        }
    }).observe(document.documentElement, {
        childList: true,
        characterData: true,
        subtree: true
    });
}
function exportAllSettings() {
    try {
        // Ensure images are included from IDB if not yet loaded into memory
        Promise.all([
            panelBackgroundImage ? Promise.resolve(panelBackgroundImage) : ImageStore.get("panelBackgroundImage"),
            buttonBackgroundImage ? Promise.resolve(buttonBackgroundImage) : ImageStore.get("buttonBackgroundImage")
        ]).then(([panelImg, circleImg]) => {
            _doExportAllSettings(panelImg, circleImg);
        });
    } catch (_) { }
}
function _doExportAllSettings(panelImg, circleImg) {
    const e = {
        version: "1.0",
        timestamp: new Date().toISOString(),
        generalSettings: {
            oppositeHashName: oppositeHashName,
            buttonShape: buttonShape,
            buttonSize: buttonSize,
            panelBackgroundImage: panelImg || null,
            buttonBackgroundImage: circleImg || null
        },
        customizations: customizations,
        movementSettings: {
            left: {
                enabled: movementLeftEnabled,
                key: movementLeftKey,
                page: movementLeftPage
            },
            right: {
                enabled: movementRightEnabled,
                key: movementRightKey,
                page: movementRightPage
            },
            up: {
                enabled: movementUpEnabled,
                key: movementUpKey,
                page: movementUpPage
            },
            down: {
                enabled: movementDownEnabled,
                key: movementDownKey,
                page: movementDownPage
            },
            topLeft: {
                enabled: movementTopLeftEnabled,
                key: movementTopLeftKey,
                page: movementTopLeftPage
            },
            topRight: {
                enabled: movementTopRightEnabled,
                key: movementTopRightKey,
                page: movementTopRightPage
            },
            bottomLeft: {
                enabled: movementBottomLeftEnabled,
                key: movementBottomLeftKey,
                page: movementBottomLeftPage
            },
            bottomRight: {
                enabled: movementBottomRightEnabled,
                key: movementBottomRightKey,
                page: movementBottomRightPage
            }
        },
        normalSettings: {
            bottomLeft: {
                enabled: normalBottomLeftEnabled,
                key: normalBottomLeftKey,
                page: normalBottomLeftPage
            },
            middleBottom: {
                enabled: normalMiddleBottomEnabled,
                key: normalMiddleBottomKey,
                page: normalMiddleBottomPage
            },
            bottomRight: {
                enabled: normalBottomRightEnabled,
                key: normalBottomRightKey,
                page: normalBottomRightPage
            },
            left: {
                enabled: normalLeftEnabled,
                key: normalLeftKey,
                page: normalLeftPage
            },
            center: {
                enabled: normalCenterEnabled,
                key: normalCenterKey,
                page: normalCenterPage
            },
            right: {
                enabled: normalRightEnabled,
                key: normalRightKey,
                page: normalRightPage
            },
            topLeft: {
                enabled: normalTopLeftEnabled,
                key: normalTopLeftKey,
                page: normalTopLeftPage
            },
            top: {
                enabled: normalTopEnabled,
                key: normalTopKey,
                page: normalTopPage
            },
            topRight: {
                enabled: normalTopRightEnabled,
                key: normalTopRightKey,
                page: normalTopRightPage
            },
            topc: {
                enabled: normalTopcEnabled,
                key: normalTopcKey,
                page: normalTopcPage
            }
        },
        timerSettings: {
            enabled: S.get("timerEnabled", false),
            colorMode: S.get("timerColorMode", "random"),
            fixedColor: S.get("timerFixedColor", "#FFFFFF")
        },
        colorSettings: {
            nmColorMenuBg: S.get("nmColorMenuBg", "#1a1a24"),
            nmColorMenuShadow: S.get("nmColorMenuShadow", "#e53935"),
            nmColorCircleBg: S.get("nmColorCircleBg", "#e53935"),
            nmColorPrimary: S.get("nmColorPrimary", "#e53935"),
            nmColorTextLight: S.get("nmColorTextLight", "#ffffff"),
            nmColorTextDim: S.get("nmColorTextDim", "#a0a0b0"),
            nmColorSpecialBtn: S.get("nmColorSpecialBtn", "#ffffff")
        },
        nm3: nmExportExtra()
    };
    const t = JSON.stringify(e, null, 2);
    const o = new Blob([t], {
        type: "application/json"
    });
    const n = URL.createObjectURL(o);
    const a = document.createElement("a");
    a.href = n;
    a.download = `settings_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(n);
}
function createWarningModal(e, t) {
    try {
        const o = document.createElement("div");
        o.id = "importWarningModal";
        o.style.cssText = "\n      position: fixed;\n      top: 0;\n      left: 0;\n      width: 100%;\n      height: 100%;\n      background: rgba(0, 0, 0, 0.7);\n      display: flex;\n      justify-content: center;\n      align-items: center;\n      z-index: 10000;\n      font-family: Arial, sans-serif;\n    ";
        const n = document.createElement("div");
        n.style.cssText = "\n      background: linear-gradient(135deg, #fff3cd, #ffeaa7);\n      border: 2px solid #f39c12;\n      border-radius: 15px;\n      padding: 30px;\n      max-width: 500px;\n      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);\n      text-align: center;\n      color: #856404;\n    ";
        n.innerHTML = "\n      <div style=\"font-size: 48px; margin-bottom: 20px;\">⚠️</div>\n      <h2 style=\"margin: 0 0 20px 0; color: #d68910;\">تحذير مهم</h2>\n      <p style=\"margin: 15px 0; line-height: 1.6; font-size: 16px;\">\n        سيتم استبدال الإعدادات الحالية بالإعدادات المستوردة.<br>\n        <strong>ملاحظات مهمة:</strong><br>\n        • التخصيصات ستُحفظ إلا إذا وُجد تخصيص بنفس الاسم<br>\n        • الخلفيات الحالية ستُحذف وتُستبدل بالخلفيات المستوردة<br>\n        • جميع الإعدادات الأخرى ستُستبدل بالكامل\n      </p>\n      <div style=\"margin-top: 25px;\">\n        <button id=\"confirmImport\" style=\"\n          background: #e74c3c;\n          color: white;\n          border: none;\n          padding: 12px 25px;\n          margin: 0 10px;\n          border-radius: 8px;\n          cursor: pointer;\n          font-size: 16px;\n          font-weight: bold;\n        \">متابعة الاستيراد</button>\n        <button id=\"cancelImport\" style=\"\n          background: #95a5a6;\n          color: white;\n          border: none;\n          padding: 12px 25px;\n          margin: 0 10px;\n          border-radius: 8px;\n          cursor: pointer;\n          font-size: 16px;\n        \">إلغاء</button>\n      </div>\n    ";
        o.appendChild(n);
        document.body.appendChild(o);
        document.getElementById("confirmImport").addEventListener("click", () => {
            document.body.removeChild(o);
            e();
        });
        document.getElementById("cancelImport").addEventListener("click", () => {
            document.body.removeChild(o);
            t();
        });
        o.addEventListener("click", e => {
            if (e.target === o) {
                document.body.removeChild(o);
                t();
            }
        });
    } catch (_) { }
}
function importSettings(e) {
    try {
        const t = JSON.parse(e);
        if (!t.version) {
            throw new Error("ملف الإعدادات غير صالح");
        }
        try { if (t.nm3) nmImportExtra(t.nm3); } catch (_) { }
        if (t.generalSettings) {
            const e = t.generalSettings;
            if (e.oppositeHashName !== undefined) {
                oppositeHashName = e.oppositeHashName;
                S.set("oppositeHashName", oppositeHashName);
            }
            if (e.buttonShape !== undefined) {
                buttonShape = e.buttonShape;
                S.set("buttonShape", buttonShape);
            }
            if (e.buttonSize !== undefined) {
                buttonSize = e.buttonSize;
                S.set("buttonSize", buttonSize);
            }
            if (e.panelBackgroundImage !== undefined && e.panelBackgroundImage) {
                panelBackgroundImage = e.panelBackgroundImage;
                ImageStore.set("panelBackgroundImage", panelBackgroundImage);
            }
            if (e.buttonBackgroundImage !== undefined && e.buttonBackgroundImage) {
                buttonBackgroundImage = e.buttonBackgroundImage;
                ImageStore.set("buttonBackgroundImage", buttonBackgroundImage);
            }
        }
        if (t.customizations && Array.isArray(t.customizations)) {
            t.customizations.forEach(e => {
                const t = customizations.findIndex(t => t.name === e.name);
                if (t !== -1) {
                    customizations[t] = e;
                } else {
                    customizations.push(e);
                }
            });
            S.set("customizations", JSON.stringify(customizations));
        }
        if (t.movementSettings) {
            const e = t.movementSettings;
            Object.keys(e).forEach(t => {
                const o = e[t];
                switch (t) {
                    case "left":
                        movementLeftEnabled = o.enabled;
                        movementLeftKey = o.key;
                        movementLeftPage = o.page;
                        S.set("movementLeftEnabled", o.enabled.toString());
                        S.set("movementLeftKey", o.key);
                        S.set("movementLeftPage", o.page);
                        break;
                    case "right":
                        movementRightEnabled = o.enabled;
                        movementRightKey = o.key;
                        movementRightPage = o.page;
                        S.set("movementRightEnabled", o.enabled.toString());
                        S.set("movementRightKey", o.key);
                        S.set("movementRightPage", o.page);
                        break;
                    case "up":
                        movementUpEnabled = o.enabled;
                        movementUpKey = o.key;
                        movementUpPage = o.page;
                        S.set("movementUpEnabled", o.enabled.toString());
                        S.set("movementUpKey", o.key);
                        S.set("movementUpPage", o.page);
                        break;
                    case "down":
                        movementDownEnabled = o.enabled;
                        movementDownKey = o.key;
                        movementDownPage = o.page;
                        S.set("movementDownEnabled", o.enabled.toString());
                        S.set("movementDownKey", o.key);
                        S.set("movementDownPage", o.page);
                        break;
                    case "topLeft":
                        movementTopLeftEnabled = o.enabled;
                        movementTopLeftKey = o.key;
                        movementTopLeftPage = o.page;
                        S.set("movementTopLeftEnabled", o.enabled.toString());
                        S.set("movementTopLeftKey", o.key);
                        S.set("movementTopLeftPage", o.page);
                        break;
                    case "topRight":
                        movementTopRightEnabled = o.enabled;
                        movementTopRightKey = o.key;
                        movementTopRightPage = o.page;
                        S.set("movementTopRightEnabled", o.enabled.toString());
                        S.set("movementTopRightKey", o.key);
                        S.set("movementTopRightPage", o.page);
                        break;
                    case "bottomLeft":
                        movementBottomLeftEnabled = o.enabled;
                        movementBottomLeftKey = o.key;
                        movementBottomLeftPage = o.page;
                        S.set("movementBottomLeftEnabled", o.enabled.toString());
                        S.set("movementBottomLeftKey", o.key);
                        S.set("movementBottomLeftPage", o.page);
                        break;
                    case "bottomRight":
                        movementBottomRightEnabled = o.enabled;
                        movementBottomRightKey = o.key;
                        movementBottomRightPage = o.page;
                        S.set("movementBottomRightEnabled", o.enabled.toString());
                        S.set("movementBottomRightKey", o.key);
                        S.set("movementBottomRightPage", o.page);
                }
            });
        }
        if (t.normalSettings) {
            const e = t.normalSettings;
            Object.keys(e).forEach(t => {
                const o = e[t];
                switch (t) {
                    case "bottomLeft":
                        normalBottomLeftEnabled = o.enabled;
                        normalBottomLeftKey = o.key;
                        normalBottomLeftPage = o.page;
                        S.set("normalBottomLeftEnabled", o.enabled.toString());
                        S.set("normalBottomLeftKey", o.key);
                        S.set("normalBottomLeftPage", o.page);
                        break;
                    case "middleBottom":
                        normalMiddleBottomEnabled = o.enabled;
                        normalMiddleBottomKey = o.key;
                        normalMiddleBottomPage = o.page;
                        S.set("normalMiddleBottomEnabled", o.enabled.toString());
                        S.set("normalMiddleBottomKey", o.key);
                        S.set("normalMiddleBottomPage", o.page);
                        break;
                    case "bottomRight":
                        normalBottomRightEnabled = o.enabled;
                        normalBottomRightKey = o.key;
                        normalBottomRightPage = o.page;
                        S.set("normalBottomRightEnabled", o.enabled.toString());
                        S.set("normalBottomRightKey", o.key);
                        S.set("normalBottomRightPage", o.page);
                        break;
                    case "left":
                        normalLeftEnabled = o.enabled;
                        normalLeftKey = o.key;
                        normalLeftPage = o.page;
                        S.set("normalLeftEnabled", o.enabled.toString());
                        S.set("normalLeftKey", o.key);
                        S.set("normalLeftPage", o.page);
                        break;
                    case "center":
                        normalCenterEnabled = o.enabled;
                        normalCenterKey = o.key;
                        normalCenterPage = o.page;
                        S.set("normalCenterEnabled", o.enabled.toString());
                        S.set("normalCenterKey", o.key);
                        S.set("normalCenterPage", o.page);
                        break;
                    case "right":
                        normalRightEnabled = o.enabled;
                        normalRightKey = o.key;
                        normalRightPage = o.page;
                        S.set("normalRightEnabled", o.enabled.toString());
                        S.set("normalRightKey", o.key);
                        S.set("normalRightPage", o.page);
                        break;
                    case "topLeft":
                        normalTopLeftEnabled = o.enabled;
                        normalTopLeftKey = o.key;
                        normalTopLeftPage = o.page;
                        S.set("normalTopLeftEnabled", o.enabled.toString());
                        S.set("normalTopLeftKey", o.key);
                        S.set("normalTopLeftPage", o.page);
                        break;
                    case "top":
                        normalTopEnabled = o.enabled;
                        normalTopKey = o.key;
                        normalTopPage = o.page;
                        S.set("normalTopEnabled", o.enabled.toString());
                        S.set("normalTopKey", o.key);
                        S.set("normalTopPage", o.page);
                        break;
                    case "topRight":
                        normalTopRightEnabled = o.enabled;
                        normalTopRightKey = o.key;
                        normalTopRightPage = o.page;
                        S.set("normalTopRightEnabled", o.enabled.toString());
                        S.set("normalTopRightKey", o.key);
                        S.set("normalTopRightPage", o.page);
                        break;
                    case "topc":
                        normalTopcEnabled = o.enabled;
                        normalTopcKey = o.key;
                        normalTopcPage = o.page;
                        S.set("normalTopcEnabled", o.enabled.toString());
                        S.set("normalTopcKey", o.key);
                        S.set("normalTopcPage", o.page);
                }
            });
        }
        if (t.timerSettings) {
            const e = t.timerSettings;
            if (e.enabled !== undefined) {
                timerEnabled = e.enabled;
                S.set("timerEnabled", e.enabled.toString());
            }
            if (e.colorMode !== undefined) {
                timerColorMode = e.colorMode;
                S.set("timerColorMode", e.colorMode);
            }
            if (e.fixedColor !== undefined) {
                timerFixedColor = e.fixedColor;
                S.set("timerFixedColor", e.fixedColor);
            }
        }
        updateCustomizationsUI();
        updateAllUIElements();
        const o = document.getElementById("controlPanel");
        if (o && panelBackgroundImage) {
            o.style.backgroundImage = `linear-gradient(rgba(26,26,36,0.85),rgba(15,15,19,0.95)),url(${panelBackgroundImage})`;
            o.style.backgroundSize = "cover";
            o.style.backgroundPosition = "center";
        }
        const circle = document.getElementById("nm-floating-circle");
        if (circle && buttonBackgroundImage) {
            circle.style.backgroundImage = `url(${buttonBackgroundImage})`;
        }
        settingsChannel.postMessage({
            type: "settings_imported",
            data: t
        });
        alert("تم استيراد الإعدادات بنجاح! ✅");
    } catch (e) {
        alert("خطأ في استيراد الإعدادات: " + e.message);
    }
}
function updateAllUIElements() {
    try {
        // Restore 7 color pickers
        const colorMap = {
            "nm-color-menu-bg": S.get("nmColorMenuBg", "#1a1a24"),
            "nm-color-menu-shadow": S.get("nmColorMenuShadow", "#e53935"),
            "nm-color-circle-bg": S.get("nmColorCircleBg", "#e53935"),
            "nm-color-primary": S.get("nmColorPrimary", "#e53935"),
            "nm-color-text-light": S.get("nmColorTextLight", "#ffffff"),
            "nm-color-text-dim": S.get("nmColorTextDim", "#a0a0b0"),
            "nm-color-special-btn": S.get("nmColorSpecialBtn", "#ffffff"),
        };
        Object.entries(colorMap).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        });
        // Apply stored CSS vars
        const primary = S.get("nmColorPrimary", null);
        if (primary) {
            document.documentElement.style.setProperty("--primary-red", primary);
            // Restore derived vars
            try {
                const r = parseInt(primary.slice(1, 3), 16), g = parseInt(primary.slice(3, 5), 16), b = parseInt(primary.slice(5, 7), 16);
                document.documentElement.style.setProperty("--primary-rgb", `${r},${g},${b}`);
                const hr = Math.min(255, Math.round(r + (255 - r) * 0.2)), hg = Math.min(255, Math.round(g + (255 - g) * 0.2)), hb = Math.min(255, Math.round(b + (255 - b) * 0.2));
                document.documentElement.style.setProperty("--hover-red", `rgb(${hr},${hg},${hb})`);
                const dr = Math.round(r * 0.65), dg = Math.round(g * 0.65), db = Math.round(b * 0.65);
                document.documentElement.style.setProperty("--primary-dark", `rgb(${dr},${dg},${db})`);
            } catch (_) { }
        }
        const tl = S.get("nmColorTextLight", null);
        if (tl) document.documentElement.style.setProperty("--text-light", tl);
        const td = S.get("nmColorTextDim", null);
        if (td) document.documentElement.style.setProperty("--text-dim", td);
        const sb = S.get("nmColorSpecialBtn", null);
        if (sb) document.documentElement.style.setProperty("--special-btn-bg", sb);
        // Apply panel/circle stored colors
        const panel = document.getElementById("controlPanel");
        const circle = document.getElementById("nm-floating-circle");
        const menuBg = S.get("nmColorMenuBg", null);
        if (panel && menuBg) { panel.style.backgroundColor = menuBg; }
        const circleBg = S.get("nmColorCircleBg", null);
        if (circle && circleBg) { circle.style.backgroundColor = circleBg; }
        // multi toggle
        const mt = document.getElementById("multi-toggle");
        if (mt) mt.checked = multiEnabled;
        updateMovementUIElements();
        updateNormalUIElements();
        updateTimerUIElements();
    } catch (_) { }
}
function _syncLineRow(prefix, dirCap, enabled, key, page) {
    try {
        const toggle = document.getElementById(`${prefix}${dirCap}Enabled`);
        const pageSel = document.getElementById(`${prefix}${dirCap}PageSelect`);
        const keyBox = document.getElementById(`${prefix}${dirCap}KeyBox`);
        if (toggle) toggle.checked = enabled;
        if (pageSel) pageSel.value = page;
        if (keyBox) keyBox.textContent = (key && key !== "None") ? (_codeToDisplay[key] || key) : "";
    } catch (_) { }
}
function updateMovementUIElements() {
    try {
        _syncLineRow("movement", "Right", movementRightEnabled, movementRightKey, movementRightPage);
        _syncLineRow("movement", "Left", movementLeftEnabled, movementLeftKey, movementLeftPage);
        _syncLineRow("movement", "Up", movementUpEnabled, movementUpKey, movementUpPage);
        _syncLineRow("movement", "Down", movementDownEnabled, movementDownKey, movementDownPage);
        _syncLineRow("movement", "TopLeft", movementTopLeftEnabled, movementTopLeftKey, movementTopLeftPage);
        _syncLineRow("movement", "TopRight", movementTopRightEnabled, movementTopRightKey, movementTopRightPage);
        _syncLineRow("movement", "BottomLeft", movementBottomLeftEnabled, movementBottomLeftKey, movementBottomLeftPage);
        _syncLineRow("movement", "BottomRight", movementBottomRightEnabled, movementBottomRightKey, movementBottomRightPage);
    } catch (_) { }
}
function updateNormalUIElements() {
    try {
        _syncLineRow("normal", "BottomLeft", normalBottomLeftEnabled, normalBottomLeftKey, normalBottomLeftPage);
        _syncLineRow("normal", "MiddleBottom", normalMiddleBottomEnabled, normalMiddleBottomKey, normalMiddleBottomPage);
        _syncLineRow("normal", "BottomRight", normalBottomRightEnabled, normalBottomRightKey, normalBottomRightPage);
        _syncLineRow("normal", "Left", normalLeftEnabled, normalLeftKey, normalLeftPage);
        _syncLineRow("normal", "Center", normalCenterEnabled, normalCenterKey, normalCenterPage);
        _syncLineRow("normal", "Right", normalRightEnabled, normalRightKey, normalRightPage);
        _syncLineRow("normal", "TopLeft", normalTopLeftEnabled, normalTopLeftKey, normalTopLeftPage);
        _syncLineRow("normal", "Top", normalTopEnabled, normalTopKey, normalTopPage);
        _syncLineRow("normal", "TopRight", normalTopRightEnabled, normalTopRightKey, normalTopRightPage);
        _syncLineRow("normal", "Topc", normalTopcEnabled, normalTopcKey, normalTopcPage);
    } catch (_) { }
}
function updateTimerUIElements() {
    try {
        const e = boolFrom(S.get("timerEnabled", false));
        const t = S.get("timerColorMode", "random");
        const o = S.get("timerFixedColor", "#FFFFFF");
        timerEnabled = e; timerColorMode = t; timerFixedColor = o;
        const toggleEl = document.getElementById("timerEnabled");
        const modeEl = document.getElementById("timerColorMode");
        const colorEl = document.getElementById("timerFixedColor");
        const boxEl = document.getElementById("timerSettingsContainer");
        if (toggleEl) { toggleEl.checked = e; if (boxEl) boxEl.style.display = e ? "inline-flex" : "none"; }
        if (modeEl) { modeEl.value = t; if (colorEl) colorEl.style.display = t === "fixed" ? "inline-block" : "none"; }
        if (colorEl) colorEl.value = o;
    } catch (_) { }
}
(async () => {
    try { await ensureMyTabId(); } catch (_) { }
    try { setupFocusSignalListener(); } catch (_) { }
    try { maybeClaimPairFromHash(); } catch (_) { }
})();

// ══════════════════════════════════════════════════════════════════════════════
// PIN engine (double press) - works for ALL 8 directions.
// Absolute: the game never sees the real mouse, every packet it makes is dropped,
// and our own packet is forced through at ~60/s (also in a background tab).
// ══════════════════════════════════════════════════════════════════════════════
(function initPinEngine() {
    'use strict';

    const ORDER = ["Left", "Right", "Up", "Down", "TopLeft", "TopRight", "BottomLeft", "BottomRight"];

    // A pin must push the SAME packet coordinate a single-press line already pushes
    // (MOUSE_MOVE_COORDS, ~1e7 magnitude) - not a separate, far more extreme value.
    // An old build pinned corners to coordinates near the int32 limit (~2.1 billion)
    // while plain lines used ~1e7; that huge mismatch is what made a pinned corner
    // behave erratically (overflow/clamping on the server side) while a normal line
    // on the same direction worked fine. Keeping pin and line on one shared scale
    // fixes that for all 8 directions, corners included.
    function coordsFor(k) {
        const w = window.innerWidth, h = window.innerHeight;
        const c = MOUSE_MOVE_COORDS[k];
        if (!c) return null;
        const x = c.x(w), y = c.y(h);
        // sx/sy are only for the cosmetic synthetic mouse/pointer dispatch (never sent
        // to the server), clamped to stay near the real viewport so listeners that read
        // clientX/clientY for layout math don't choke on an astronomical value.
        const sx = Math.max(-100000, Math.min(w + 100000, x));
        const sy = Math.max(-100000, Math.min(h + 100000, y));
        return { x: x, y: y, sx: sx, sy: sy };
    }

    window.clActive = {};
    ORDER.forEach(k => { window.clActive[k] = false; });
    window._clBypass = false;
    window._clAllowNext = false;

    const anyActive = () => ORDER.some(k => window.clActive[k]);
    const inOurUI = (t) => { try { return !!(t && t.closest && t.closest("#controlPanel,#nm-floating-circle,#nm-setup-overlay")); } catch (_) { return false; } };

    const BLOCKED = ['mousemove', 'mouseenter', 'mouseover', 'mouseout', 'mouseleave', 'pointermove', 'pointerenter', 'pointerover'];
    const blocker = nativeify(function clMouseBlocker(ev) {
        try {
            if (window._clBypass) return;
            if (!anyActive()) return;
            if (inOurUI(ev.target)) return;
            ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
        } catch (_) { }
    }, 'clMouseBlocker');
    BLOCKED.forEach(type => {
        try { document.addEventListener(type, blocker, true); } catch (_) { }
        try { window.addEventListener(type, blocker, true); } catch (_) { }
    });

    window.__loader_on_ws_send && window.__loader_on_ws_send((ws, data) => {
        // Same reasoning as above: _clBypass never exempts a packet from this check.
        try {
            if (anyActive()) {
                let opcode = -1;
                if (data instanceof ArrayBuffer && data.byteLength >= 1) opcode = new Uint8Array(data)[0];
                else if (data && data.buffer instanceof ArrayBuffer && data.byteLength >= 1) opcode = new Uint8Array(data.buffer, data.byteOffset, 1)[0];
                if (opcode === 16) {
                    if (window._clAllowNext) { window._clAllowNext = false; return; }
                    window.__nmStat.drop++;
                    return false;
                }
            }
        } catch (_) { }
    });

    function forceSend(k) {
        try {
            const c = coordsFor(k);
            if (!c) return;
            const target = document.querySelector('canvas') || document.documentElement;
            const opts = { bubbles: true, cancelable: true, composed: true, clientX: c.sx, clientY: c.sy, button: 0, buttons: 0 };
            // _clBypass here is ONLY read by the DOM mouse-event blocker above, so our own
            // cosmetic synthetic events reach the canvas instead of being swallowed by it.
            // It must stay false for ws.send() purposes - see the comment on the corner-lock
            // check in WrapWS. The real packet below goes out through ws._clRawSend, the
            // original unwrapped send, so it never touches that filter either way.
            window._clBypass = true;
            try {
                try {
                    if (window.PointerEvent) target.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, opts, { pointerId: 1, pointerType: 'mouse', isPrimary: true })));
                } catch (_) { }
                try { target.dispatchEvent(new MouseEvent('mousemove', opts)); } catch (_) { }
                const buf = pkt_move(c.x, c.y);
                if (buf) {
                    const sessions = window.__loader_sessions || [];
                    for (let i = sessions.length - 1; i >= 0; i--) {
                        const ws = sessions[i];
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            const raw = ws._clRawSend || ws.send;
                            try { raw.call(ws, buf); } catch (_) { }
                        }
                    }
                }
                window.__nmStat.forced++; window.__nmStat.x = c.x; window.__nmStat.y = c.y;
            } finally { window._clBypass = false; }
        } catch (_) { window._clBypass = false; }
    }

    let tickerOn = false;
    function ensureTicker() {
        if (tickerOn) return;
        tickerOn = true;
        nmTicker(() => { try { ORDER.forEach(k => { if (window.clActive[k]) forceSend(k); }); } catch (_) { } }, 16);
    }

    function activate(k) {
        if (!(k in window.clActive)) return;
        window.activeMovementLock = null;
        window.activeNormalLock = null;
        window.nmLinePinned = false;
        ORDER.forEach(o => { window.clActive[o] = false; });   // one pinned direction at a time
        window.clActive[k] = true;
        ensureTicker();
        forceSend(k);
    }
    function deactivate(k) { window.clActive[k] = false; }
    function releaseAll() { ORDER.forEach(o => { window.clActive[o] = false; }); }
    function isActive(k) { return !!window.clActive[k]; }

    defineHidden(window, '__nmCorner', { activate, deactivate, releaseAll, isActive });
})();

// ══════════════════════════════════════════════════════════════════════════════
// Packet recorder: shows exactly what THIS page sends to the game server
// (so a feature like mute / admin can be rebuilt from the real packet).
// ══════════════════════════════════════════════════════════════════════════════
const NMREC = (function () {
    const st = { on: S.get("recOn", "false") === "true", hideMouse: S.get("recHideMouse", "true") !== "false", rows: [], t0: Date.now() };
    const hex2 = (b) => (b < 16 ? "0" : "") + b.toString(16);
    function bytesOf(data) {
        try {
            if (data instanceof ArrayBuffer) return new Uint8Array(data);
            if (data && data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
        } catch (_) { }
        return null;
    }
    function guessText(u8) {
        try {
            const t = new TextDecoder("utf-8", { fatal: true }).decode(u8.subarray(1));
            if (/^[\x20-\x7E\u0600-\u06FF]{2,}$/.test(t)) return t;
        } catch (_) { }
        for (let off = 1; off <= 3 && off < u8.length; off++) {          // UTF-16LE, typical for agar-style packets
            let s = "", good = 0, n = 0;
            for (let i = off; i + 1 < u8.length; i += 2) {
                const c = u8[i] | (u8[i + 1] << 8);
                if (c === 0) break;
                n++; s += String.fromCharCode(c);
                if (c >= 32 && c !== 127) good++;
            }
            if (n >= 2 && good / n > 0.8) return s;
        }
        return "";
    }
    function add(data) {
        if (!st.on) return;
        let type = "bin", hex = "", text = "", op = -1, len = 0;
        const u8 = bytesOf(data);
        if (typeof data === "string") { type = "text"; text = data.slice(0, 300); len = data.length; }
        else if (u8) {
            len = u8.length; op = len ? u8[0] : -1;
            if (st.hideMouse && op === 16 && len === 13) return;
            const n = Math.min(len, 64), a = [];
            for (let i = 0; i < n; i++) a.push(hex2(u8[i]));
            hex = a.join(" ") + (len > n ? " …" : "");
            text = guessText(u8.subarray(0, Math.min(len, 400)));
        } else { type = "blob"; len = (data && data.size) || 0; }
        const last = st.rows[st.rows.length - 1];
        if (last && last.hex === hex && last.text === text && last.type === type) { last.n++; last.t = Date.now() - st.t0; return; }
        st.rows.push({ t: Date.now() - st.t0, type: type, len: len, op: op, hex: hex, text: text, n: 1 });
        if (st.rows.length > 300) st.rows.shift();
    }
    window.__loader_on_ws_send && window.__loader_on_ws_send((ws, data) => { try { add(data); } catch (_) { } });
    const line = (r) => "[" + (r.t / 1000).toFixed(2) + "s] " + r.type + " len=" + r.len + (r.op >= 0 ? " op=" + r.op : "") + (r.n > 1 ? " x" + r.n : "") +
        (r.hex ? " | " + r.hex : "") + (r.text ? " | text: " + r.text : "");
    return {
        st: st,
        set(k, v) { if (k === "on") { st.on = !!v; S.set("recOn", String(!!v)); if (v) st.t0 = Date.now(); } else if (k === "hideMouse") { st.hideMouse = !!v; S.set("recHideMouse", String(!!v)); } },
        clear() { st.rows.length = 0; st.t0 = Date.now(); },
        text(n) { const r = n ? st.rows.slice(-n) : st.rows; return r.map(line).join("\n"); }
    };
})();

// ══════════════════════════════════════════════════════════════════════════════
// Macro recorder / player — records real key presses you make (with their real
// timing) and replays them later with ONE press. Everything happens on your own
// page through the same key system already in the tool; nothing is sent to or
// about any other player.
// ══════════════════════════════════════════════════════════════════════════════
const NMMACRO = (function () {
    const KEY = "nm3_macros";
    let list = [];
    try { list = JSON.parse(S.get(KEY, "[]")) || []; } catch (_) { list = []; }
    const rec = { on: false, t0: 0, steps: [], name: "" };
    let playTimer = null, playing = false;

    function save() { try { S.set(KEY, JSON.stringify(list)); } catch (_) { } }
    function all() { return list; }

    function startRecord(name) {
        rec.on = true; rec.t0 = performance.now(); rec.steps = [];
        rec.name = (name && name.trim()) || ("ماكرو " + (list.length + 1));
    }
    function stopRecord() {
        if (!rec.on) return null;
        rec.on = false;
        if (!rec.steps.length) return null;
        const m = { name: rec.name, steps: rec.steps.slice(0, 400), key: "None" };
        list.push(m); save();
        return m;
    }
    function cancelRecord() { rec.on = false; rec.steps = []; }
    function captureKey(code) {
        if (!rec.on) return;
        if (rec.steps.length >= 400) return;
        rec.steps.push({ t: Math.round(performance.now() - rec.t0), code: code });
    }
    function removeAt(i) { if (list[i]) { list.splice(i, 1); save(); } }
    function setKeyFor(i, code) { if (list[i]) { list[i].key = code || "None"; save(); } }
    function renameAt(i, name) { if (list[i] && name && name.trim()) { list[i].name = name.trim(); save(); } }

    function play(i) {
        const m = list[i];
        if (!m || !m.steps.length || playing) return;
        playing = true;
        const fire = (idx) => {
            if (idx >= m.steps.length) { playing = false; return; }
            const step = m.steps[idx];
            try {
                window.__nmMacroReplay = true;
                window.dispatchEvent(new KeyboardEvent('keydown', { code: step.code, bubbles: true, cancelable: true }));
            } catch (_) { } finally { window.__nmMacroReplay = false; }
            const next = m.steps[idx + 1];
            const wait = next ? Math.max(0, next.t - step.t) : 0;
            playTimer = setTimeout(() => fire(idx + 1), wait);
        };
        fire(0);
    }
    function stopPlay() { if (playTimer) clearTimeout(playTimer); playTimer = null; playing = false; }
    function isPlaying() { return playing; }

    window.addEventListener("keydown", nativeify(function nmMacroHotkeys(e) {
        try {
            if (!e.isTrusted || e.repeat) return;
            if (rec.on) { captureKey(e.code); return; }
            for (let i = 0; i < list.length; i++) {
                if (list[i].key && list[i].key !== "None" && list[i].key === e.code) { play(i); break; }
            }
        } catch (_) { }
    }, 'nmMacroHotkeys'), true);

    return { all, startRecord, stopRecord, cancelRecord, removeAt, setKeyFor, renameAt, play, stopPlay, isPlaying, isRecording: () => rec.on, recName: () => rec.name, recLen: () => rec.steps.length };
})();

// ══════════════════════════════════════════════════════════════════════════════
// Size alerts — notices YOUR OWN ball's on-screen size changing fast (grew a lot
// after eating something, or shrank fast = danger) using the same canvas hook
// NMCOL already built to find "my" ball. Sound + screen flash only.
// ══════════════════════════════════════════════════════════════════════════════
const NMALERT = (function () {
    const cfg = {
        on: S.get("alOn", "false") === "true",
        growPct: Number(S.get("alGrowPct", "18")) || 18,
        shrinkPct: Number(S.get("alShrinkPct", "22")) || 22,
        sound: S.get("alSound", "true") !== "false"
    };
    let lastR = 0, cooldownUntil = 0, ac = null, events = [];
    function beep(freq, ms) {
        if (!cfg.sound) return;
        try {
            ac = ac || new (window.AudioContext || window.webkitAudioContext)();
            const o = ac.createOscillator(), g = ac.createGain();
            o.frequency.value = freq; o.type = "sine";
            g.gain.value = 0.08;
            o.connect(g); g.connect(ac.destination);
            o.start(); o.stop(ac.currentTime + ms / 1000);
        } catch (_) { }
    }
    function flash(color) {
        try {
            let el = document.getElementById("nm-flash");
            if (!el) {
                el = document.createElement("div"); el.id = "nm-flash";
                el.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .22s";
                document.documentElement.appendChild(el);
            }
            el.style.boxShadow = "inset 0 0 0 9999px " + color;
            el.style.opacity = "1";
            setTimeout(() => { el.style.opacity = "0"; }, 220);
        } catch (_) { }
    }
    function tick() {
        if (!cfg.on || !NMCOL || !NMCOL.radius) return;
        const r = NMCOL.radius();
        const now = performance.now();
        if (r > 0 && lastR > 0 && now > cooldownUntil) {
            const pct = (r - lastR) / lastR * 100;
            if (pct >= cfg.growPct) {
                beep(880, 120); flash("rgba(50,255,120,.18)"); cooldownUntil = now + 1200;
                events.unshift({ t: Date.now(), kind: "grow", pct: Math.round(pct) });
            } else if (pct <= -cfg.shrinkPct) {
                beep(220, 180); flash("rgba(255,60,60,.22)"); cooldownUntil = now + 1200;
                events.unshift({ t: Date.now(), kind: "shrink", pct: Math.round(pct) });
            }
            if (events.length > 30) events.length = 30;
        }
        if (r > 0) lastR = r;
    }
    setInterval(() => { try { tick(); } catch (_) { } }, 300);
    const KEYS = { on: "alOn", growPct: "alGrowPct", shrinkPct: "alShrinkPct", sound: "alSound" };
    function set(k, v) {
        if (!(k in KEYS)) return;
        cfg[k] = v;
        S.set(KEYS[k], String(v));
    }
    return { cfg, set, events: () => events, testSound: () => { beep(880, 120); flash("rgba(50,255,120,.18)"); } };
})();

// ══════════════════════════════════════════════════════════════════════════════
// Profiles — save/switch between several full named setups of the tool
// (lines/keys excluded on purpose — those stay per-page; colors/perf/alerts
// included) stored locally, nothing leaves your browser.
// ══════════════════════════════════════════════════════════════════════════════
const NMPROFILES = (function () {
    const KEY = "nm3_profiles";
    let store = {};
    try { store = JSON.parse(S.get(KEY, "{}")) || {}; } catch (_) { store = {}; }
    function save() { try { S.set(KEY, JSON.stringify(store)); } catch (_) { } }
    function names() { return Object.keys(store); }
    function saveAs(name) {
        if (!name || !name.trim()) return false;
        name = name.trim();
        store[name] = typeof nmExportExtra === "function" ? nmExportExtra() : {};
        save();
        return true;
    }
    function load(name) {
        const o = store[name];
        if (!o) return false;
        try { nmImportExtra(o); } catch (_) { }
        return true;
    }
    function remove(name) { if (store[name]) { delete store[name]; save(); } }
    return { names, saveAs, load, remove };
})();

// ══════════════════════════════════════════════════════════════════════════════
// Clip recorder — records the game canvas to a local .webm file you download,
// using the browser's own MediaRecorder. Nothing leaves your machine.
// ══════════════════════════════════════════════════════════════════════════════
const NMCAP = (function () {
    let rec = null, chunks = [], recording = false, startedAt = 0;
    function findCanvas() {
        const all = Array.from(document.querySelectorAll("canvas")).filter(c => c.id !== "kiro-overlay" && c.width > 50 && c.height > 50);
        return all.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] || null;
    }
    function start() {
        if (recording) return false;
        const canvas = findCanvas();
        if (!canvas || !canvas.captureStream) return false;
        try {
            const stream = canvas.captureStream(30);
            const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || "video/webm";
            rec = new MediaRecorder(stream, { mimeType: mime });
            chunks = [];
            rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
            rec.onstop = () => {
                try {
                    const blob = new Blob(chunks, { type: "video/webm" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = "agar-clip-" + Date.now() + ".webm";
                    document.body.appendChild(a); a.click(); a.remove();
                    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) { } }, 8000);
                } catch (_) { }
            };
            rec.start(250);
            recording = true; startedAt = Date.now();
            return true;
        } catch (_) { return false; }
    }
    function stop() {
        if (!recording) return;
        try { rec.stop(); } catch (_) { }
        recording = false;
    }
    return { start, stop, isRecording: () => recording, seconds: () => recording ? Math.floor((Date.now() - startedAt) / 1000) : 0 };
})();
