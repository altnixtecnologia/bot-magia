const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(__dirname, '..', 'config', 'catalog.json');

let cached = null;

function loadCatalog() {
    if (cached) return cached;
    try {
        const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
        cached = JSON.parse(raw);
        return cached;
    } catch (e) {
        console.error('[Catalog] Falha ao carregar catalogo:', e.message);
        cached = {
            deviceTypes: {},
            plans: {},
            servers: {},
            defaults: {}
        };
        return cached;
    }
}

function listDeviceTypes() {
    const catalog = loadCatalog();
    return Object.entries(catalog.deviceTypes || {}).map(([key, v]) => ({
        key,
        label: v.label || key
    }));
}

function listPlansForDevice(deviceType) {
    const catalog = loadCatalog();
    const device = (catalog.deviceTypes || {})[deviceType];
    const planKeys = device && Array.isArray(device.planOptions) ? device.planOptions : [];
    return planKeys
        .map((key) => {
            const plan = (catalog.plans || {})[key] || {};
            return { key, label: plan.label || key };
        })
        .filter((p) => p.key);
}

function getTrialPackageHint(planKey) {
    const catalog = loadCatalog();
    const plan = (catalog.plans || {})[planKey] || {};
    return plan.trialPackageHint || null;
}

function hasAllCaps(serverCaps, requiredCaps) {
    if (!requiredCaps.length) return true;
    const set = new Set(serverCaps || []);
    return requiredCaps.every((c) => set.has(c));
}

function sortByOrder(keys, orderList) {
    const order = Array.isArray(orderList) ? orderList : [];
    const rank = new Map(order.map((k, idx) => [k, idx]));
    return [...keys].sort((a, b) => {
        const ra = rank.has(a) ? rank.get(a) : 9999;
        const rb = rank.has(b) ? rank.get(b) : 9999;
        if (ra !== rb) return ra - rb;
        return String(a).localeCompare(String(b));
    });
}

function listServersFor(deviceType, planKey) {
    const catalog = loadCatalog();
    const device = (catalog.deviceTypes || {})[deviceType] || {};
    const plan = (catalog.plans || {})[planKey] || {};

    const required = [
        ...(Array.isArray(device.requires) ? device.requires : []),
        ...(Array.isArray(plan.requires) ? plan.requires : [])
    ];

    const servers = catalog.servers || {};
    const keys = Object.keys(servers).filter((k) => {
        const s = servers[k] || {};
        return hasAllCaps(s.capabilities || [], required);
    });

    const defaults = catalog.defaults || {};
    const order = deviceType === 'pc'
        ? defaults.pcServerOrder
        : defaults.trialServerOrder;

    const sorted = sortByOrder(keys, order);
    return sorted.map((key) => {
        const s = servers[key] || {};
        return {
            key,
            label: s.label || key,
            sigmaKey: s.sigmaKey || key,
            capabilities: s.capabilities || [],
            trialEnabled: s.trialEnabled !== false,
            cooldownSeconds: Number(s.cooldownSeconds || 0)
        };
    });
}

function listTrialServersFor(deviceType, planKey) {
    const servers = listServersFor(deviceType, planKey);
    return servers.filter((s) => s.trialEnabled !== false);
}

function resolveSigmaKey(serverKey) {
    const catalog = loadCatalog();
    const server = (catalog.servers || {})[serverKey];
    if (!server) return serverKey;
    return server.sigmaKey || serverKey;
}

module.exports = {
    loadCatalog,
    listDeviceTypes,
    listPlansForDevice,
    listServersFor,
    listTrialServersFor,
    resolveSigmaKey,
    getTrialPackageHint
};
