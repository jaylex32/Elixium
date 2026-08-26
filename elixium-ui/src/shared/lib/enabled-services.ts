import {useEffect, useMemo} from 'react';
import {useSettingsStore} from '@/store/settings-store';
import {useAppStore} from '@/store/app-store';
import {SERVICE_ITEMS} from '@/layout/nav-items';
import type {Service} from '@/types';

/**
 * The services the switcher should offer, and nothing else.
 *
 * Somebody with no Qobuz subscription has no use for a Qobuz button: it can
 * only ever report credentials they do not have. Turning one off in Settings
 * removes it from the sidebar and the command palette rather than leaving it
 * there to fail.
 *
 * Selecting a service that has since been switched off would leave the
 * interface on a service it does not offer — pages would keep querying it and
 * there would be no visible way back — so the selection follows the list.
 */
export function useEnabledServices() {
  const enabled = useSettingsStore((state) => state.settings.enabledServices);
  const service = useAppStore((state) => state.service);
  const setService = useAppStore((state) => state.setService);

  const services = useMemo(() => {
    const on = SERVICE_ITEMS.filter((item) => enabled?.[item.id as keyof typeof enabled] !== false);
    /* Never empty: an empty switcher offers no way to put one back. */
    return on.length > 0 ? on : SERVICE_ITEMS;
  }, [enabled]);

  useEffect(() => {
    if (!services.some((item) => item.id === service)) {
      setService(services[0].id as Service);
    }
  }, [services, service, setService]);

  return services;
}
