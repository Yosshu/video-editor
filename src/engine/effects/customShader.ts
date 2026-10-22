import { create } from 'zustand';
import type { Project } from '../../core/model/types';

/**
 * ユーザー定義シェーダー（エフェクト「シェーダー（自作）」）の状態。
 * シェーダーは GPU の中だけで動き、ファイルや通信には触れられない。それでも重い処理で画面が固まることはあるので、
 * ほかの人から受け取った編集ファイルに含まれていたときは、実行してよいか利用者に確かめる。
 */
interface CustomShaderState {
  /** 実行してよいか */
  allowed: boolean;
  /** コンパイルの誤り（コード → メッセージ） */
  errors: Record<string, string>;
}

export const useCustomShaders = create<CustomShaderState>(() => ({ allowed: true, errors: {} }));

export function setCustomShadersAllowed(allowed: boolean): void {
  useCustomShaders.setState({ allowed });
}

export function customShadersAllowed(): boolean {
  return useCustomShaders.getState().allowed;
}

/** コンパイルの結果を記録する（設定パネルに誤りを表示するため） */
export function reportShaderResult(code: string, error: string | null): void {
  const errors = useCustomShaders.getState().errors;
  if ((errors[code] ?? null) === error) return;
  const next = { ...errors };
  if (error === null) delete next[code];
  else next[code] = error;
  // 古いものから捨てて、覚えておく数を抑える
  const keys = Object.keys(next);
  if (keys.length > 32) delete next[keys[0]];
  useCustomShaders.setState({ errors: next });
}

/** プロジェクトに、有効なユーザー定義シェーダーがあるか */
export function projectHasCustomShaders(project: Project): boolean {
  return project.scenes.some((s) =>
    s.objects.some((o) => o.effects.some((e) => e.type === 'customShader' && e.enabled)),
  );
}

/** ユーザーのコードの前に足す宣言と、後ろに足す main */
export const CUSTOM_HEADER = `
uniform float uTime; uniform float uFrame;
uniform float uParam1; uniform float uParam2; uniform float uParam3; uniform float uParam4;
vec4 src(vec2 uv) { return srcPx(uv * uInSize); }
#line 1
`;

export const CUSTOM_MAIN = `
void main() { outColor = effect((outPx() - uPad) / uInSize); }
`;
