import { ScanBarcode } from 'lucide-react';
import { useApp } from '../state/context';
import { navigation } from '../state/helpers';

/** The mobile tab bar with the floating scan button. */
export function BottomNav() {
  const { view, nav, setModal } = useApp();
  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      {navigation.map((n) => (
        <button
          key={n.id}
          aria-current={view === n.id ? 'page' : undefined}
          className={view === n.id ? 'active' : ''}
          onClick={() => nav(n.id)}
        >
          <n.icon size={22} />
          <span>{n.label}</span>
        </button>
      ))}
      <button className="scan-fab" onClick={() => setModal('scanner')} aria-label="Scan barcode">
        <ScanBarcode size={26} />
      </button>
    </nav>
  );
}
