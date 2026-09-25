import { createContext, useContext } from 'react';
import type { AppController } from './controller';

/** The Same Again controller, provided by the shell to its views and modals. */
export const AppContext = createContext<AppController | null>(null);

export function useApp(): AppController {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp must be used inside the Same Again shell.');
  return app;
}
