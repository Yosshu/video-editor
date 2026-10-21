import { useState } from 'react';
import { addAssetObjects } from '../../app/actions';
import {
  collectDroppedFiles,
  importMediaFiles,
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

export const ASSET_DRAG_TYPE = 'application/x-ved-asset';

const KIND_LABEL: Record<Asset['kind'], string> = {
  video: '動画',
  image: '画像',
  audio: '音声',
  font: 'フォント',
};

async function pickMediaFiles(multiple = true): Promise<IncomingFile[]> {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple,
        id: 'media',
        types: [
          {
            description: '動画・画像・音声',
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
  const parts: string[] = [KIND_LABEL[asset.kind]];
  if (asset.width && asset.height) parts.push(`${asset.width}×${asset.height}`);
  if (asset.durationSec) parts.push(formatDuration(asset.durationSec));
  parts.push(formatBytes(asset.size));
  return parts.join(' ・ ');
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
      await importMediaFiles(files);
    } finally {
      setBusy(false);
    }
  };

  const removeAsset = (asset: Asset) => {
    const used = getState().project.scenes.some((s) =>
      s.objects.some((o) => o.assetId === asset.id),
    );
    if (used) {
      notify('タイムラインで使われている素材は削除できません。', 'error');
      return;
    }
    commit('素材の削除', (draft) => {
      draft.assets = draft.assets.filter((a) => a.id !== asset.id);
    });
  };

  return (
    <section
      className={`panel media-bin ${over ? 'drag-over' : ''}`}
      aria-label="素材一覧"
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
        <h2>素材</h2>
        <button
          type="button"
          onClick={() => void pickMediaFiles().then(importFiles)}
          disabled={busy}
        >
          {busy ? '読み込み中…' : '追加…'}
        </button>
      </header>
      <div className="panel-body">
        {assets.length === 0 ? (
          <p className="empty-hint">
            動画・画像・音声ファイルをここにドロップするか、「追加…」から選んでください。
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
                  title={`${asset.name}\n${describe(asset)}${missing ? '\n（ファイルが見つかりません）' : ''}`}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onDoubleClick={() => !missing && addToTimeline(asset)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openContextMenu(e.clientX, e.clientY, [
                      {
                        label: 'タイムラインに追加',
                        disabled: missing,
                        action: () => addToTimeline(asset),
                      },
                      {
                        label: 'ファイルを指定し直す…',
                        action: () =>
                          void pickMediaFiles(false).then(async ([incoming]) => {
                            if (!incoming) return;
                            try {
                              await replaceAssetFile(asset, incoming);
                            } catch {
                              notify(`「${incoming.file.name}」を読み込めませんでした。`, 'error');
                            }
                          }),
                      },
                      'separator',
                      { label: '素材を削除', action: () => removeAsset(asset) },
                    ]);
                  }}
                >
                  <span className="asset-kind">{KIND_LABEL[asset.kind]}</span>
                  <span className="asset-name">{asset.name}</span>
                  <span className="asset-meta">
                    {missing
                      ? 'ファイルが見つかりません'
                      : st === 'loading'
                        ? '読み込み中…'
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
            見つからない素材を指定する…
          </button>
        )}
      </div>
    </section>
  );
}
