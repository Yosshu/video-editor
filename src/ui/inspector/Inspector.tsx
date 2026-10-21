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
import { EASE_OPTIONS } from '../../core/animation/ease';
import { isAnimated } from '../../core/animation/interpolate';
import { easeAt, hasKeyAt, keyTimes } from '../../core/animation/keys';
import { resolveParams } from '../../core/evaluate/evaluate';
import { formatTimecode, fpsValue } from '../../core/model/time';
import type { Ease, TimelineObject } from '../../core/model/types';
import { getObjectDef } from '../../core/objects/definitions';
import type { NumberParamDef, ParamDef } from '../../core/params/defs';
import { currentScene, useEditor } from '../../state/store';
import { EaseEditor } from './EaseEditor';
import { BoolField, ColorField, FontField, NumberField, SelectField, TextField } from './fields';

function KeyControls({
  obj,
  def,
  local,
}: {
  obj: TimelineObject;
  def: NumberParamDef;
  local: number;
}) {
  const value = obj.params[def.id];
  const animated = isAnimated(value);
  const onKey = hasKeyAt(value, local);
  return (
    <span className="key-controls">
      {animated && (
        <button
          type="button"
          className="key-button"
          title="前のキーへ"
          aria-label={`${def.label}の前のキーへ`}
          onClick={() => jumpToKey(obj.id, def.id, -1)}
        >
          ◀
        </button>
      )}
      <button
        type="button"
        className={`key-button key-toggle ${onKey ? 'on' : animated ? 'animated' : ''}`}
        title={onKey ? 'この時刻のキーを削除' : 'この時刻にキーを追加（アニメーション）'}
        aria-label={`${def.label}のキーフレーム`}
        aria-pressed={onKey}
        onClick={() => toggleKeyAtPlayhead(obj.id, def.id, def.default)}
      >
        {onKey ? '◆' : '◇'}
      </button>
      {animated && (
        <button
          type="button"
          className="key-button"
          title="次のキーへ"
          aria-label={`${def.label}の次のキーへ`}
          onClick={() => jumpToKey(obj.id, def.id, 1)}
        >
          ▶
        </button>
      )}
    </span>
  );
}

function EaseRow({ obj, def, local }: { obj: TimelineObject; def: NumberParamDef; local: number }) {
  const value = obj.params[def.id];
  if (!isAnimated(value) || value.keys.length < 2) return null;
  const ease = easeAt(value, local);
  const selectValue = ease === undefined ? 'linear' : typeof ease === 'object' ? 'bezier' : ease;
  return (
    <div className="ease-row">
      <label className="field-label">
        変化
        <select
          value={selectValue}
          aria-label={`${def.label}の変化の仕方`}
          onChange={(e) => {
            const v = e.target.value;
            setEaseAtPlayhead(
              obj.id,
              def.id,
              v === 'bezier' ? { bezier: [0.25, 0.1, 0.25, 1] } : (v as Ease),
            );
          }}
        >
          {EASE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          <option value="bezier">カスタム（曲線を編集）</option>
        </select>
      </label>
      <button
        type="button"
        className="link-button"
        onClick={() => clearParamAnimation(obj.id, def.id, def.default)}
      >
        アニメーションを解除
      </button>
      {selectValue === 'bezier' && (
        <EaseEditor ease={ease} onChange={(e) => setEaseAtPlayhead(obj.id, def.id, e)} />
      )}
    </div>
  );
}

function ParamField({
  def,
  obj,
  values,
  disabled,
  local,
}: {
  def: ParamDef;
  obj: TimelineObject;
  values: Record<string, unknown>;
  disabled: boolean;
  local: number;
}) {
  const value = values[def.id];
  const change = (v: number | string | boolean) => setParamAtPlayhead(obj.id, def.id, v);
  switch (def.kind) {
    case 'number':
      return (
        <>
          <NumberField
            def={def}
            value={Number(value)}
            onChange={change}
            disabled={disabled}
            extra={
              def.animatable && !disabled ? (
                <KeyControls obj={obj} def={def} local={local} />
              ) : undefined
            }
          />
          {def.animatable && !disabled && <EaseRow obj={obj} def={def} local={local} />}
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
  }
}

function groupParams(params: ParamDef[]): [string, ParamDef[]][] {
  const groups = new Map<string, ParamDef[]>();
  for (const p of params) {
    const g = p.group ?? 'その他';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  return [...groups.entries()];
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
  const values = resolveParams(obj, local);

  return (
    <div className="inspector-content">
      <div className="inspector-title">
        <span className="type-badge" style={{ background: def.color }}>
          {def.label}
        </span>
        {asset && (
          <span className="asset-ref" title={asset.name}>
            {asset.name}
          </span>
        )}
      </div>
      {locked && <p className="hint">レイヤーがロックされているため編集できません。</p>}
      {!locked && getObjectDef(obj.type).visual && (
        <div className="midpoint-row">
          <button
            type="button"
            onClick={() => addMidpointAtPlayhead(obj.id)}
            title="動いているすべてのパラメータの、この時刻にキーを打ちます"
          >
            中間点を追加
          </button>
          <button
            type="button"
            onClick={() => removeMidpointAtPlayhead(obj.id)}
            disabled={!keyTimes(obj.params, obj.length).includes(local)}
          >
            中間点を削除
          </button>
          <span className="dim">
            {keyTimes(obj.params, obj.length).length > 0
              ? `キー ${keyTimes(obj.params, obj.length).length} 個`
              : ''}
          </span>
        </div>
      )}
      <details open className="param-group">
        <summary>時間</summary>
        <div className="timing-grid">
          <label htmlFor="ins-start">開始</label>
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
          <label htmlFor="ins-length">長さ</label>
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
          <span className="dim">{(obj.length / fpsValue(fps)).toFixed(2)} 秒</span>
          <span>レイヤー</span>
          <span>{obj.layer}</span>
          <span />
        </div>
      </details>
      {groupParams(def.params).map(([group, params]) => {
        const visible = params.filter((p) => !p.visibleIf || p.visibleIf(values));
        if (visible.length === 0) return null;
        return (
          <details key={group} open className="param-group">
            <summary>{group}</summary>
            {visible.map((p) => (
              <ParamField
                key={p.id}
                def={p}
                obj={obj}
                values={values}
                disabled={locked}
                local={local}
              />
            ))}
          </details>
        );
      })}
    </div>
  );
}

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const obj = useEditor((s) => currentScene(s).objects.find((o) => o.id === s.selection[0]));
  const settings = useEditor((s) => s.project.settings);

  return (
    <section className="panel inspector" aria-label="設定">
      <header className="panel-header">
        <h2>設定</h2>
        {selection.length > 1 && (
          <span className="dim">{selection.length} 個選択中（先頭を表示）</span>
        )}
      </header>
      <div className="panel-body">
        {obj ? (
          <ObjectInspector key={obj.id} obj={obj} />
        ) : (
          <div className="inspector-content">
            <p className="empty-hint">
              タイムラインのオブジェクトを選ぶと、ここで設定を変更できます。
            </p>
            <dl className="project-summary">
              <dt>解像度</dt>
              <dd>
                {settings.width} × {settings.height}
              </dd>
              <dt>フレームレート</dt>
              <dd>{Math.round(fpsValue(settings.fps) * 1000) / 1000} fps</dd>
              <dt>サンプリングレート</dt>
              <dd>{settings.sampleRate} Hz</dd>
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
