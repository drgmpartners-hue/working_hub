import axios from 'axios';
import { API_URL } from '@/lib/api-url';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
