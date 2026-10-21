/** 種類ごとの接頭辞つきで、衝突しにくい ID を作る */
export function newId(prefix: 'pj' | 'sc' | 'as' | 'ob' | 'fx'): string {
  const raw = globalThis.crypto.randomUUID().replace(/-/g, '');
  return `${prefix}_${raw.slice(0, 12)}`;
}
