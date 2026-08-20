import { useMemo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Asset } from '../shared/types';
import { thumbUrl } from '../store/media';
import { useProject } from '../store/useProject';

/** Left panel: imported material in reading order, with light re-ordering. */
export function AssetPanel(props: { onCollapse: () => void }): JSX.Element {
  const assets = useProject((s) => s.assets);
  const selection = useProject((s) => s.view.selection);
  const select = useProject((s) => s.select);
  const addFiles = useProject((s) => s.addFiles);
  const removeAssets = useProject((s) => s.removeAssets);
  const reorderAsset = useProject((s) => s.reorderAsset);
  const setAssetText = useProject((s) => s.setAssetText);
  const input = useRef<HTMLInputElement>(null);

  const ordered = useMemo(
    () => [...assets].sort((a, b) => a.importIndex - b.importIndex),
    [assets],
  );
  const current = ordered.find((a) => a.id === selection.assetId);

  return (
    <aside className="side">
      <h3>
        <span>素材 {assets.length}</span>
        <em>material</em>
        <span className="row" style={{ marginLeft: 'auto' }}>
          <button className="chip" onClick={() => input.current?.click()}>
            添加
          </button>
          <button className="panel-toggle" onClick={props.onCollapse} title="收起素材栏">
            ‹
          </button>
        </span>
      </h3>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/*,.txt,.md,.markdown"
        style={{ display: 'none' }}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length) void addFiles(files);
        }}
      />
      <div className="body">
        {ordered.map((asset, index) => (
          <AssetRow
            key={asset.id}
            asset={asset}
            selected={asset.id === selection.assetId}
            onSelect={() => select({ ...selection, assetId: asset.id })}
            onUp={index > 0 ? () => reorderAsset(asset.id, index - 1) : undefined}
            onDown={index < ordered.length - 1 ? () => reorderAsset(asset.id, index + 1) : undefined}
            onRemove={() => removeAssets([asset.id])}
          />
        ))}
        {current?.kind === 'text' && (
          <div>
            <label htmlFor="asset-text">文字内容</label>
            <textarea
              id="asset-text"
              rows={4}
              value={current.text ?? ''}
              onChange={(event) => setAssetText(current.id, event.target.value)}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

interface AssetRowProps {
  asset: Asset;
  selected: boolean;
  onSelect: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove: () => void;
}

function AssetRow({ asset, selected, onSelect, onUp, onDown, onRemove }: AssetRowProps): JSX.Element {
  const url = asset.kind === 'image' ? thumbUrl(asset.id) : undefined;
  const label =
    asset.kind === 'image'
      ? asset.meta.fileName ?? asset.id
      : (asset.text ?? '').slice(0, 28) || '（空文字）';
  return (
    <div
      className={selected ? 'asset selected' : 'asset'}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect();
      }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
    >
      {url ? (
        <img src={url} alt={label} />
      ) : (
        <span aria-hidden="true" className="asset-placeholder">
          {asset.kind === 'text' ? 'T' : '·'}
        </span>
      )}
      <span className="meta">
        <span className="name">{label}</span>
        {asset.analysisStatus === 'error' && <span className="issue error">分析失败</span>}
        {asset.nearDuplicateOf && <span className="dup">近似重复</span>}
      </span>
      <span className="row" style={{ marginLeft: 'auto' }}>
        <button className="chip" disabled={!onUp} onClick={stop(onUp)} aria-label="上移">
          ↑
        </button>
        <button className="chip" disabled={!onDown} onClick={stop(onDown)} aria-label="下移">
          ↓
        </button>
        <button className="chip" onClick={stop(onRemove)} aria-label="移除">
          ×
        </button>
      </span>
    </div>
  );
}

function stop(fn?: () => void) {
  return (event: ReactMouseEvent) => {
    event.stopPropagation();
    fn?.();
  };
}
