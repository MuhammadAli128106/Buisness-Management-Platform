import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import './index.css';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { apiGet } from './utils/api';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <SWRConfig value={{ fetcher: apiGet, revalidateOnFocus: true, shouldRetryOnError: false }}>
          <App />
        </SWRConfig>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
