'use client';
import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { householdOpen } from '@/lib/use-household';
import { ErrorBoundary } from './error-boundary';
import { AppContext } from './state/context';
import { useSameAgainController } from './state/controller';
import { navigation } from './state/helpers';
import { Sidebar } from './shell/sidebar';
import { Topbar } from './shell/topbar';
import { Notices } from './shell/notices';
import { BottomNav } from './shell/bottom-nav';
import { Onboarding } from './views/onboarding';
import { ListsView } from './views/lists-view';
import { DiscoverView } from './views/discover-view';
import { FavouritesView } from './views/favourites-view';
import { HouseholdView } from './views/household-view';
import { ModalHost } from './modals/modal-host';
import './same-again.css';
import './meals.css';
// Secondary areas load on demand so the shopping list starts faster.
const Meals = lazy(() => import('./meals'));

/**
 * The Same Again app shell: side navigation, header, notices, the current view and every dialog.
 * State and handlers live in `useSameAgainController()` and reach the parts through `AppContext`.
 */
export default function SameAgain() {
  const app = useSameAgainController();
  const { s, household, hid, view, shopping, dark, lists, active, add } = app;
  return (
    <AppContext.Provider value={app}>
      <div className="app-shell flex min-h-svh w-full">
        <Toaster theme={dark ? 'dark' : 'light'} position="bottom-center" richColors />
        <Sidebar />
        <div className={'app-body ' + (shopping ? 'shopping-mode' : '')}>
          <Topbar />
          <Notices />
          <main>
            <ErrorBoundary
              key={view}
              name={navigation.find((n) => n.id === view)?.label || 'This view'}
            >
              <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                {s.loading ? (
                  <div className="stack">
                    <Skeleton className="h-12 w-72" />
                    <Skeleton className="h-64 w-full" />
                  </div>
                ) : !household ? (
                  <Onboarding />
                ) : (
                  <>
                    {view === 'lists' && <ListsView />}
                    {view === 'meals' && householdOpen(s) && (
                      <Meals key={hid} s={s} lists={lists} active={active} onAdd={add} />
                    )}
                    {view === 'discover' && <DiscoverView />}
                    {view === 'favourites' && <FavouritesView />}
                    {view === 'household' && <HouseholdView household={household} />}
                  </>
                )}
              </Suspense>
            </ErrorBoundary>
          </main>
          <BottomNav />
        </div>
        <ModalHost />
      </div>
    </AppContext.Provider>
  );
}
