import { parsePorts, checkPort, DEFAULT_TIMEOUT_MS } from './scanner.mjs';
import { detectLocalIPs, li, tag, pLimitAll, scanHost } from './ui.js';

const $ = (id) => document.getElementById(id);
const portsInput = $('portsInput');
const localhostList = $('localhostList');
const detectIpBtn = $('detectIpBtn');
const ipDetected = $('ipDetected');
const scanLocalhostBtn = $('scanLocalhostBtn');
const scanMyIpBtn = $('scanMyIpBtn');
const myIpList = $('myIpList');
const scanSubnetBtn = $('scanSubnetBtn');
const subnetList = $('subnetList');
const subnetPorts = $('subnetPorts');
const concurrencyInput = $('concurrency');
const prefixOverride = $('prefixOverride');
const subnetBar = $('subnetBar');

let myLocalIP = null;

scanLocalhostBtn.addEventListener('click', async () => {
    const ports = parsePorts(portsInput.value);
    await scanHost('127.0.0.1', ports, localhostList);
});

detectIpBtn.addEventListener('click', async () => {
    ipDetected.textContent = 'Определяем…';
    const ips = await detectLocalIPs();
    if (ips.length) {
        myLocalIP = ips[0];
        ipDetected.innerHTML = `Найдено: <b>${myLocalIP}</b> ${ips.length > 1 ? `<span class="small">(и ещё ${ips.length - 1})</span>` : ''}`;
        scanMyIpBtn.disabled = false;
        scanSubnetBtn.disabled = false;
    } else {
        ipDetected.innerHTML = `Не удалось извлечь IP (возможен mDNS). Укажите префикс сети вручную ниже.`;
        scanMyIpBtn.disabled = true;
    }
});

scanMyIpBtn.addEventListener('click', async () => {
    if (!myLocalIP) return;
    const ports = parsePorts(portsInput.value);
    await scanHost(myLocalIP, ports, myIpList);
});

scanSubnetBtn.addEventListener('click', async () => {
    let base;
    if (prefixOverride.value.trim()) {
        base = prefixOverride.value.trim();
        if (!/^\d+\.\d+\.\d+\.$/.test(base)) {
            alert('Префикс должен быть вида 192.168.1.');
            return;
        }
    } else if (myLocalIP) {
        const parts = myLocalIP.split('.');
        base = parts.slice(0, 3).join('.') + '.';
    } else {
        alert('Сначала определите IP или укажите префикс сети вручную.');
        return;
    }

    const ports = parsePorts(subnetPorts.value);
    const concurrency = Math.max(1, Math.min(256, Number(concurrencyInput.value) || 50));

    subnetList.innerHTML = '';
    subnetBar.style.width = '0%';

    const tasks = [];
    for (let i = 1; i <= 254; i++) {
        const host = base + i;
        tasks.push(async () => {
            const findings = [];
            for (const p of ports) {
                const r = await checkPort(host, p, 900);
                if (r.state !== 'closed') findings.push(r);
            }
            return { host, findings };
        });
    }

    let progressed = 0;
    const results = await pLimitAll(concurrency, tasks, (done, total) => {
        progressed = done;
        subnetBar.style.width = Math.round(100 * done / total) + '%';
    });

    for (const r of results) {
        if (!r.findings.length) continue;
        const items = r.findings.map(f => {
            const k = f.state === 'open' ? 'ok' : 'warn';
            return `${r.host}:${f.port} — ${tag(f.state, k)} <span class="small">via ${f.via}${f.proto ? '/' + f.proto : ''}, ${f.latency || '?'}ms</span>`;
        }).join('<br>');
        li(subnetList, items);
    }

    if (!subnetList.children.length) {
        li(subnetList, `${tag('ничего не найдено', 'muted')}`);
    }
});

window.addEventListener('load', () => {
    scanLocalhostBtn.click();
});

if (location.protocol === 'https:') {
    const warn = document.createElement('div');
    warn.className = 'small';
    warn.innerHTML = `Вы на HTTPS. Запросы к http://localhost:* могут блокироваться как "mixed content". \nЛучше открыть файл локально (file://) или по http:// (например, через простейший dev‑сервер).`;
    document.body.insertBefore(warn, document.body.children[1]);
}
