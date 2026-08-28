import { useState, useEffect } from 'react';

export function useResponsiveMode(breakpoint: number = 768) {
  // The server and the browser must share the exact same first render.
  // Reading matchMedia in the state initializer makes mobile hydrate a
  // different tree from the desktop tree emitted during SSR.
  const [viewport, setViewport] = useState({ isMobile: false, isReady: false });

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);

    const updateViewport = () => {
      setViewport((current) => {
        if (current.isReady && current.isMobile === mediaQuery.matches) return current;
        return { isMobile: mediaQuery.matches, isReady: true };
      });
    };

    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);

    return () => {
      mediaQuery.removeEventListener('change', updateViewport);
    };
  }, [breakpoint]);

  return viewport;
}

export function useIsMobile(breakpoint: number = 768) {
  return useResponsiveMode(breakpoint).isMobile;
}
