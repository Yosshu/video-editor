import { useId, useRef, useState } from 'react';
import type {
  BoolParamDef,
  ColorParamDef,
  FontParamDef,
  NumberParamDef,
  SceneParamDef,
  SelectParamDef,
  TextParamDef,
} from '../../core/params/defs';
import { clampNumber } from '../../core/params/defs';
import { t } from '../../i18n';

const COMMON_FONTS = [
  'sans-serif',
  'serif',
  'monospace',
  'Noto Sans JP',
  'Noto Serif JP',
  'Yu Gothic',
  'Yu Mincho',
  'Meiryo',
  'BIZ UDPGothic',
  'Hiragino Sans',
  'Hiragino Mincho ProN',
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Impact',
];

function roundTo(value: number, step: number | undefined): number {
  const decimals = step && step < 1 ? Math.min(6, Math.ceil(-Math.log10(step))) : 0;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

interface FieldProps<D, V> {
  def: D;
  value: V;
  onChange: (value: V) => void;
  disabled?: boolean;
  /** ラベルの右に出す追加ボタン（キーフレームなど） */
  extra?: React.ReactNode;
}

export function NumberField({
  def,
  value,
  onChange,
  disabled,
  extra,
}: FieldProps<NumberParamDef, number>) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; value: number } | null>(null);
  const sliderMin = def.sliderMin ?? def.min;
  const sliderMax = def.sliderMax ?? def.max;
  const range = sliderMin !== undefined && sliderMax !== undefined ? sliderMax - sliderMin : 1000;
  const perPx = Math.max(def.step ?? 1, range / 600);

  const commit = (v: number) => {
    if (!Number.isFinite(v)) return;
    onChange(roundTo(clampNumber(def, v), def.step));
  };

  return (
    <div className="field">
      <div className="field-label-row">
        <label
          htmlFor={id}
          className="field-label scrub"
          title={t('左右にドラッグして値を変更')}
          onPointerDown={(e) => {
            if (disabled || e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = { x: e.clientX, value };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            const factor = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
            commit(d.value + (e.clientX - d.x) * perPx * factor);
          }}
          onPointerUp={() => (dragRef.current = null)}
          onPointerCancel={() => (dragRef.current = null)}
        >
          {t(def.label)}
        </label>
        {extra}
      </div>
      <div className="field-input-row">
        {sliderMin !== undefined && sliderMax !== undefined && (
          <input
            type="range"
            aria-label={t('{0}（スライダー）', t(def.label))}
            min={sliderMin}
            max={sliderMax}
            step={def.step ?? 1}
            value={Math.min(sliderMax, Math.max(sliderMin, value))}
            disabled={disabled}
            onChange={(e) => commit(Number(e.target.value))}
          />
        )}
        <input
          id={id}
          type="number"
          className="number-input"
          step={def.step ?? 1}
          min={def.min}
          max={def.max}
          disabled={disabled}
          value={text ?? String(roundTo(value, def.step))}
          onFocus={() => setText(String(roundTo(value, def.step)))}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(v)) commit(v);
          }}
          onBlur={() => setText(null)}
        />
        {def.unit && <span className="unit">{t(def.unit)}</span>}
      </div>
    </div>
  );
}

export function ColorField({ def, value, onChange, disabled }: FieldProps<ColorParamDef, string>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {t(def.label)}
      </label>
      <div className="field-input-row">
        <input
          id={id}
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          className="color-text"
          aria-label={t('{0}（コード）', t(def.label))}
          value={value}
          disabled={disabled}
          onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

export function TextField({ def, value, onChange, disabled }: FieldProps<TextParamDef, string>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {t(def.label)}
      </label>
      {def.multiline ? (
        <textarea
          id={id}
          rows={def.code ? 12 : 3}
          className={def.code ? 'code-input' : undefined}
          spellCheck={def.code ? false : undefined}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

let localFontsCache: string[] | null = null;

export function FontField({ def, value, onChange, disabled }: FieldProps<FontParamDef, string>) {
  const id = useId();
  const listId = useId();
  const [fonts, setFonts] = useState<string[]>(localFontsCache ?? COMMON_FONTS);
  return (
    <div className="field">
      <div className="field-label-row">
        <label htmlFor={id} className="field-label">
          {t(def.label)}
        </label>
        {window.queryLocalFonts && !localFontsCache && (
          <button
            type="button"
            className="link-button"
            onClick={async () => {
              try {
                const list = await window.queryLocalFonts!();
                localFontsCache = [
                  ...new Set([...COMMON_FONTS, ...list.map((f) => f.family)]),
                ].sort();
                setFonts(localFontsCache);
              } catch {
                // 許可されなかった場合は既定の一覧のまま
              }
            }}
          >
            {t('PC のフォントを読み込む')}
          </button>
        )}
      </div>
      <input
        id={id}
        type="text"
        list={listId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {fonts.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </div>
  );
}

export function SelectField({
  def,
  value,
  onChange,
  disabled,
}: FieldProps<SelectParamDef, string>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {t(def.label)}
      </label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {def.options.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.label)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SceneField({
  def,
  value,
  onChange,
  disabled,
  options,
}: FieldProps<SceneParamDef, string> & { options: { id: string; name: string }[] }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {t(def.label)}
      </label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {!options.some((o) => o.id === value) && (
          <option value={value}>{t('（選択してください）')}</option>
        )}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function BoolField({ def, value, onChange, disabled }: FieldProps<BoolParamDef, boolean>) {
  return (
    <label className="field checkbox-field">
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {t(def.label)}
    </label>
  );
}
