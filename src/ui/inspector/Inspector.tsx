import { setObjectTiming, setParam } from '../../app/actions';
import { resolveParams } from '../../core/evaluate/evaluate';
import { formatTimecode, fpsValue } from '../../core/model/time';
import type { TimelineObject } from '../../core/model/types';
import { getObjectDef } from '../../core/objects/definitions';
import type { ParamDef } from '../../core/params/defs';
import { currentScene, useEditor } from '../../state/store';
import { BoolField, ColorField, FontField, NumberField, SelectField, TextField } from './fields';

function ParamField({
  def,
  obj,
  values,
  disabled,
}: {
  def: ParamDef;
  obj: TimelineObject;
  values: Record<string, unknown>;
  disabled: boolean;
}) {
  const value = values[def.id];
  const change = (v: number | string | boolean) => setParam(obj.id, def.id, v);
  switch (def.kind) {
    case 'number':
      return <NumberField def={def} value={Number(value)} onChange={change} disabled={disabled} />;
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
              <ParamField key={p.id} def={p} obj={obj} values={values} disabled={locked} />
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
