import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';

import App from './App';
import { BackendConnectionProvider } from './lib/BackendConnectionProvider';
import { TooltipProvider } from './components/ui/tooltip';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} reducedMotion="user">
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <BackendConnectionProvider>
          <App />
        </BackendConnectionProvider>
      </TooltipProvider>
    </MotionConfig>
  </StrictMode>,
);
