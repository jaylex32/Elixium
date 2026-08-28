import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {AppShell} from '@/layout/AppShell';
import {PairingGate} from '@/features/settings/PairingGate';
import {TooltipProvider} from '@/shared/components/ui/Tooltip';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {staleTime: 1000 * 60 * 5, retry: 1},
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/*
        One provider for every tooltip in the app.
        Radix throws outright when a tooltip has none above it, which takes
        down the page rendering it rather than merely losing the hover — so
        this belongs at the root and not in whichever screens remembered.
      */}
      <TooltipProvider>
        <AppShell />
        {/* Renders nothing until the server refuses this browser. */}
        <PairingGate />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
