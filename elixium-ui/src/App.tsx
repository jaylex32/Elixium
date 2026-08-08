import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {AppShell} from '@/layout/AppShell';
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
    </QueryClientProvider>
  );
}

export default App;
