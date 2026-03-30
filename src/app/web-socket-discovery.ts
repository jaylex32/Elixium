import type {Socket} from 'socket.io';

interface WebSocketDiscoveryDependencies {
  socket: Socket;
  getDiscoveryContent: (service: string, type: string, limit?: number) => Promise<any[]>;
}

export const registerDiscoverySocketHandler = ({socket, getDiscoveryContent}: WebSocketDiscoveryDependencies) => {
  socket.on('getDiscoveryContent', async (data) => {
    try {
      console.log('🏠 Fetching discovery content:', data.type, 'Service:', data.service);

      const {type, service, limit = 18} = data;
      const items = await getDiscoveryContent(service, type, Number(limit));

      console.log(`✅ Found ${items.length} real ${type} items for ${service}`);

      socket.emit('discoveryContent', {
        type,
        service,
        items: items.slice(0, Number(limit)),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('❌ Discovery content error:', errorMessage);
      socket.emit('discoveryError', {
        message: errorMessage,
        type: data.type,
      });
    }
  });
};
