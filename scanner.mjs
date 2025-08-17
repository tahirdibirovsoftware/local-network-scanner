// ...existing code...
// This module contains the probing logic used to check ports.
export const DEFAULT_TIMEOUT_MS = 1200;

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function withTimeout(promiseFactory, ms, onAbort) {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
        ctrl.abort();
        onAbort && onAbort();
    }, ms);
    return Promise.race([
        promiseFactory(ctrl.signal),
        new Promise((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new Error('timeout'))))
    ]).finally(() => clearTimeout(t));
}

export function parsePorts(input) {
    return Array.from(new Set(
        input.split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(Number)
            .filter(n => Number.isFinite(n) && n > 0 && n < 65536)
    ));
}

export function schemeFor(port) {
    return port === 443 ? ['https', 'http'] : ['http', 'https'];
}

export async function probeFetch(host, port, proto, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const url = `${proto}://${host}:${port}/`;
    const t0 = performance.now();
    try {
        const res = await withTimeout(
            (signal) => fetch(url, { mode: 'no-cors', cache: 'no-store', signal }),
            timeoutMs
        );
        const dt = Math.round(performance.now() - t0);
        return { method: 'fetch', proto, status: 'open', latency: dt, detail: 'opaque/accessible' };
    } catch (e) {
        const dt = Math.round(performance.now() - t0);
        if (e && e.message === 'timeout') {
            return { method: 'fetch', proto, status: 'filtered', latency: dt, detail: 'timeout' };
        }
        return { method: 'fetch', proto, status: 'closed', latency: dt, detail: 'network-error' };
    }
}

export async function probeImg(host, port, proto, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const url = `${proto}://${host}:${port}/favicon.ico?${Math.random().toString(36).slice(2)}`;
    const t0 = performance.now();
    return new Promise((resolve) => {
        const im = new Image();
        let done = false;
        const finish = (status, detail) => {
            if (done) return;
            done = true;
            const dt = Math.round(performance.now() - t0);
            resolve({ method: 'img', proto, status, latency: dt, detail });
        };
        const timer = setTimeout(() => finish('filtered', 'timeout'), timeoutMs);
        im.onload = () => { clearTimeout(timer); finish('open', 'load'); };
        im.onerror = () => { clearTimeout(timer); finish('open', 'http-error-or-cross'); };
        im.src = url;
    });
}

export async function probeWS(host, port, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const url = `ws://${host}:${port}`;
    const t0 = performance.now();
    return new Promise((resolve) => {
        let finished = false;
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            try { ws.close(); } catch { }
            resolve({ method: 'ws', status: 'filtered', latency: Math.round(performance.now() - t0), detail: 'timeout' });
        }, timeoutMs);

        ws.onopen = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            ws.close();
            resolve({ method: 'ws', status: 'open', latency: Math.round(performance.now() - t0), detail: 'handshake-ok' });
        };
        ws.onerror = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve({ method: 'ws', status: 'closed', latency: Math.round(performance.now() - t0), detail: 'error' });
        };
    });
}

export async function checkPort(host, port, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const protos = schemeFor(port);
    const probes = [];

    probes.push(probeFetch(host, port, protos[0], timeoutMs));
    probes.push(probeImg(host, port, protos[0], timeoutMs));
    probes.push(probeWS(host, port, timeoutMs));
    probes.push(probeFetch(host, port, protos[1], timeoutMs));

    const results = await Promise.allSettled(probes);
    const vals = results.map(r => r.status === 'fulfilled' ? r.value : ({ method: '?', status: 'closed', detail: 'rejected' }));

    const hasOpen = vals.find(v => v.status === 'open');
    if (hasOpen) return { host, port, state: 'open', via: hasOpen.method, proto: hasOpen.proto || 'auto', latency: hasOpen.latency, detail: hasOpen.detail };

    const hasFiltered = vals.find(v => v.status === 'filtered');
    if (hasFiltered) return { host, port, state: 'filtered', via: hasFiltered.method, proto: hasFiltered.proto || 'auto', latency: hasFiltered.latency, detail: hasFiltered.detail };

    const closed = vals.filter(v => v.status === 'closed').sort((a, b) => (a.latency || 9e9) - (b.latency || 9e9))[0] || { detail: 'n/a' };
    return { host, port, state: 'closed', via: closed.method || '?', proto: closed.proto || 'auto', latency: closed.latency, detail: closed.detail };
}
