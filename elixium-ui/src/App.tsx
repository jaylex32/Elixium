import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {AppShell} from '@/layout/AppShell';
import {PairingGate} from '@/features/settings/PairingGate';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {staleTime: 1000 * 60 * 5, retry: 1},
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
      {/* Renders nothing until the server refuses this browser. */}
      <PairingGate />
    </QueryClientProvider>
  );
}

export default App;
