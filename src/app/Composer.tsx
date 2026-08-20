import { useMemo, useRef, useState } from 'react';
import { templatePool, type BookStyle } from '../engine/layout/bookStyle';
import { PAGE_SIZES, sizePatch } from '../shared/constants';
import type { Orientation, PageSizeId } from '../shared/types';
import { useProject } from '../store/useProject';
import {
  allStyles,
  deleteCustomStyle,
  downloadStyle,
  loadCustomStyles,
  readStyleFile,
  saveCustomStyle,
} from './styleLibrary';

interface MiniRect {
  x: number;
  y: number;
  w: number;
  h: number;
  text?: boolean;
}

/** Schematic, hand-authored miniatures of the real page templates. */
const MINI: Record<string, MiniRect[]> = {
  T01: [{ x: 0, y: 0, w: 1, h: 1 }],
  T02: [{ x: 0.16, y: 0.14, w: 0.68, h: 0.64 }],
  T03: [
    { x: 0.12, y: 0.1, w: 0.76, h: 0.52 },
    { x: 0.12, y: 0.68, w: 0.62, h: 0.05, text: true },
    { x: 0.12, y: 0.77, w: 0.48, h: 0.05, text: true },
  ],
  T04: [
    { x: 0.12, y: 0.12, w: 0.76, h: 0.36 },
    { x: 0.12, y: 0.52, w: 0.76, h: 0.36 },
  ],
  T05: [
    { x: 0.1, y: 0.12, w: 0.48, h: 0.76 },
    { x: 0.62, y: 0.12, w: 0.28, h: 0.36 },
    { x: 0.62, y: 0.52, w: 0.28, h: 0.36 },
  ],
  T06: [
    { x: 0.1, y: 0.12, w: 0.8, h: 0.4 },
    { x: 0.1, y: 0.56, w: 0.38, h: 0.32 },
    { x: 0.52, y: 0.56, w: 0.38, h: 0.32 },
  ],
  T07: [
    { x: 0.1, y: 0.14, w: 0.38, h: 0.34 },
    { x: 0.52, y: 0.14, w: 0.38, h: 0.34 },
    { x: 0.1, y: 0.52, w: 0.38, h: 0.34 },
    { x: 0.52, y: 0.52, w: 0.38, h: 0.34 },
  ],
  T08: [
    { x: 0.16, y: 0.3, w: 0.68, h: 0.05, text: true },
    { x: 0.16, y: 0.4, w: 0.68, h: 0.05, text: true },
    { x: 0.16, y: 0.5, w: 0.5, h: 0.05, text: true },
  ],
  T09: [
    { x: 0.18, y: 0.44, w: 0.3, h: 0.06, text: true },
    { x: 0.18, y: 0.56, w: 0.16, h: 0.03, text: true },
  ],
  T10: [{ x: 0, y: 0.16, w: 1, h: 0.68 }],
};

/** The two most characteristic templates of a style, drawn as a mini spread. */
function previewIds(style: BookStyle): string[] {
  const pool = templatePool(style, Object.keys(MINI)).filter((id) => id !== 'T09');
  const ranked = [...pool].sort((a, b) => {
    const wa = style.layout.weights[a] ?? 1;
    const wb = style.layout.weights[b] ?? 1;
    return wb - wa || a.localeCompare(b);
  });
  const picked = ranked.slice(0, 2);
  while (picked.length < 2) picked.push('T02');
  return picked;
}

function MiniPage(props: { templateId: string; ratio: number }): JSX.Element {
  const rects = MINI[props.templateId] ?? MINI.T01;
  return (
    <div className="mini-page" style={{ aspectRatio: String(props.ratio) }}>
      {rects.map((rect, i) => (
        <i
          key={i}
          className={rect.text ? 'text' : undefined}
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

function StyleDiagram(props: { style: BookStyle }): JSX.Element {
  const { page } = props.style;
  const ratio = page.trimWidth / page.trimHeight;
  const ids = previewIds(props.style);
  return (
    <div className="mini-spread">
      {ids.map((id, i) => (
        <MiniPage key={`${id}-${i}`} templateId={id} ratio={ratio} />
      ))}
    </div>
  );
}

/** Style picker shown right after import: it is the fork between both flows. */
export function Composer(): JSX.Element {
  const store = useProject();
  const [customs, setCustoms] = useState<BookStyle[]>(() => loadCustomStyles());
  const [pickedId, setPickedId] = useState(store.style.id);
  /** Open format chosen by hand; null means "whatever the template says". */
  const [size, setSize] = useState<{ id: PageSizeId; orientation: Orientation } | null>(null);
  const styleInput = useRef<HTMLInputElement>(null);
  const assetInput = useRef<HTMLInputElement>(null);
  const styles = useMemo(() => allStyles(customs), [customs]);
  const picked = styles.find((item) => item.id === pickedId) ?? styles[0];
  const images = store.assets.filter((asset) => asset.kind === 'image').length;
  const texts = store.assets.length - images;
  const format = size ?? {
    id: picked?.page.sizeId ?? store.pageSpec.sizeId,
    orientation: picked?.page.orientation ?? store.pageSpec.orientation,
  };

  /** Lays out the whole book, then lands on the preview or in the editor. */
  const start = (target: 'preview' | 'edit') => {
    if (!picked) return;
    store.applyStyle(picked, target, size ? sizePatch(size.id, size.orientation) : undefined);
  };

  const importStyle = async (file: File) => {
    try {
      const style = await readStyleFile(file);
      setCustoms(saveCustomStyle(style));
      setPickedId(style.id);
      store.setToast(`已导入模版「${style.name}」`);
    } catch (error) {
      store.setToast((error as Error).message || '模版导入失败');
    }
  };

  return (
    <div className="composer">
      <header>
        <h1>
          选择模版<em>templates</em>
        </h1>
        <p className="hint">
          已就绪 {images} 张图片{texts ? ` · ${texts} 段文字` : ''}
          ，选一个模版和开本，直接生成整本画册。
        </p>
      </header>

      <div className="format-row">
        <span className="label">开本</span>
        {PAGE_SIZES.map((preset) => (
          <button
            key={preset.id}
            className={`chip${format.id === preset.id ? ' active' : ''}`}
            onClick={() => setSize({ id: preset.id, orientation: format.orientation })}
          >
            {preset.label}
          </button>
        ))}
        <span className="rule" />
        <button
          className={`chip${format.orientation === 'portrait' ? ' active' : ''}`}
          onClick={() => setSize({ id: format.id, orientation: 'portrait' })}
        >
          纵向
        </button>
        <button
          className={`chip${format.orientation === 'landscape' ? ' active' : ''}`}
          onClick={() => setSize({ id: format.id, orientation: 'landscape' })}
        >
          横向
        </button>
      </div>

      <div className="style-grid">
        {styles.map((style) => (
          <div
            key={style.id}
            role="button"
            tabIndex={0}
            aria-pressed={style.id === picked?.id}
            className={`style-card${style.id === picked?.id ? ' active' : ''}`}
            onClick={() => setPickedId(style.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setPickedId(style.id);
              }
            }}
          >
            <StyleDiagram style={style} />
            <strong>{style.name}</strong>
            <span className="latin">{style.latin}</span>
            <span className="hint">{style.blurb}</span>
            <span className="meta">
              {style.layout.chapters ? '章节页' : '连续页'}
              {style.builtin ? '' : ' · 导入'}
            </span>
            {style.builtin ? null : (
              <button
                className="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  setCustoms(deleteCustomStyle(style.id));
                  if (pickedId === style.id) setPickedId(styles[0].id);
                }}
              >
                删除
              </button>
            )}
          </div>
        ))}
      </div>

      <footer className="composer-actions">
        <button
          className="primary"
          disabled={!picked || store.assets.length === 0}
          onClick={() => start('preview')}
        >
          一键生成画册
        </button>
        <button disabled={!picked || store.assets.length === 0} onClick={() => start('edit')}>
          进入编辑
        </button>
        <span className="spacer" />
        <button className="ghost" onClick={() => assetInput.current?.click()}>
          添加素材
        </button>
        <button className="ghost" onClick={() => styleInput.current?.click()}>
          导入模版
        </button>
        <button className="ghost" disabled={!picked} onClick={() => picked && downloadStyle(picked)}>
          导出模版
        </button>
        {store.pages.length > 0 ? (
          <button className="ghost" onClick={() => store.setStage('preview')}>
            返回画册
          </button>
        ) : null}
        <input
          ref={styleInput}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importStyle(file);
          }}
        />
        <input
          ref={assetInput}
          type="file"
          multiple
          accept="image/*,.txt,.md,.markdown"
          style={{ display: 'none' }}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length) void store.addFiles(files);
          }}
        />
      </footer>
    </div>
  );
}
