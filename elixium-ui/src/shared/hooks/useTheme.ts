import {useEffect} from 'react';
import {useAppStore} from '@/store/app-store';

export function useTheme() {
  const {theme, setTheme} = useAppStore();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return {theme, setTheme};
}
