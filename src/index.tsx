import React from 'react';
import { render, preserveScreen } from 'tuir';
import App from './ui/App.js';

preserveScreen();

const instance = render(<App />);

instance.waitUntilExit().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Application exited with error:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  instance.unmount();
  process.exit(0);
});
