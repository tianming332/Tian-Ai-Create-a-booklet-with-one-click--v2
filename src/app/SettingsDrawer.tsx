import { useState } from 'react';
import { PAGE_SIZES, sizePatch, withOrientation } from '../shared/constants';
import type { OrderMode, Orientation, PageSizeId, PageSpec } from '../shared/types';
import { clearAllProjects } from '../store/persist';
import { useProject } from '../store/useProject';

const ORDER_LABELS: Record<OrderMode, string> = {
  standardSmart: '智能（推荐）',
  original: '导入顺序',
  time: '拍摄时间',
  colorFlow: '色彩流动',
  shuffleRhythm: '节奏打散',
};

const DPI_OPTIONS: PageSpec['targetDpi'][] = [150, 200, 300];

/** Right-hand drawer for book-wide settings; every change re-runs layout. */
export function SettingsDrawer(): JSX.Element {
  const store = useProject();
  const { pageSpec, grouping } = store;
  /** Two-step confirm: the first click arms the button, the second wipes. */
  const [armed, setArmed] = useState(false);
  const [clearing, setClearing] = useState(false);

  const clearCache = async () => {
    setClearing(true);
    try {
      // Reset first: it releases object URLs and leaves autosave nothing to
      // write back over the cleared database.
      store.reset();
      await clearAllProjects();
      store.setToast('本地缓存已清除');
    } catch (error) {
      store.setToast(`清除失败：${(error as Error).message ?? '存储不可用'}`);
    } finally {
      setClearing(false);
      setArmed(false);
    }
  };

  const setSize = (sizeId: PageSizeId) => {
    store.setPageSpec(sizePatch(sizeId, pageSpec.orientation));
  };

  const setOrientation = (orientation: Orientation) => {
    const next = withOrientation(pageSpec, orientation);
    store.setPageSpec({
      orientation: next.orientation,
      trimWidth: next.trimWidth,
      trimHeight: next.trimHeight,
    });
  };

  return (
    <aside className="drawer">
      <h3>
        <span>设置</span>
        <em>settings</em>
        <button style={{ marginLeft: 'auto' }} onClick={() => store.setSettingsOpen(false)}>
          关闭
        </button>
      </h3>
      <div className="body">
        <div className="field">
          <label>
            开本<em>format</em>
          </label>
          <div className="chips">
            {PAGE_SIZES.map((preset) => (
              <button
                key={preset.id}
                className={`chip${pageSpec.sizeId === preset.id ? ' active' : ''}`}
                onClick={() => setSize(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <span className="hint">
            成品 {pageSpec.trimWidth} × {pageSpec.trimHeight} mm
          </span>
        </div>

        <div className="field">
          <label>
            方向<em>orientation</em>
          </label>
          <div className="chips">
            <button
              className={`chip${pageSpec.orientation === 'portrait' ? ' active' : ''}`}
              onClick={() => setOrientation('portrait')}
            >
              竖版
            </button>
            <button
              className={`chip${pageSpec.orientation === 'landscape' ? ' active' : ''}`}
              onClick={() => setOrientation('landscape')}
            >
              横版
            </button>
          </div>
        </div>

        <div className="field">
          <label>
            出血 {pageSpec.bleed} mm<em>bleed</em>
          </label>
          <input
            type="range"
            min={0}
            max={6}
            step={1}
            value={pageSpec.bleed}
            onChange={(event) => store.setPageSpec({ bleed: Number(event.target.value) })}
          />
        </div>

        <div className="field">
          <label>
            安全边距 {pageSpec.safeMargin} mm<em>margin</em>
          </label>
          <input
            type="range"
            min={5}
            max={25}
            step={1}
            value={pageSpec.safeMargin}
            onChange={(event) => store.setPageSpec({ safeMargin: Number(event.target.value) })}
          />
        </div>

        <div className="field">
          <label>
            装订间距 {pageSpec.gutter} mm<em>gutter</em>
          </label>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={pageSpec.gutter}
            onChange={(event) => store.setPageSpec({ gutter: Number(event.target.value) })}
          />
        </div>

        <div className="field">
          <label>
            目标分辨率<em>dpi</em>
          </label>
          <div className="chips">
            {DPI_OPTIONS.map((dpi) => (
              <button
                key={dpi}
                className={`chip${pageSpec.targetDpi === dpi ? ' active' : ''}`}
                onClick={() => store.setPageSpec({ targetDpi: dpi })}
              >
                {dpi} dpi
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={pageSpec.showPageNumbers}
              onChange={(event) => store.setPageSpec({ showPageNumbers: event.target.checked })}
            />
            显示页码
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={pageSpec.cropMarks}
              onChange={(event) => store.setPageSpec({ cropMarks: event.target.checked })}
            />
            导出裁切标记
          </label>
        </div>

        <div className="field">
          <label>
            编辑辅助线<em>guides</em>
          </label>
          <div className="chips">
            <button
              className={`chip${store.view.overlays.bleed ? ' active' : ''}`}
              onClick={() => store.toggleOverlay('bleed')}
            >
              出血
            </button>
            <button
              className={`chip${store.view.overlays.safeArea ? ' active' : ''}`}
              onClick={() => store.toggleOverlay('safeArea')}
            >
              安全区
            </button>
            <button
              className={`chip${store.view.overlays.frames ? ' active' : ''}`}
              onClick={() => store.toggleOverlay('frames')}
            >
              框线
            </button>
          </div>
          <span className="hint">只影响编辑视图，不会印到 PDF 上。</span>
        </div>

        <div className="field">
          <label>
            排序方式<em>order</em>
          </label>
          <div className="chips">
            {(Object.keys(ORDER_LABELS) as OrderMode[]).map((mode) => (
              <button
                key={mode}
                className={`chip${grouping.orderMode === mode ? ' active' : ''}`}
                onClick={() => store.setGrouping({ orderMode: mode })}
              >
                {ORDER_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>
            分组强度 {grouping.groupStrength.toFixed(2)}<em>grouping</em>
          </label>
          <input
            type="range"
            min={0.6}
            max={1.4}
            step={0.05}
            value={grouping.groupStrength}
            onChange={(event) => store.setGrouping({ groupStrength: Number(event.target.value) })}
          />
          <span className="hint">数值越大，分组越少越大。</span>
        </div>

        <div className="field">
          <label>
            色彩权重 {grouping.colorWeight.toFixed(2)}<em>color</em>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={grouping.colorWeight}
            onChange={(event) => store.setGrouping({ colorWeight: Number(event.target.value) })}
          />
        </div>

        <div className="field">
          <label>
            时间权重 {grouping.timeWeight.toFixed(2)}<em>time</em>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={grouping.timeWeight}
            onChange={(event) => store.setGrouping({ timeWeight: Number(event.target.value) })}
          />
        </div>

        <div className="field">
          <label>
            每组最多 {grouping.maxImagesPerGroup} 张<em>max</em>
          </label>
          <input
            type="range"
            min={3}
            max={12}
            step={1}
            value={grouping.maxImagesPerGroup}
            onChange={(event) =>
              store.setGrouping({ maxImagesPerGroup: Number(event.target.value) })
            }
          />
        </div>

        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={grouping.allowSpreads}
              onChange={(event) => store.setGrouping({ allowSpreads: event.target.checked })}
            />
            允许跨页大图
          </label>
        </div>

        <div className="field">
          <label>
            本地数据<em>local data</em>
          </label>
          <div className="chips">
            <button className="chip" onClick={store.reset}>
              重新开始
            </button>
            <button
              className="chip"
              disabled={clearing}
              onClick={() => (armed ? void clearCache() : setArmed(true))}
            >
              {clearing ? '清除中…' : armed ? '确认清除？' : '清除本地缓存'}
            </button>
            {armed && !clearing ? (
              <button className="chip" onClick={() => setArmed(false)}>
                取消
              </button>
            ) : null}
          </div>
          <span className="hint">
            「重新开始」清空当前项目；「清除本地缓存」删除本机浏览器里保存的全部相册与图片副本，操作不可撤销。
          </span>
        </div>
      </div>
    </aside>
  );
}
