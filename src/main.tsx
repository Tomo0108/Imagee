import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerPwa } from './platform';
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-jp';
import './styles.css';
registerPwa();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
