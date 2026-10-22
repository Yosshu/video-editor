import { create } from 'zustand';

const STORAGE_KEY = 'video-editor:keymap';

/** 利用者が変更したキー割り当て（コマンド ID → キーの一覧）。変更していないコマンドは持たない */
export type Keymap = Record<string, string[]>;

function load(): Keymap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return {};
    const out: Keymap = {};
    for (const [id, keys] of Object.entries(data)) {
      if (Array.isArray(keys) && keys.every((k) => typeof k === 'string')) out[id] = keys;
    }
    return out;
  } catch {
    return {};
  }
}

function save(map: Keymap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 保存できない環境（プライベートモードなど）では、このページを開いている間だけ有効
  }
}

export const useKeymap = create<{ custom: Keymap }>(() => ({ custom: load() }));

export function setCustomKeys(commandId: string, keys: string[] | null): void {
  const custom = { ...useKeymap.getState().custom };
  if (keys === null) delete custom[commandId];
  else custom[commandId] = keys;
  useKeymap.setState({ custom });
  save(custom);
}

export function resetAllKeys(): void {
  useKeymap.setState({ custom: {} });
  save({});
}
