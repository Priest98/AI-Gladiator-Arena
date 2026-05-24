import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

window.addEventListener('error', (event) => {
  fetch('http://localhost:8081/api/client-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: event.message,
      stack: event.error ? event.error.stack : 'No stack trace available'
    })
  }).catch(() => {});
});

window.addEventListener('unhandledrejection', (event) => {
  fetch('http://localhost:8081/api/client-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Unhandled promise rejection: ${event.reason}`,
      stack: event.reason && event.reason.stack ? event.reason.stack : 'No stack trace available'
    })
  }).catch(() => {});
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
