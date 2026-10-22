import { useId } from 'react';
import { setObjectTiming } from '../../app/actions';
import {
  addMidpointAtPlayhead,
  clearParamAnimation,
  jumpToKey,
  removeMidpointAtPlayhead,
  setEaseAtPlayhead,
  setParamAtPlayhead,
  toggleKeyAtPlayhead,
} from '../../app/animationActions';
import { addEffect, moveEffect, removeEffect, setEffectEnabled } from '../../app/effectActions';
import {
  addEffectFromPreset,
  applyObjectPreset,
  saveEffectPreset,
  saveObjectPreset,
} from '../../app/presetActions';
import { usePresets } from '../../state/presets';
import { referableScenes } from '../../app/sceneActions';
import { EASE_OPTIONS, isSpecialEase } from '../../core/animation/ease';
import { isAnimated, isExpression } from '../../core/animation/interpolate';
import { easeAt, hasKeyAt, objectKeyTimes } from '../../core/animation/keys';
import {
  EFFECT_CATEGORIES,
  EFFECTS,
  effectDomain,
  getEffectDef,
} from '../../core/effects/definitions';
import { EXPR_VARIABLES, resolveEffectParams, resolveParams } from '../../core/evaluate/evaluate';
import { exprError } from '../../core/expr/expr';
import { setCustomShadersAllowed, useCustomShaders } from '../../engine/effects/customShader';
import { formatTimecode, fpsValue } from '../../core/model/time';
import type {
  Ease,
  EffectInstance,
  ParamMap,
  SpecialEase,
  TimelineObject,
} from '../../core/model/types';
import { COLLAPSED_GROUPS, getObjectDef } from '../../core/objects/definitions';
import type {
  AssetParamDef,
  NumberParamDef,
  ParamDef,
  SceneParamDef,
} from '../../core/params/defs';
import { importMediaFiles } from '../../app/assets';
import { pickFilesWithInput } from '../../storage/filePicker';
import { currentScene, useEditor } from '../../state/store';
import { EaseEditor } from './EaseEditor';
import {
  BoolField,
  ColorField,
  FontField,
  NumberField,
  SceneField,
  SelectField,
  TextField,
} from './fields';
import { t } from '../../i18n';

/** 編集対象のパラメータ（オブジェクト自身か、そのエフェクトか） */
interface Target {
  obj: TimelineObject;
  /** エフェクトのパラメータなら、そのエフェクトの ID */
  effectId?: string;
  params: ParamMap;
  /** オブジェクト内の相対フレーム */
  local: number;
}

function KeyControls({ target, def }: { target: Target; def: NumberParamDef }) {
  const { obj, effectId, params, local } = target;
  const value = params[def.id];
  const animated = isAnimated(value);
  const onKey = hasKeyAt(value, local);
  return (
    <span className="key-controls">
      {animated && (
        <button
          type="button"
          className="key-button"
          title={t('前のキーへ')}
          aria-label={t('{0}の前のキーへ', t(def.label))}
          onClick={() => jumpToKey(obj.id, def.id, -1, effectId)}
        >
          ◀
        </button>
      )}
      <button
        type="button"
        className={`key-button key-toggle ${onKey ? 'on' : animated ? 'animated' : ''}`}
        title={onKey ? t('この時刻のキーを削除') : t('この時刻にキーを追加（アニメーション）')}
        aria-label={t('{0}のキーフレーム', t(def.label))}
        aria-pressed={onKey}
        onClick={() => toggleKeyAtPlayhead(obj.id, def.id, def.default, effectId)}
      >
        {onKey ? '◆' : '◇'}
      </button>
      {animated && (
        <button
          type="button"
          className="key-button"
          title={t('次のキーへ')}
          aria-label={t('{0}の次のキーへ', t(def.label))}
          onClick={() => jumpToKey(obj.id, def.id, 1, effectId)}
        >
          ▶
        </button>
      )}
    </span>
  );
}

const SPECIAL_OPTIONS: { value: SpecialEase['special']; label: string }[] = [
  { value: 'random', label: 'ランダム（2 つの値の間）' },
  { value: 'repeat', label: '反復（2 つの値を往復）' },
  { value: 'shake', label: '振動（変化しながら揺れる）' },
];

function EaseRow({ target, def }: { target: Target; def: NumberParamDef }) {
  const { obj, effectId, params, local } = target;
  const value = params[def.id];
  if (!isAnimated(value) || value.keys.length < 2) return null;
  const ease = easeAt(value, local);
  const special = isSpecialEase(ease) ? ease : null;
  const selectValue =
    ease === undefined
      ? 'linear'
      : special
        ? special.special
        : typeof ease === 'object'
          ? 'bezier'
          : ease;
  const setEase = (e: Ease) => setEaseAtPlayhead(obj.id, def.id, e, effectId);
  return (
    <div className="ease-row">
      <label className="field-label">
        {t('変化')}
        <select
          value={selectValue}
          aria-label={t('{0}の変化の仕方', t(def.label))}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'bezier') setEase({ bezier: [0.25, 0.1, 0.25, 1] });
            else if (SPECIAL_OPTIONS.some((o) => o.value === v))
              setEase({
                special: v as SpecialEase['special'],
                period: v === 'repeat' ? 30 : 4,
                // 同じ設定の別のパラメータと同じ動きにならないよう、種を変える
                seed: Math.floor(Math.random() * 1_000_000),
                ...(v === 'shake' ? { amount: 10 } : {}),
              });
            else setEase(v as Ease);
          }}
        >
          {EASE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
          <option value="bezier">{t('カスタム（曲線を編集）')}</option>
          <optgroup label={t('特殊な変化')}>
            {SPECIAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <button
        type="button"
        className="link-button"
        onClick={() => clearParamAnimation(obj.id, def.id, def.default, effectId)}
      >
        {t('アニメーションを解除')}
      </button>
      {selectValue === 'bezier' && <EaseEditor ease={ease} onChange={setEase} />}
      {special && (
        <div className="special-ease">
          <label>
            {special.special === 'repeat' ? t('周期') : t('間隔')}
            <input
              type="number"
              min={1}
              step={1}
              value={special.period}
              aria-label={t(
                '{0}の{1}（フレーム）',
                t(def.label),
                special.special === 'repeat' ? t('周期') : t('間隔'),
              )}
              onChange={(e) => {
                const v = Math.round(Number(e.target.value));
                if (v >= 1) setEase({ ...special, period: v });
              }}
            />
            {t('フレーム')}
          </label>
          {special.special === 'shake' && (
            <label>
              {t('揺れ幅')}
              <input
                type="number"
                min={0}
                step={0.1}
                value={special.amount ?? 10}
                aria-label={t('{0}の揺れ幅', t(def.label))}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 0) setEase({ ...special, amount: v });
                }}
              />
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={special.smooth === true}
              onChange={(e) => setEase({ ...special, smooth: e.target.checked })}
            />
            {t('なめらか')}
          </label>
          {special.special !== 'repeat' && (
            <button
              type="button"
              className="link-button"
              onClick={() => setEase({ ...special, seed: Math.floor(Math.random() * 1_000_000) })}
            >
              {t('別の動きにする')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 式で計算するパラメータの入力欄 */
function ExpressionField({
  def,
  target,
  computed,
  disabled,
  variables,
}: {
  def: NumberParamDef;
  target: Target;
  computed: number;
  disabled: boolean;
  variables: string[];
}) {
  const id = useId();
  const raw = target.params[def.id];
  const expr = isExpression(raw) ? raw.expr : '';
  const error = exprError(expr, [...EXPR_VARIABLES, ...variables]);
  return (
    <div className="field expression-field">
      <div className="field-label-row">
        <label htmlFor={id} className="field-label">
          {t(def.label)}
        </label>
        {!disabled && (
          <button
            type="button"
            className="key-button expr-toggle on"
            title={t('式をやめて数値にする')}
            aria-label={t('{0}の式をやめる', t(def.label))}
            onClick={() =>
              setParamAtPlayhead(
                target.obj.id,
                def.id,
                Math.round(computed * 1000) / 1000,
                target.effectId,
              )
            }
          >
            ƒx
          </button>
        )}
      </div>
      <input
        id={id}
        type="text"
        className="expr-input"
        spellCheck={false}
        value={expr}
        disabled={disabled}
        aria-label={t('{0}の式', t(def.label))}
        onChange={(e) =>
          setParamAtPlayhead(target.obj.id, def.id, { expr: e.target.value }, target.effectId)
        }
      />
      <div className="expr-info">
        {error ? (
          <span className="error-text">{error}</span>
        ) : (
          <span className="dim">= {Math.round(computed * 1000) / 1000}</span>
        )}
      </div>
      <details className="expr-help">
        <summary>{t('式の書き方')}</summary>
        <p>
          {t(
            '使える値：time（秒）、frame、length（長さの秒）、fps、ほかのパラメータ（{0}）、layer(番号, "x")（別のレイヤーの値）',
            variables.slice(0, 6).join(', ') + (variables.length > 6 ? ', …' : ''),
          )}
        </p>
        <p>
          {t(
            '関数：sin cos tan abs min max clamp lerp floor round sqrt pow random noise rad deg など。例：sin(time * 3) * 100',
          )}
        </p>
      </details>
    </div>
  );
}

function ParamField({
  def,
  target,
  value,
  disabled,
  variables = [],
}: {
  def: ParamDef;
  target: Target;
  value: unknown;
  disabled: boolean;
  /** 式で参照できるパラメータ名 */
  variables?: string[];
}) {
  const change = (v: number | string | boolean) =>
    setParamAtPlayhead(target.obj.id, def.id, v, target.effectId);
  switch (def.kind) {
    case 'number':
      if (def.animatable && isExpression(target.params[def.id]))
        return (
          <ExpressionField
            def={def}
            target={target}
            computed={Number(value)}
            disabled={disabled}
            variables={variables.filter((v) => v !== def.id)}
          />
        );
      return (
        <>
          <NumberField
            def={def}
            value={Number(value)}
            onChange={change}
            disabled={disabled}
            extra={
              def.animatable && !disabled ? (
                <>
                  <KeyControls target={target} def={def} />
                  <button
                    type="button"
                    className="key-button expr-toggle"
                    title={t('式で計算する')}
                    aria-label={t('{0}を式で計算する', t(def.label))}
                    onClick={() =>
                      setParamAtPlayhead(
                        target.obj.id,
                        def.id,
                        { expr: String(Math.round(Number(value) * 1000) / 1000) },
                        target.effectId,
                      )
                    }
                  >
                    ƒx
                  </button>
                </>
              ) : undefined
            }
          />
          {def.animatable && !disabled && <EaseRow target={target} def={def} />}
        </>
      );
    case 'color':
      return <ColorField def={def} value={String(value)} onChange={change} disabled={disabled} />;
    case 'text':
      return <TextField def={def} value={String(value)} onChange={change} disabled={disabled} />;
    case 'font':
      return <FontField def={def} value={String(value)} onChange={change} disabled={disabled} />;
    case 'select':
      return <SelectField def={def} value={String(value)} onChange={change} disabled={disabled} />;
    case 'boolean':
      return <BoolField def={def} value={value === true} onChange={change} disabled={disabled} />;
    case 'scene':
      return (
        <SceneParamField def={def} value={String(value)} onChange={change} disabled={disabled} />
      );
    case 'asset':
      return (
        <AssetParamField def={def} value={String(value)} onChange={change} disabled={disabled} />
      );
  }
}

/** プロジェクトの素材を選ぶ（LUT など）。ファイルから読み込んで選ぶこともできる */
function AssetParamField({
  def,
  value,
  onChange,
  disabled,
}: {
  def: AssetParamDef;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const assets = useEditor((s) => s.project.assets).filter((a) => a.kind === def.assetKind);
  const status = useEditor((s) => s.assetStatus[value]);
  return (
    <div className="field">
      <div className="field-label-row">
        <label htmlFor={id} className="field-label">
          {t(def.label)}
        </label>
        {!disabled && (
          <button
            type="button"
            className="link-button"
            onClick={async () => {
              const files = await pickFilesWithInput({ accept: '.cube', multiple: false });
              const [asset] = await importMediaFiles(files.map((file) => ({ file })));
              if (asset) onChange(asset.id);
            }}
          >
            {t('ファイルを読み込む…')}
          </button>
        )}
      </div>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('（選択してください）')}</option>
        {assets.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {value && (status === 'missing' || status === 'error') && (
        <p className="error-text">{t('ファイルが見つかりません')}</p>
      )}
    </div>
  );
}

/** 表示するシーンを選ぶ（循環するシーンは選べない） */
function SceneParamField({
  def,
  value,
  onChange,
  disabled,
}: {
  def: SceneParamDef;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const project = useEditor((s) => s.project);
  const sceneId = useEditor((s) => s.sceneId);
  const options = referableScenes(project, sceneId);
  return (
    <SceneField def={def} value={value} onChange={onChange} disabled={disabled} options={options} />
  );
}

function groupParams(params: ParamDef[]): [string, ParamDef[]][] {
  const groups = new Map<string, ParamDef[]>();
  for (const p of params) {
    const g = p.group ?? t('その他');
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  return [...groups.entries()];
}

function EffectCard({
  obj,
  effect,
  index,
  count,
  local,
  disabled,
}: {
  obj: TimelineObject;
  effect: EffectInstance;
  index: number;
  count: number;
  local: number;
  disabled: boolean;
}) {
  const def = getEffectDef(effect.type);
  const target: Target = { obj, effectId: effect.id, params: effect.params, local };
  const fps = useEditor((s) => s.project.settings.fps);
  const scene = useEditor((s) => currentScene(s));
  const values = resolveEffectParams(effect, local, {
    fps,
    scene,
    sceneFrame: obj.start + local,
    length: obj.length,
  });
  const variables = (def?.params ?? []).filter((p) => p.kind === 'number').map((p) => p.id);
  return (
    <details open className={`effect-card ${effect.enabled ? '' : 'disabled-effect'}`}>
      <summary>
        <input
          type="checkbox"
          checked={effect.enabled}
          disabled={disabled}
          aria-label={t('{0}を有効にする', def ? t(def.label) : effect.type)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setEffectEnabled(obj.id, effect.id, e.target.checked)}
        />
        <span className="effect-name">
          {def ? t(def.label) : t('{0}（このバージョンでは使えません）', effect.type)}
        </span>
        <span className="effect-buttons">
          {def && !disabled && (
            <button
              type="button"
              className="key-button"
              aria-label={t('{0}の設定をプリセットに保存', t(def.label))}
              title={t('この設定をプリセットに保存')}
              onClick={(e) => {
                e.preventDefault();
                const name = window.prompt(t('プリセットの名前'), t(def.label));
                if (name) saveEffectPreset(obj.id, effect.id, name);
              }}
            >
              ☆
            </button>
          )}
          <button
            type="button"
            className="key-button"
            disabled={disabled || index === 0}
            aria-label={t('上へ')}
            title={t('上へ（先に適用）')}
            onClick={(e) => {
              e.preventDefault();
              moveEffect(obj.id, effect.id, -1);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            className="key-button"
            disabled={disabled || index === count - 1}
            aria-label={t('下へ')}
            title={t('下へ（後で適用）')}
            onClick={(e) => {
              e.preventDefault();
              moveEffect(obj.id, effect.id, 1);
            }}
          >
            ↓
          </button>
          <button
            type="button"
            className="key-button"
            disabled={disabled}
            aria-label={t('{0}を削除', def ? t(def.label) : effect.type)}
            title={t('削除')}
            onClick={(e) => {
              e.preventDefault();
              removeEffect(obj.id, effect.id);
            }}
          >
            ×
          </button>
        </span>
      </summary>
      {def?.params
        .filter((p) => !p.visibleIf || p.visibleIf(values))
        .map((p) => (
          <ParamField
            key={p.id}
            def={p}
            target={target}
            value={values[p.id]}
            disabled={disabled}
            variables={variables}
          />
        ))}
      {effect.type === 'customShader' && <ShaderStatus code={String(values.code)} />}
    </details>
  );
}

/** ユーザー定義シェーダーのコンパイルの誤りと、実行の許可 */
function ShaderStatus({ code }: { code: string }) {
  const allowed = useCustomShaders((s) => s.allowed);
  const error = useCustomShaders((s) => s.errors[code]);
  if (!allowed)
    return (
      <p className="hint shader-status">
        {t('開いたファイルのシェーダーは、許可するまで実行しません。')}
        <button type="button" onClick={() => setCustomShadersAllowed(true)}>
          {t('実行を許可する')}
        </button>
      </p>
    );
  if (error) return <pre className="error-text shader-status">{error}</pre>;
  return null;
}

function EffectsSection({
  obj,
  local,
  disabled,
}: {
  obj: TimelineObject;
  local: number;
  disabled: boolean;
}) {
  const def = getObjectDef(obj.type);
  // 映像を持つなら映像エフェクト、音声を持つなら音声エフェクトを選べる
  const available = EFFECTS.filter((d) => (effectDomain(d) === 'audio' ? def.audio : def.visual));
  const presets = usePresets((s) => s.effects).filter((p) =>
    available.some((d) => d.type === p.type),
  );
  return (
    <details open className="param-group effects-section">
      <summary>
        {t('エフェクト')}
        {obj.effects.length > 0 ? `（${obj.effects.length}）` : ''}
      </summary>
      {obj.effects.map((e, i) => (
        <EffectCard
          key={e.id}
          obj={obj}
          effect={e}
          index={i}
          count={obj.effects.length}
          local={local}
          disabled={disabled}
        />
      ))}
      {!disabled && (
        <select
          className="add-effect"
          aria-label={t('エフェクトを追加')}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('preset:')) addEffectFromPreset(obj.id, v.slice(7));
            else if (v) addEffect(obj.id, v);
          }}
        >
          <option value="">{t('＋ エフェクトを追加…')}</option>
          {EFFECT_CATEGORIES.filter((c) => available.some((d) => d.category === c)).map((c) => (
            <optgroup key={c} label={t(c)}>
              {available
                .filter((d) => d.category === c)
                .map((d) => (
                  <option key={d.type} value={d.type}>
                    {t(d.label)}
                  </option>
                ))}
            </optgroup>
          ))}
          {presets.length > 0 && (
            <optgroup label={t('プリセット')}>
              {presets.map((p) => (
                <option key={p.id} value={`preset:${p.id}`}>
                  {p.name}（{t(getEffectDef(p.type)?.label ?? p.type)}）
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}
      {obj.type === 'filter' && obj.effects.length === 0 && (
        <p className="hint">
          {t('フィルタは、自分より上のレイヤーをすべて合成した画面にエフェクトをかけます。')}
        </p>
      )}
    </details>
  );
}

/** オブジェクトの設定をプリセットに保存・適用する */
function ObjectPresetMenu({ obj }: { obj: TimelineObject }) {
  const presets = usePresets((s) => s.objects).filter((p) => p.type === obj.type);
  return (
    <select
      className="preset-menu"
      aria-label={t('プリセット')}
      value=""
      onChange={(e) => {
        const v = e.target.value;
        if (v === 'save') {
          const name = window.prompt(t('プリセットの名前'), t(getObjectDef(obj.type).label));
          if (name) saveObjectPreset(obj.id, name);
        } else if (v) applyObjectPreset(obj.id, v);
      }}
    >
      <option value="">{t('プリセット…')}</option>
      <option value="save">{t('この設定をプリセットに保存…')}</option>
      {presets.length > 0 && (
        <optgroup label={t('適用する')}>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function ObjectInspector({ obj }: { obj: TimelineObject }) {
  const fps = useEditor((s) => s.project.settings.fps);
  const playhead = useEditor((s) => s.playhead);
  const asset = useEditor((s) =>
    obj.assetId ? s.project.assets.find((a) => a.id === obj.assetId) : undefined,
  );
  const locked = useEditor((s) =>
    currentScene(s).layers.some((l) => l.index === obj.layer && l.locked),
  );
  const def = getObjectDef(obj.type);
  const local = Math.min(Math.max(0, playhead - obj.start), obj.length - 1);
  const scene = useEditor((s) => currentScene(s));
  const values = resolveParams(obj, local, { fps, scene, sceneFrame: obj.start + local });
  const variables = def.params.filter((p) => p.kind === 'number').map((p) => p.id);
  const target: Target = { obj, params: obj.params, local };
  const keys = objectKeyTimes(obj);

  return (
    <div className="inspector-content">
      <div className="inspector-title">
        <span className="type-badge" style={{ background: def.color }}>
          {t(def.label)}
        </span>
        {asset && (
          <span className="asset-ref" title={asset.name}>
            {asset.name}
          </span>
        )}
        {!locked && <ObjectPresetMenu obj={obj} />}
      </div>
      {locked && <p className="hint">{t('レイヤーがロックされているため編集できません。')}</p>}
      {!locked && def.params.some((p) => p.kind === 'number' && p.animatable) && (
        <div className="midpoint-row">
          <button
            type="button"
            onClick={() => addMidpointAtPlayhead(obj.id)}
            title={t('動いているすべてのパラメータの、この時刻にキーを打ちます')}
          >
            {t('中間点を追加')}
          </button>
          <button
            type="button"
            onClick={() => removeMidpointAtPlayhead(obj.id)}
            disabled={!keys.includes(local)}
          >
            {t('中間点を削除')}
          </button>
          <span className="dim">{keys.length > 0 ? t('キー {0} 個', keys.length) : ''}</span>
        </div>
      )}
      <details open className="param-group">
        <summary>{t('時間')}</summary>
        <div className="timing-grid">
          <label htmlFor="ins-start">{t('開始')}</label>
          <input
            id="ins-start"
            type="number"
            min={0}
            value={obj.start}
            disabled={locked}
            onChange={(e) =>
              e.target.value !== '' && setObjectTiming(obj.id, Number(e.target.value), obj.length)
            }
          />
          <span className="dim">{formatTimecode(obj.start, fps)}</span>
          <label htmlFor="ins-length">{t('長さ')}</label>
          <input
            id="ins-length"
            type="number"
            min={1}
            value={obj.length}
            disabled={locked}
            onChange={(e) =>
              e.target.value !== '' && setObjectTiming(obj.id, obj.start, Number(e.target.value))
            }
          />
          <span className="dim">
            {(obj.length / fpsValue(fps)).toFixed(2)} {t('秒')}
          </span>
          <span>{t('レイヤー')}</span>
          <span data-testid="inspector-layer">{obj.layer}</span>
          <span />
        </div>
      </details>
      {groupParams(def.params).map(([group, params]) => {
        const visible = params.filter((p) => !p.visibleIf || p.visibleIf(values));
        if (visible.length === 0) return null;
        return (
          <details key={group} open={!COLLAPSED_GROUPS.includes(group)} className="param-group">
            <summary>{t(group)}</summary>
            {visible.map((p) => (
              <ParamField
                key={p.id}
                def={p}
                target={target}
                value={values[p.id]}
                disabled={locked}
                variables={variables}
              />
            ))}
          </details>
        );
      })}
      {def.effects && <EffectsSection obj={obj} local={local} disabled={locked} />}
    </div>
  );
}

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const obj = useEditor((s) => currentScene(s).objects.find((o) => o.id === s.selection[0]));
  const settings = useEditor((s) => s.project.settings);

  return (
    <section className="panel inspector" aria-label={t('設定')}>
      <header className="panel-header">
        <h2>{t('設定')}</h2>
        {selection.length > 1 && (
          <span className="dim">{t('{0} 個選択中（先頭を表示）', selection.length)}</span>
        )}
      </header>
      <div className="panel-body">
        {obj ? (
          <ObjectInspector key={obj.id} obj={obj} />
        ) : (
          <div className="inspector-content">
            <p className="empty-hint">
              {t('タイムラインのオブジェクトを選ぶと、ここで設定を変更できます。')}
            </p>
            <dl className="project-summary">
              <dt>{t('解像度')}</dt>
              <dd>
                {settings.width} × {settings.height}
              </dd>
              <dt>{t('フレームレート')}</dt>
              <dd>{Math.round(fpsValue(settings.fps) * 1000) / 1000} fps</dd>
              <dt>{t('サンプリングレート')}</dt>
              <dd>{settings.sampleRate} Hz</dd>
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
