// Versioned save with backup, verification and corruption quarantine.
// Storage is injected (localStorage in the browser, a Map in tests).
// Keys are namespaced so they never collide with the checklist app that lives
// at the repository root (it uses 'fishing-checklist-v1').
import { hashString } from './rng.js';
import { validateProfile, PROFILE_SCHEMA, migrateProfile1to2, migrateProfile2to3, migrateProfile3to4, migrateProfile4to5, migrateProfile5to6, migrateProfile6to7, migrateProfile7to8, migrateProfile8to9, migrateProfile9to10, migrateProfile10to11 } from './profile.js';

export const SAVE_FORMAT = 'ryoshi-game-save';
export const SAVE_SCHEMA = 11;
export const KEYS = {
  main: 'ryoshi-game:save:main',
  backup: 'ryoshi-game:save:backup',
  quarantinePrefix: 'ryoshi-game:save:quarantine:',
  preMigrationPrefix: 'ryoshi-game:save:pre-migration:v',
  // the player's own progress, kept aside while they try the playtest save
  beforePlaytest: 'ryoshi-game:save:before-playtest',
  // the voyage in progress (海上での途中保存); cleared once it is landed and settled
  voyage: 'ryoshi-game:voyage:current',
};

export function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    _map: m,
  };
}

export function makeEnvelope(profile, revision, now = new Date().toISOString()) {
  const data = JSON.stringify(profile);
  return { format: SAVE_FORMAT, schemaVersion: SAVE_SCHEMA, app: 'M11', revision, savedAt: now, checksum: hashString(data), data: profile };
}

/** Parse + verify an envelope string. Returns {ok, envelope?, profile?, error?, newer?}. */
export function parseEnvelope(raw) {
  if (raw == null) return { ok: false, error: 'empty' };
  let env;
  try {
    env = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'JSONとして読めません' };
  }
  if (!env || env.format !== SAVE_FORMAT) return { ok: false, error: '漁師ゲームのセーブ形式ではありません' };
  if (typeof env.schemaVersion !== 'number') return { ok: false, error: '保存形式の版がありません' };
  if (env.schemaVersion > SAVE_SCHEMA) return { ok: false, newer: true, error: `新しい版(${env.schemaVersion})のセーブです。このバージョンでは読み込めません` };
  // integrity is checked on the data exactly as it was written
  if (hashString(JSON.stringify(env.data)) !== env.checksum) return { ok: false, error: 'チェックサムが一致しません（破損の可能性）' };
  const migrated = migrate(env);
  if (!migrated.ok) return migrated;
  const profile = migrated.envelope.data;
  const errs = validateProfile(profile);
  if (errs.length) return { ok: false, error: `内容が不正です: ${errs.slice(0, 3).join(' / ')}` };
  return { ok: true, envelope: migrated.envelope, profile, migratedFrom: migrated.from };
}

/** Step-by-step migration to the current schema. Never mutates the input. */
function migrate(env) {
  let ver = env.schemaVersion;
  let data = env.data;
  const from = ver;
  if (!data || typeof data !== 'object') return { ok: false, error: 'データがありません' };
  if (ver === 1 && data.schema === 1) {
    try {
      data = migrateProfile1to2(data);
    } catch (e) {
      return { ok: false, error: `M0形式からの移行に失敗しました: ${e.message}` };
    }
    ver = 2;
  }
  if (ver === 2 && data.schema === 2) {
    try {
      data = migrateProfile2to3(data);
    } catch (e) {
      return { ok: false, error: `M1形式からの移行に失敗しました: ${e.message}` };
    }
    ver = 3;
  }
  if (ver === 3 && data.schema === 3) {
    try {
      data = migrateProfile3to4(data);
    } catch (e) {
      return { ok: false, error: `M2形式からの移行に失敗しました: ${e.message}` };
    }
    ver = 4;
  }
  if (ver === 4 && data.schema === 4) {
    try {
      data = migrateProfile4to5(data);
    } catch (e) {
      return { ok: false, error: `M3/M4形式からの移行に失敗しました: ${e.message}` };
    }
    ver = 5;
  }
  if (ver === 5 && data.schema === 5) {
    try {
      data = migrateProfile5to6(data);
    } catch (e) {
      return { ok: false, error: `M5形式からの移行に失敗しました: ${e.message}` };
    }
    ver = 6;
  }
  if (ver === 6 && data.schema === 6) {
    try {
      data = migrateProfile6to7(data);
    } catch (e) {
      return { ok: false, error: `版6からの移行に失敗しました: ${e.message}` };
    }
    ver = 7;
  }
  if (ver === 7 && data.schema === 7) {
    try {
      data = migrateProfile7to8(data);
    } catch (e) {
      return { ok: false, error: `版7からの移行に失敗しました: ${e.message}` };
    }
    ver = 8;
  }
  if (ver === 8 && data.schema === 8) {
    try {
      data = migrateProfile8to9(data);
    } catch (e) {
      return { ok: false, error: `版8からの移行に失敗しました: ${e.message}` };
    }
    ver = 9;
  }
  if (ver === 9 && data.schema === 9) {
    try {
      data = migrateProfile9to10(data);
    } catch (e) {
      return { ok: false, error: `版9からの移行に失敗しました: ${e.message}` };
    }
    ver = 10;
  }
  if (ver === 10 && data.schema === 10) {
    try {
      data = migrateProfile10to11(data);
    } catch (e) {
      return { ok: false, error: `版10からの移行に失敗しました: ${e.message}` };
    }
    ver = 11;
  }
  if (ver === SAVE_SCHEMA && data.schema === PROFILE_SCHEMA) return { ok: true, envelope: { ...env, schemaVersion: ver, data }, from: from !== ver ? from : null };
  return { ok: false, error: `移行できない版です（${env.schemaVersion}/${env.data && env.data.schema}）` };
}

/**
 * Load the newest valid save. Never deletes anything: an unreadable main
 * save is copied to a quarantine key before falling back to the backup.
 * status: 'none' | 'ok' | 'recovered' | 'unreadable' | 'newer'
 */
export function loadSave(storage, now = Date.now()) {
  let rawMain;
  let rawBackup;
  try {
    rawMain = storage.getItem(KEYS.main);
    rawBackup = storage.getItem(KEYS.backup);
  } catch (e) {
    return { status: 'unavailable', error: `保存領域を読めません: ${e.message}`, readOnly: true };
  }
  if (rawMain == null && rawBackup == null) return { status: 'none' };
  const main = parseEnvelope(rawMain);
  if (main.ok) {
    // keep the original of an older-format save before it is ever overwritten
    let preMigrationKey = null;
    if (main.migratedFrom) {
      preMigrationKey = `${KEYS.preMigrationPrefix}${main.migratedFrom}`;
      try {
        if (storage.getItem(preMigrationKey) == null) storage.setItem(preMigrationKey, rawMain);
      } catch {
        preMigrationKey = null;
      }
    }
    return { status: 'ok', profile: main.profile, revision: main.envelope.revision, savedAt: main.envelope.savedAt, migratedFrom: main.migratedFrom, preMigrationKey };
  }
  if (main.newer) return { status: 'newer', error: main.error, readOnly: true };
  // keep the unreadable data
  let quarantineKey = null;
  if (rawMain != null) {
    quarantineKey = KEYS.quarantinePrefix + now;
    try {
      storage.setItem(quarantineKey, rawMain);
    } catch {
      quarantineKey = null;
    }
  }
  const backup = parseEnvelope(rawBackup);
  if (backup.ok) {
    return { status: 'recovered', profile: backup.profile, revision: backup.envelope.revision, savedAt: backup.envelope.savedAt, error: main.error, quarantineKey };
  }
  if (backup.newer) return { status: 'newer', error: backup.error, readOnly: true };
  return { status: 'unreadable', error: main.error, quarantineKey, readOnly: true };
}

/**
 * Write a profile. The previous valid main save becomes the backup, the new
 * envelope is written and read back. Returns {ok, revision, savedAt, error}.
 */
export function writeSave(storage, profile, prevRevision = 0, now = new Date().toISOString()) {
  const errs = validateProfile(profile);
  if (errs.length) return { ok: false, error: `保存前の検証に失敗: ${errs[0]}` };
  const env = makeEnvelope(profile, prevRevision + 1, now);
  const json = JSON.stringify(env);
  try {
    const cur = storage.getItem(KEYS.main);
    if (cur != null && parseEnvelope(cur).ok) storage.setItem(KEYS.backup, cur);
    storage.setItem(KEYS.main, json);
    const back = storage.getItem(KEYS.main);
    if (back !== json) return { ok: false, error: '書き込み後の確認で内容が一致しませんでした' };
    const chk = parseEnvelope(back);
    if (!chk.ok) return { ok: false, error: `書き込み後の確認に失敗: ${chk.error}` };
  } catch (e) {
    return { ok: false, error: `保存できませんでした: ${e.message || e}` };
  }
  return { ok: true, revision: env.revision, savedAt: env.savedAt };
}

/** Text for the "書き出し" (export) file. */
export function exportSave(profile, revision) {
  return JSON.stringify(makeEnvelope(profile, revision), null, 2);
}

/** Validate an imported file; does not write anything. */
export function checkImport(text) {
  return parseEnvelope(text);
}
