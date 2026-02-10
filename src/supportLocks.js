const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'data');
const LOCKS_PATH = path.join(STATE_DIR, 'support_locks.json');

function ensureDir() {
    if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
    }
}

function loadLocks() {
    try {
        ensureDir();
        if (!fs.existsSync(LOCKS_PATH)) return {};
        const raw = fs.readFileSync(LOCKS_PATH, 'utf8');
        return JSON.parse(raw || '{}') || {};
    } catch (e) {
        console.error('[SupportLock] Falha ao carregar:', e.message);
        return {};
    }
}

function saveLocks(locks) {
    try {
        ensureDir();
        const tmp = `${LOCKS_PATH}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(locks || {}, null, 2));
        fs.renameSync(tmp, LOCKS_PATH);
    } catch (e) {
        console.error('[SupportLock] Falha ao salvar:', e.message);
    }
}

function normalizePhone(phone) {
    if (!phone) return null;
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length < 10) return null;
    return digits;
}

function lockPhone(phone) {
    const digits = normalizePhone(phone);
    if (!digits) return { ok: false, message: 'Numero invalido.' };
    const locks = loadLocks();
    locks[digits] = { ts: new Date().toISOString() };
    saveLocks(locks);
    return { ok: true, phone: digits };
}

function unlockPhone(phone) {
    const digits = normalizePhone(phone);
    if (!digits) return { ok: false, message: 'Numero invalido.' };
    const locks = loadLocks();
    if (locks[digits]) {
        delete locks[digits];
        saveLocks(locks);
    }
    return { ok: true, phone: digits };
}

function isLocked(phone) {
    const digits = normalizePhone(phone);
    if (!digits) return false;
    const locks = loadLocks();
    return Boolean(locks[digits]);
}

function listLocked() {
    const locks = loadLocks();
    return Object.keys(locks);
}

module.exports = {
    lockPhone,
    unlockPhone,
    isLocked,
    listLocked
};
