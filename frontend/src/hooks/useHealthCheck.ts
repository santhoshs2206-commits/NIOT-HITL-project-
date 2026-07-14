import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

export const useHealthCheck = () => {
  return useQuery({
    queryKey: ['health-check'],
    queryFn: async () => {
      const response = await api.get('/');
      return response.data;
    },
    refetchInterval: 5000, // poll health check every 5 seconds
    retry: false,          // fail fast to immediately update connection indicators
  });
};
