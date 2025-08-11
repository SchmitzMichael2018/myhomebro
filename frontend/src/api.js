// src/api.js

import axios from 'axios';
import {
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  clearSession,
} from './auth.js';

// 1. Create a global axios instance with a base URL.
// All requests made with this instance will automatically go to /api/...
const api = axios.create({
  baseURL: '/api',
});

// 2. Create a request interceptor to automatically add the access token.
api.interceptors.request.use(
  (config) => {
    const token = getAccessToken();
    if (token) {
      // Add the Authorization header to every outgoing request
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    // Handle request errors
    return Promise.reject(error);
  }
);

// A variable to prevent multiple simultaneous token refresh requests
let isRefreshing = false;
// A queue to hold requests that failed due to a 401 error while the token is refreshing
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  failedQueue = [];
};

// 3. Create a response interceptor to handle token refreshing.
api.interceptors.response.use(
  (response) => {
    // If the request was successful, just return the response
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Check if the error is a 401 and we haven't already retried the request
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // If we are already refreshing the token, queue this request
        return new Promise(function(resolve, reject) {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers['Authorization'] = 'Bearer ' + token;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true; // Mark that we are retrying this request
      isRefreshing = true;

      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        // If there's no refresh token, we can't do anything.
        console.error('No refresh token available.');
        clearSession(); // Clear out any stale tokens
        return Promise.reject(error);
      }

      try {
        // Make the request to refresh the token
        const response = await axios.post('/api/token/refresh/', {
          refresh: refreshToken,
        });

        const newAccessToken = response.data.access;
        setAccessToken(newAccessToken); // Save the new access token

        // Update the authorization header on our axios instance and the original request
        api.defaults.headers.common['Authorization'] = `Bearer ${newAccessToken}`;
        originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
        
        processQueue(null, newAccessToken);

        // Retry the original request with the new token
        return api(originalRequest);

      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
        // If refreshing fails, clear tokens and redirect to login
        clearSession();
        processQueue(refreshError, null);
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // For all other errors, just reject the promise
    return Promise.reject(error);
  }
);

export default api;
