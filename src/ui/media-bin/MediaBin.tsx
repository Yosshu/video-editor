import { useState } from 'react';
import { addAssetObjects } from '../../app/actions';
import {
  collectDroppedFiles,
  importDroppedFiles,
  replaceAssetFile,
  type IncomingFile,
} from '../../app/assets';
import type { Asset } from '../../core/model/types';
import { hasCollision, MAX_LAYERS } from '../../core/timeline/ops';
import { MEDIA_ACCEPT } from '../../engine/media/detect';
import { pickFilesWithInput } from '../../storage/filePicker';
import { commit, currentScene, getState, notify, useEditor } from '../../state/store';
import { openContextMenu, openDialog } from '../../state/ui';
import { formatBytes, formatDuration } from '../common/format';
import { useThumbnail } from '../common/mediaHooks';
import { t } from '../../i18n';

export const ASSET_DRAG_TYPE = 'application/x-ved-asset';

const KIND_LABEL: Record<Asset['kind'], string> = {
  video: '動画',
  image: '画像',
  audio: '音声',
  font: 'フォント',
  lut: 'LUT',
};

async function pickMediaFiles(multiple = true): Promise<IncomingFile[]> {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple,
        id: 'media',
        types: [
          {
            description: t('動画・画像・音声'),
            accept: { 'video/*': [], 'image/*': [], 'audio/*': [] },
          },
        ],
      });
      return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
    } catch {
      return [];
    }
  }
  const files = await pickFilesWithInput({ accept: MEDIA_ACCEPT, multiple });
  return files.map((file) => ({ file }));
}

/** 再生位置で空いている最初のレイヤーに素材を置く */
function addToTimeline(asset: Asset): void {
  if (asset.kind === 'lut') {
    notify(t('LUT はタイムラインには置かず、エフェクト「LUT（色の変換表）」で選んで使います。'));
    return;
  }
  const state = getState();
  const scene = currentScene(state);
  const length = 1;
  for (let layer = 1; layer <= MAX_LAYERS; layer++) {
    if (!hasCollision(scene.objects, layer, state.playhead, length, new Set())) {
      addAssetObjects([asset], layer, state.playhead);
      return;
    }
  }
}

function describe(asset: Asset): string {
  const parts: string[] = [t(KIND_LABEL[asset.kind])];
  if (asset.width && asset.height) parts.push(`${asset.width}×${asset.height}`);
  if (asset.durationSec) parts.push(formatDuration(asset.durationSec));
  parts.push(formatBytes(asset.size));
  return parts.join(t(' ・ '));
}

function AssetThumb({ asset }: { asset: Asset }) {
  const url = useThumbnail(asset.kind === 'audio' ? undefined : asset.id);
  return (
    <span className="asset-kind" style={url ? { backgroundImage: `url(${url})` } : undefined}>
      {url ? '' : t(KIND_LABEL[asset.kind])}
    </span>
  );
}

export function MediaBin() {
  const assets = useEditor((s) => s.project.assets);
  const status = useEditor((s) => s.assetStatus);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const importFiles = async (files: IncomingFile[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      await importDroppedFiles(files);
    } finally {
      setBusy(false);
    }
  };

  const removeAsset = (asset: Asset) => {
    // オブジェクトの素材のほか、エフェクトのパラメータ（LUT など）で使われていないかも調べる
    const used = getState().project.scenes.some((s) =>
      s.objects.some(
        (o) =>
          o.assetId === asset.id ||
          o.effects.some((e) => Object.values(e.params).includes(asset.id)),
      ),
    );
    if (used) {
      notify(t('タイムラインで使われている素材は削除できません。'), 'error');
      return;
    }
    commit(t('素材の削除'), (draft) => {
      draft.assets = draft.assets.filter((a) => a.id !== asset.id);
    });
  };

  return (
    <section
      className={`panel media-bin ${over ? 'drag-over' : ''}`}
      aria-label={t('素材一覧')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        void collectDroppedFiles(e.dataTransfer).then(importFiles);
      }}
    >
      <header className="panel-header">
        <h2>{t('素材')}</h2>
        <button
          type="button"
          title={t('名前に番号の付いた画像を、1 本の動画としてまとめて読み込みます')}
          onClick={() =>
            void pickFilesWithInput({ accept: 'image/*', multiple: true }).then((files) => {
              if (files.length === 1) {
                notify(t('連番画像は 2 枚以上選んでください。'), 'error');
              } else if (files.length > 1) {
                openDialog({ type: 'imageSequence', files });
              }
            })
          }
          disabled={busy}
        >
          {t('連番画像…')}
        </button>
        <button
          type="button"
          onClick={() => void pickMediaFiles().then(importFiles)}
          disabled={busy}
        >
          {busy ? t('読み込み中…') : t('追加…')}
        </button>
      </header>
      <div className="panel-body">
        {assets.length === 0 ? (
          <p className="empty-hint">
            {t('動画・画像・音声ファイルをここにドロップするか、「追加…」から選んでください。')}
          </p>
        ) : (
          <ul className="asset-list">
            {assets.map((asset) => {
              const st = status[asset.id];
              const missing = st === 'missing' || st === 'error';
              return (
                <li
                  key={asset.id}
                  className={`asset-item kind-${asset.kind} ${missing ? 'missing' : ''}`}
                  draggable={!missing}
                  title={`${asset.name}\n${describe(asset)}${missing ? t('\n（ファイルが見つかりません）') : ''}`}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onDoubleClick={() => !missing && addToTimeline(asset)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openContextMenu(e.clientX, e.clientY, [
                      {
                        label: t('タイムラインに追加'),
                        disabled: missing,
                        action: () => addToTimeline(asset),
                      },
                      {
                        label: t('ファイルを指定し直す…'),
                        action: () =>
                          void pickMediaFiles(false).then(async ([incoming]) => {
                            if (!incoming) return;
                            try {
                              await replaceAssetFile(asset, incoming);
                            } catch {
                              notify(
                                t('「{0}」を読み込めませんでした。', incoming.file.name),
                                'error',
                              );
                            }
                          }),
                      },
                      'separator',
                      { label: t('素材を削除'), action: () => removeAsset(asset) },
                    ]);
                  }}
                >
                  <AssetThumb asset={asset} />
                  <span className="asset-name">{asset.name}</span>
                  <span className="asset-meta">
                    {missing
                      ? t('ファイルが見つかりません')
                      : st === 'loading'
                        ? t('読み込み中…')
                        : describe(asset)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {assets.some((a) => status[a.id] === 'missing' || status[a.id] === 'error') && (
          <button
            type="button"
            className="warning-button"
            onClick={() => openDialog({ type: 'missingAssets' })}
          >
            {t('見つからない素材を指定する…')}
          </button>
        )}
      </div>
    </section>
  );
}
