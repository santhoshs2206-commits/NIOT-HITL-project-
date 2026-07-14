import axios from 'axios';

// Load environment variables with safe defaults
const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const timeoutVal = import.meta.env.VITE_REQUEST_TIMEOUT 
  ? parseInt(import.meta.env.VITE_REQUEST_TIMEOUT, 10) 
  : 10000;

const api = axios.create({
  baseURL,
  timeout: timeoutVal,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor
api.interceptors.request.use(
  (config) => {
    // We can inject auth tokens or other configs here in the future
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response Interceptor
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Stub for global error toast notifications or redirect handling
    console.error('API Error Response:', error.response || error.message);
    return Promise.reject(error);
  }
);

export default api;
