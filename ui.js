import { parsePorts, checkPort, sleep } from './scanner.mjs';

// Since detectLocalIPs uses WebRTC and was previously defined here, reimplement it locally.
export async function detectLocalIPs(timeoutMs = 2500) {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const ch = pc.createDataChannel('x');
    const ips = new Set();
    const reIP = /(?:(?:\b|^))(10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2})(?=$|\b)/;

    pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const c = e.candidate.candidate || '';
        const m = c.match(reIP);
        if (m) ips.add(m[1]);
    };

    await pc.setLocalDescription(await pc.createOffer());
    await Promise.race([sleep(timeoutMs), new Promise(r => pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r())]);
    try { ch.close(); pc.close(); } catch { }
    return Array.from(ips);
}

// UI helper functions
export function li(container, text, cls = '') {
    const el = document.createElement('li');
    el.className = 'mono';
    el.innerHTML = text;
    if (cls) el.classList.add(cls);
    container.appendChild(el);
    return el;
}

export function tag(text, kind = 'muted') {
    return `<span class="tag ${kind}">${text}</span>`;
}

// Queue with concurrency
export async function pLimitAll(concurrency, tasks, onProgress) {
    let i = 0, done = 0;
    const res = new Array(tasks.length);
    async function worker() {
        while (true) {
            const idx = i++; if (idx >= tasks.length) return;
            try { res[idx] = await tasks[idx](); }
            catch (e) { res[idx] = e; }
            finally { done++; onProgress && onProgress(done, tasks.length); }
        }
    }
    const workers = Array(Math.min(concurrency, tasks.length)).fill(0).map(worker);
    await Promise.all(workers);
    return res;
}

export async function scanHost(host, ports, listEl) {
    listEl.innerHTML = '';
    for (const port of ports) {
        const row = li(listEl, `${host}:${port} — <span class="muted"><span class="spinner"></span> scanning…</span>`);
        try {
            const res = await checkPort(host, port);
            if (res.state === 'open') {
                row.innerHTML = `${host}:${port} — ${tag('open!', 'ok')} <span class="small">via ${res.via}${res.proto ? '/' + res.proto : ''}, ${res.latency || '?'}ms</span>`;
            } else if (res.state === 'filtered') {
                row.innerHTML = `${host}:${port} — ${tag('filtered', 'warn')} <span class="small">via ${res.via}, ${res.latency || '?'}ms (timeout)</span>`;
            } else {
                row.innerHTML = `${host}:${port} — ${tag('closed', 'err')} <span class="small">via ${res.via}${res.proto ? '/' + res.proto : ''}, ${res.latency || '?'}ms</span>`;
            }
        } catch (e) {
            row.innerHTML = `${host}:${port} — ${tag('closed', 'err')} <span class="small">error</span>`;
        }
    }
}
