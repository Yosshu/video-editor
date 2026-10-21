/**
 * パラメータ定義。
 * 設定パネルの入力欄、保存形式の既定値、アニメーションの可否はすべてこの定義から決まる。
 */

interface ParamDefBase {
  id: string;
  label: string;
  /** 設定パネルでの見出し */
  group?: string;
  /** 他のパラメータの値によって表示を切り替える */
  visibleIf?: (values: Record<string, unknown>) => boolean;
}

export interface NumberParamDef extends ParamDefBase {
  kind: 'number';
  default: number;
  min?: number;
  max?: number;
  /** スライダーで操作する範囲（入力欄では min/max まで入力できる） */
  sliderMin?: number;
  sliderMax?: number;
  step?: number;
  unit?: string;
  /** キーフレームで変化させられるか */
  animatable?: boolean;
}

export interface ColorParamDef extends ParamDefBase {
  kind: 'color';
  default: string;
}

export interface TextParamDef extends ParamDefBase {
  kind: 'text';
  default: string;
  multiline?: boolean;
}

export interface FontParamDef extends ParamDefBase {
  kind: 'font';
  default: string;
}

export interface SelectParamDef extends ParamDefBase {
  kind: 'select';
  default: string;
  options: { value: string; label: string }[];
}

export interface BoolParamDef extends ParamDefBase {
  kind: 'boolean';
  default: boolean;
}

export type ParamDef =
  NumberParamDef | ColorParamDef | TextParamDef | FontParamDef | SelectParamDef | BoolParamDef;

export type ResolvedValue = number | string | boolean;

export function clampNumber(def: NumberParamDef, value: number): number {
  let v = value;
  if (def.min !== undefined) v = Math.max(def.min, v);
  if (def.max !== undefined) v = Math.min(def.max, v);
  return v;
}
