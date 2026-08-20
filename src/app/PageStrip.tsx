import { buildSpreads } from './hooks';
import { useProject } from '../store/useProject';

/** Bottom filmstrip for jumping between spreads. */
export function PageStrip(): JSX.Element {
  const pages = useProject((s) => s.pages);
  const spreadIndex = useProject((s) => s.view.spreadIndex);
  const showSpread = useProject((s) => s.showSpread);
  const select = useProject((s) => s.select);
  const spreads = buildSpreads(pages);

  return (
    <div className="strip">
      {spreads.map((spread, index) => (
        <button
          key={spread.pages[0].id}
          className={index === spreadIndex ? 'thumb active' : 'thumb'}
          onClick={() => {
            showSpread(index);
            select({ pageId: spread.pages[0].id });
          }}
        >
          {spread.pages.map((p) => (p.index === 0 ? '封面' : p.index)).join('–')}
        </button>
      ))}
    </div>
  );
}
